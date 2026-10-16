from pathlib import Path
import os
import tempfile
import shutil
import numpy as np
from dotenv import load_dotenv
from openai import APIConnectionError, APIStatusError, OpenAI, RateLimitError
from pydantic import BaseModel, Field
from rasterio.warp import transform as reproject_coords
from starlette.background import BackgroundTask
import base64
from io import BytesIO
from PIL import Image
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds

import rasterio

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from src.pipeline import (
    calculate_area,
    db_features,
    extract_sar_features,
    FEATURE_NAMES,
    load_pretrained_model,
    otsu_threshold,
    predict,
    PRETRAINED_MODEL_PATH,
    PRETRAINED_SCALER_PATH,
    raster_info,
    read_features,
    read_features_tiled,
    risk_summary,
    threshold_mask,
    train_random_forest,
)
from src.model_service import (
    ensure_loaded as _ms_ensure_loaded,
    get_model_status,
    predict_flood_candidates,
)
from src.preprocessing import (
    SnapProcessingError,
    SnapUnavailableError,
    preprocess_sentinel1,
)

from src.routing import load_vectors, route

load_dotenv()

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="HydroShield AI API",
    description="Backend API for HydroShield AI flood analysis and routing",
    version="1.0.0",
)

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

# ============================================================
# CORS
# Allows the React frontend to communicate with this backend.
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# STARTUP — warm the GEE model cache
# ============================================================

@app.on_event("startup")
async def _startup() -> None:
    """Load the GEE RF model at server startup so the first request is fast."""
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _ms_ensure_loaded)


# ============================================================
# TEMPORARY FILE DIRECTORY
# ============================================================

TEMP_DIR = Path(tempfile.gettempdir()) / "hydroshield_api"
TEMP_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# HELPER
# ============================================================

def save_uploaded_file(uploaded_file: UploadFile, prefix: str) -> Path:
    """
    Save an uploaded file temporarily and return its path.
    """

    if not uploaded_file.filename:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file does not have a filename.",
        )

    safe_name = Path(uploaded_file.filename.replace("\\", "/")).name
    file_path = None

    try:
        with tempfile.NamedTemporaryFile(
            prefix=f"{prefix}_",
            suffix=Path(safe_name).suffix,
            dir=TEMP_DIR,
            delete=False,
        ) as buffer:
            file_path = Path(buffer.name)
            shutil.copyfileobj(uploaded_file.file, buffer)

    except Exception as exc:
        if file_path is not None:
            file_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail=f"Could not save uploaded file: {exc}",
        )

    assert file_path is not None
    return file_path


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "HydroShield AI API",
        "version": "1.0.0",
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": "HydroShield AI",
        "backend": "FastAPI",
    }


# ============================================================
# RASTER INFORMATION
# ============================================================

@app.post("/api/raster/info")
def raster_information(
    file: UploadFile = File(...)
):
    """
    Read metadata from an uploaded GeoTIFF.
    """

    raster_path = save_uploaded_file(file, "raster")

    try:
        info = raster_info(raster_path)

        return {
            "success": True,
            "filename": file.filename,
            "width": info["width"],
            "height": info["height"],
            "bands": info["bands"],
            "crs": str(info["crs"]),
            "dtype": info["dtype"],
            "nodata": info["nodata"],
            "descriptions": [
                description if description else f"Band {index + 1}"
                for index, description in enumerate(info["descriptions"])
            ],
            "bounds": list(info["bounds"]),
        }

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not inspect raster: {exc}",
        )

    finally:
        raster_path.unlink(missing_ok=True)


@app.post("/api/raster/preprocess")
def preprocess_raster(
    file: UploadFile = File(...),
    pixel_spacing_m: int = Form(10),
):
    """Preprocess a zipped Sentinel-1 GRD SAFE product with SNAP GPT."""
    if not file.filename or Path(file.filename).suffix.lower() != ".zip":
        raise HTTPException(
            status_code=400,
            detail="Upload a zipped Sentinel-1 GRD SAFE product containing manifest.safe and measurement TIFFs.",
        )
    if pixel_spacing_m not in (10, 20, 40):
        raise HTTPException(
            status_code=400,
            detail="Pixel spacing must be 10, 20, or 40 metres.",
        )

    work_dir = Path(tempfile.mkdtemp(prefix="preprocess_", dir=TEMP_DIR))
    source_path = work_dir / "sentinel1_grd.zip"
    output_path = work_dir / "hydroshield_sentinel1_preprocessed.tif"
    response = None

    try:
        with source_path.open("wb") as saved_file:
            shutil.copyfileobj(file.file, saved_file)

        try:
            info = preprocess_sentinel1(
                source_path,
                output_path,
                pixel_spacing_m=pixel_spacing_m,
            )
        except SnapUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except SnapProcessingError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        response = FileResponse(
            output_path,
            media_type="image/tiff",
            filename=output_path.name,
            headers={
                "X-HydroShield-Preprocessing": "SNAP GPT GRD Sigma0 dB",
                "X-HydroShield-Output-CRS": str(info["output_crs"]),
                "X-HydroShield-Polarizations": ",".join(info["polarizations"]),
            },
            background=BackgroundTask(
                shutil.rmtree,
                work_dir,
                ignore_errors=True,
            ),
        )
        return response
    finally:
        if response is None:
            shutil.rmtree(work_dir, ignore_errors=True)


# ============================================================
# FLOOD DETECTION
# ============================================================

@app.post("/api/flood/detect")
def detect_flood(
    file: UploadFile = File(...),
    band: int = Form(1),
    threshold: float = Form(-17.0),
    value_scale: str = Form("dB"),
):
    """
    Run the exploratory SAR threshold flood detection.
    """

    raster_path = save_uploaded_file(file, "flood")

    try:
        info = raster_info(raster_path)

        if band < 1 or band > info["bands"]:
            raise HTTPException(
                status_code=400,
                detail=f"Band must be between 1 and {info['bands']}.",
            )

        features, valid, profile = read_features(
            raster_path,
            [band],
        )

        if not valid.any():
            raise HTTPException(
                status_code=400,
                detail="The selected raster band contains no valid pixels.",
            )

        mask, _ = threshold_mask(
            features,
            valid,
            threshold,
            value_scale,
        )

        flooded_pixels = int(mask.sum())
        valid_pixels = int(valid.sum())

        percentage = (
            100.0 * flooded_pixels / max(valid_pixels, 1)
        )

        result = {
            "success": True,
            "method": "Exploratory SAR threshold",
            "threshold_db": threshold,
            "value_scale": value_scale,
            "total_pixels": info["width"] * info["height"],
            "flooded_pixels": flooded_pixels,
            "valid_pixels": valid_pixels,
            "flooded_percentage": round(percentage, 4),
        }

        # Calculate area if the CRS supports it.
        try:
            flooded_area = calculate_area(
                mask & valid,
                profile,
            )

            total_area = calculate_area(
                valid,
                profile,
            )

            risk = risk_summary(
                flooded_area,
                total_area,
                percentage,
            )

            result["flooded_area_km2"] = round(
                flooded_area,
                4,
            )

            result["total_area_km2"] = round(
                total_area,
                4,
            )

            result["risk"] = risk

        except ValueError as exc:
            result["area_error"] = str(exc)
            result["risk"] = None

        return result

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Flood detection failed: {exc}",
        )

    finally:
        raster_path.unlink(missing_ok=True)


# ============================================================
# RANDOM FOREST FLOOD DETECTION
# ============================================================

@app.post("/api/flood/random-forest")
def random_forest_detection(
    raster_file: UploadFile = File(...),
    label_file: UploadFile = File(...),
    bands: str = Form("1"),
    value_scale: str = Form("dB"),
):
    """
    Train Random Forest using an aligned label GeoTIFF
    and predict the flood mask.
    """

    raster_path = save_uploaded_file(
        raster_file,
        "rf_raster",
    )

    label_path = save_uploaded_file(
        label_file,
        "rf_labels",
    )

    try:
        selected_bands = [
            int(value.strip())
            for value in bands.split(",")
            if value.strip()
        ]

        if not selected_bands:
            raise HTTPException(
                status_code=400,
                detail="At least one SAR band is required.",
            )

        info = raster_info(raster_path)

        for selected_band in selected_bands:
            if selected_band < 1 or selected_band > info["bands"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid band: {selected_band}",
                )

        features, valid, profile = read_features(
            raster_path,
            selected_bands,
        )

        with rasterio.open(label_path) as labels_ds:
            labels = labels_ds.read(
                1,
                masked=True,
            ).filled(255)

            if (
                labels.shape != valid.shape
                or labels_ds.transform != profile["transform"]
                or labels_ds.crs != profile["crs"]
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Labels must exactly match the scene "
                        "dimensions, transform, and CRS."
                    ),
                )

        model, _, metrics = train_random_forest(
            features,
            valid,
            labels,
            value_scale,
        )

        mask = predict(
            model,
            features,
            valid,
            value_scale,
        )

        flooded_pixels = int(mask.sum())
        valid_pixels = int(valid.sum())

        percentage = (
            100.0 * flooded_pixels / max(valid_pixels, 1)
        )

        result = {
            "success": True,
            "method": "Random Forest",
            "bands": selected_bands,
            "flooded_pixels": flooded_pixels,
            "valid_pixels": valid_pixels,
            "flooded_percentage": round(percentage, 4),
            "metrics": {
                "accuracy": metrics["accuracy"],
                "precision": metrics["precision"],
                "recall": metrics["recall"],
                "f1": metrics["f1"],
                "iou": metrics["iou"],
                "train_pixels": metrics["train_pixels"],
                "test_pixels": metrics["test_pixels"],
            },
        }

        try:
            flooded_area = calculate_area(
                mask & valid,
                profile,
            )

            total_area = calculate_area(
                valid,
                profile,
            )

            risk = risk_summary(
                flooded_area,
                total_area,
                percentage,
            )

            result["flooded_area_km2"] = round(
                flooded_area,
                4,
            )

            result["total_area_km2"] = round(
                total_area,
                4,
            )

            result["risk"] = risk

        except ValueError as exc:
            result["area_error"] = str(exc)
            result["risk"] = None

        return result

    except HTTPException:
        raise

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Random Forest processing failed: {exc}",
        )

    finally:
        raster_path.unlink(missing_ok=True)
        label_path.unlink(missing_ok=True)


# ============================================================
# SHELTERS
# ============================================================

@app.get("/api/shelters")
def shelters():
    """
    Shelter endpoint.

    The current Python backend does not contain a live shelter
    database or live occupancy feed, so this endpoint intentionally
    returns an empty dataset rather than inventing shelter status.
    """

    return {
        "success": True,
        "live": False,
        "message": (
            "No live shelter dataset is connected to the current "
            "backend. Supply a CRS-tagged shelter vector dataset "
            "for routing."
        ),
        "shelters": [],
    }


# ============================================================
# API INFORMATION
# ============================================================

@app.get("/api")
def api_information():
    return {
        "service": "HydroShield AI",
        "endpoints": [
            "GET /api/health",
            "POST /api/raster/info",
            "POST /api/flood/detect",
            "POST /api/flood/random-forest",
            "POST /api/routing/find",
            "GET /api/shelters",
            "POST /api/assistant",
        ],
    }
class AssistantMessage(BaseModel):
    role: str
    content: str


class AssistantRequest(BaseModel):
    message: str
    history: list[AssistantMessage] = Field(default_factory=list)

@app.post("/api/routing/find")
async def find_safe_route(
    raster: UploadFile = File(...),
    roads: UploadFile = File(...),
    shelters: UploadFile = File(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    band: int = Form(1),
    threshold: float = Form(-17.0),
    value_scale: str = Form("dB"),
):
    temp_dir = None
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix="hydroshield_route_"))

        def request_path(uploaded_file, prefix):
            if not uploaded_file.filename:
                raise ValueError("Each uploaded file must have a filename.")
            filename = Path(uploaded_file.filename.replace("\\", "/")).name
            return temp_dir / f"{prefix}_{filename}"

        raster_path = request_path(raster, "raster")
        roads_path = request_path(roads, "roads")
        shelters_path = request_path(shelters, "shelters")

        raster_path.write_bytes(await raster.read())
        roads_path.write_bytes(await roads.read())
        shelters_path.write_bytes(await shelters.read())

        # -----------------------------------------
        # 1. Read Sentinel-1 raster
        # -----------------------------------------
        features, valid, profile = read_features(
            raster_path,
            [band]
        )

        if not valid.any():
            raise ValueError("The raster contains no valid pixels.")

        # -----------------------------------------
        # 2. Generate flood mask
        # -----------------------------------------
        mask, _ = threshold_mask(
            features,
            valid,
            threshold_db=threshold,
            value_scale=value_scale,
        )

        # -----------------------------------------
        # 3. Load roads and shelters
        # -----------------------------------------
        roads_gdf, shelters_gdf = load_vectors(
            roads_path,
            shelters_path,
            profile["crs"],
        )

        # -----------------------------------------
        # 4. Convert start point from WGS84
        #    to raster CRS
        # -----------------------------------------
        x, y = reproject_coords(
            "EPSG:4326",
            profile["crs"],
            [longitude],
            [latitude],
        )

        start_xy = (x[0], y[0])

        # -----------------------------------------
        # 5. Run actual HydroShield routing
        # -----------------------------------------
        result, _, _, flooded_roads = route(
            roads_gdf,
            shelters_gdf,
            mask,
            valid,
            profile["transform"],
            start_xy,
            raster_crs=profile["crs"],
        )

        # -----------------------------------------
        # 6. No route found
        # -----------------------------------------
        if result is None:
            return {
                "success": False,
                "message": (
                    "No safe reachable shelter was found "
                    "from the selected starting location."
                ),
                "affected_roads": int(sum(flooded_roads)),
            }

        # -----------------------------------------
        # 7. Convert route coordinates to WGS84
        # -----------------------------------------
        route_x = [point[0] for point in result["coordinates"]]
        route_y = [point[1] for point in result["coordinates"]]

        route_lon, route_lat = reproject_coords(
            profile["crs"],
            "EPSG:4326",
            route_x,
            route_y,
        )

        route_coordinates = [
            [lat, lon]
            for lat, lon in zip(route_lat, route_lon)
        ]

        # -----------------------------------------
        # 8. Get shelter information
        # -----------------------------------------
        shelter_row = shelters_gdf.loc[
            result["shelter_index"]
        ]

        shelter_name = (
            shelter_row.get("name")
            if "name" in shelter_row.index
            else "Safe Shelter"
        )

        if shelter_name is None:
            shelter_name = "Safe Shelter"

        shelter_point = result["shelter"]

        shelter_lon, shelter_lat = reproject_coords(
            profile["crs"],
            "EPSG:4326",
            [shelter_point.x],
            [shelter_point.y],
        )

        # -----------------------------------------
        # 9. Return routing result
        # -----------------------------------------
        return {
            "success": True,
            "message": "Safe route calculated successfully.",
            "route": route_coordinates,
            "distance_m": round(float(result["length_m"]), 2),
            "affected_roads": int(sum(flooded_roads)),
            "shelter": {
                "name": str(shelter_name),
                "latitude": float(shelter_lat[0]),
                "longitude": float(shelter_lon[0]),
            },
            "start": {
                "latitude": latitude,
                "longitude": longitude,
            },
        }

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Routing failed: {exc}",
        )
    finally:
        if temp_dir is not None:
            shutil.rmtree(temp_dir, ignore_errors=True)


# ============================================================
# BUNDLED DATASETS
# ============================================================

DATASETS_DIR = Path(r"d:/HydroShield-AI/datasets")

# Real filename on disk
_RASTER_FILENAME  = "subset_0_of_S1A_IW_GRDH_1SDV_20191005T002026_Cal_TF_NR_TC_2.tif"
_ROADS_FILENAME   = "patna_roads.geojson"
_SHELTERS_FILENAME = "patna_shelters.geojson"

BUNDLED_RASTER_PATH   = DATASETS_DIR / "sar"      / _RASTER_FILENAME
BUNDLED_ROADS_PATH    = DATASETS_DIR / "roads"    / _ROADS_FILENAME
BUNDLED_SHELTERS_PATH = (
    DATASETS_DIR / "shelters" / "patna_demo_shelters.geojson"
)


@app.get("/api/datasets/raster")
def serve_bundled_raster():
    """Serve the bundled Sentinel-1 SAR raster directly from disk."""
    if not BUNDLED_RASTER_PATH.exists():
        raise HTTPException(status_code=404, detail="Bundled raster not found.")
    return FileResponse(
        str(BUNDLED_RASTER_PATH),
        media_type="image/tiff",
        filename="patna_sar_flood.tif",
    )

@app.get("/api/datasets/roads")
def serve_bundled_roads():
    """Serve the bundled Patna roads GeoJSON."""
    if not BUNDLED_ROADS_PATH.exists():
        raise HTTPException(status_code=404, detail="Bundled roads not found.")
    return FileResponse(str(BUNDLED_ROADS_PATH), media_type="application/json", filename="patna_roads.geojson")

@app.get("/api/datasets/shelters")
def serve_bundled_shelters():
    """Serve the bundled Patna shelters GeoJSON."""
    if not BUNDLED_SHELTERS_PATH.exists():
        raise HTTPException(status_code=404, detail="Bundled shelters not found.")
    return FileResponse(str(BUNDLED_SHELTERS_PATH), media_type="application/json", filename="patna_shelters.geojson")


# ============================================================
# BUNDLED ANALYSIS ENDPOINTS
# These run analysis directly from files on disk — no upload needed.
# This is the correct approach for the 1.4 GB SAR raster.
# ============================================================

# Sentinel value: when the client sends exactly this threshold the backend
# auto-computes the optimal value using Otsu thresholding on the raster.
_AUTO_THRESHOLD_SENTINEL = -17.0


def _auto_detect_scale(flat_raw: np.ndarray) -> str:
    """
    Detect whether pixel values are already in dB or still in linear power.

    Sentinel-1 GRD products processed with SNAP output dB values typically
    in the range -30..0.  Linear power (sigma0) values are typically 0..1.
    If the max value is < 10 we assume linear power and return 'Linear power';
    otherwise we assume the values are already in dB.
    """
    max_val = float(np.nanmax(flat_raw))
    if max_val < 10.0:
        return "Linear power"
    return "dB"


def _resolve_threshold(flat_valid_db: np.ndarray, requested: float) -> tuple[float, bool]:
    """
    Return (effective_threshold_db, was_auto_detected).

    If `requested` equals the sentinel value (-17.0) AND the raster has
    0% flooded pixels with that threshold, fall back to Otsu auto-detection.
    Uses the lower 30th-percentile value as a conservative water threshold
    when Otsu selects a value that would mark too many pixels as flooded (>60%).
    """
    # Quick test: how many pixels would be flooded with the requested threshold?
    n_flooded = int((flat_valid_db <= requested).sum())
    if n_flooded > 0:
        return requested, False  # requested threshold already works fine

    # 0% flood — switch to Otsu auto-detection
    auto_t = otsu_threshold(flat_valid_db)

    # Sanity check: if Otsu marks >60% as flooded the scene is likely
    # near-uniform and the threshold is not meaningful — use p20 instead
    pct_flooded = 100.0 * (flat_valid_db <= auto_t).sum() / max(len(flat_valid_db), 1)
    if pct_flooded > 60.0:
        auto_t = float(np.percentile(flat_valid_db, 20))

    return auto_t, True


@app.post("/api/flood/detect-bundled")
def detect_flood_bundled(
    band: int = Form(1),
    threshold: float = Form(-17.0),
    value_scale: str = Form("dB"),
):
    """
    Run threshold flood detection on the bundled SAR raster (no upload).
    Reads directly from disk — handles any file size.
    Auto-tunes the threshold with Otsu when the default -17 dB yields 0% flood.
    """
    if not BUNDLED_RASTER_PATH.exists():
        raise HTTPException(status_code=404, detail="Bundled SAR raster not found on server.")
    try:
        info = raster_info(BUNDLED_RASTER_PATH)
        if band < 1 or band > info["bands"]:
            raise HTTPException(status_code=400, detail=f"Band must be between 1 and {info['bands']}.")

        features, valid, profile = read_features_tiled(BUNDLED_RASTER_PATH, [band])
        if not valid.any():
            raise HTTPException(status_code=400, detail="No valid pixels in raster band.")

        # Auto-detect scale (linear vs dB) then auto-tune threshold
        raw_flat      = features[valid, 0]
        detected_scale = _auto_detect_scale(raw_flat)
        eff_scale     = detected_scale if value_scale == "dB" else value_scale
        db_vals       = db_features(features, eff_scale)
        flat_vals     = db_vals[valid, 0]
        eff_threshold, auto_detected = _resolve_threshold(flat_vals, threshold)

        mask, _ = threshold_mask(features, valid, eff_threshold, eff_scale)
        flooded_pixels = int(mask.sum())
        valid_pixels   = int(valid.sum())
        percentage     = 100.0 * flooded_pixels / max(valid_pixels, 1)

        result = {
            "success": True,
            "method": "Exploratory SAR threshold",
            "threshold_db": round(eff_threshold, 4),
            "threshold_auto": auto_detected,
            "value_scale": eff_scale,
            "detected_scale": detected_scale,
            "total_pixels": info["width"] * info["height"],
            "flooded_pixels": flooded_pixels,
            "valid_pixels": valid_pixels,
            "flooded_percentage": round(percentage, 4),
            "source": "bundled",
            "filename": _RASTER_FILENAME,
        }
        try:
            flooded_area = calculate_area(mask & valid, profile)
            total_area   = calculate_area(valid, profile)
            risk         = risk_summary(flooded_area, total_area, percentage)
            result["flooded_area_km2"] = round(flooded_area, 4)
            result["total_area_km2"]   = round(total_area,   4)
            result["risk"]             = risk
        except ValueError as exc:
            result["area_error"] = str(exc)
            result["risk"]       = None
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Bundled flood detection failed: {exc}")


@app.post("/api/flood/rf-pretrained-bundled")
def rf_pretrained_bundled(
    band: int = Form(1),
    value_scale: str = Form("dB"),
):
    """
    Run multi-feature Random Forest on the bundled SAR raster (no upload).
    Reads directly from disk — handles any file size.
    Uses tiled reading + 6-feature extraction + stratified sub-sampling.
    """
    if not BUNDLED_RASTER_PATH.exists():
        raise HTTPException(status_code=404, detail="Bundled SAR raster not found on server.")
    try:
        info = raster_info(BUNDLED_RASTER_PATH)
        if band < 1 or band > info["bands"]:
            raise HTTPException(status_code=400, detail=f"Band must be between 1 and {info['bands']}.")

        features, valid, profile = read_features_tiled(BUNDLED_RASTER_PATH, [band])
        if not valid.any():
            raise HTTPException(status_code=400, detail="No valid pixels in raster band.")

        # Auto-detect scale then convert to dB for thresholding and training
        raw_flat       = features[valid, 0]
        detected_scale = _auto_detect_scale(raw_flat)
        eff_scale      = detected_scale if value_scale == "dB" else value_scale
        db_vals   = db_features(features, eff_scale)
        flat_vals = db_vals[valid, 0]

        otsu_t        = otsu_threshold(flat_vals)
        pseudo_labels = np.zeros(valid.shape, dtype="uint8")
        pseudo_labels[valid] = (flat_vals <= otsu_t).astype("uint8")

        # Sanity: if Otsu marks >60% flooded use p20 instead
        if pseudo_labels[valid].mean() > 0.60:
            otsu_t = float(np.percentile(flat_vals, 20))
            pseudo_labels[valid] = (flat_vals <= otsu_t).astype("uint8")

        if len(np.unique(pseudo_labels[valid])) < 2:
            # Fallback: label bottom 30% of values as flooded
            fallback_t = float(np.percentile(flat_vals, 30))
            mask_fb, _ = threshold_mask(features, valid, fallback_t, eff_scale)
            pseudo_labels = mask_fb.astype("uint8")

        if len(np.unique(pseudo_labels[valid])) < 2:
            raise HTTPException(status_code=400, detail="Could not generate two-class pseudo-labels.")

        model, _, metrics = train_random_forest(
            features, valid, pseudo_labels, value_scale=eff_scale, use_texture=True
        )
        mask = predict(model, features, valid, eff_scale, use_texture=True)

        flooded_pixels = int(mask.sum())
        valid_pixels   = int(valid.sum())
        percentage     = 100.0 * flooded_pixels / max(valid_pixels, 1)

        importances = {
            name: round(float(imp), 6)
            for name, imp in zip(
                metrics.get("features_used", FEATURE_NAMES),
                model.feature_importances_,
            )
        }

        result = {
            "success": True,
            "method": "Random Forest · 6-feature multi-texture",
            "otsu_threshold_db": round(float(otsu_t), 4),
            "flooded_pixels": flooded_pixels,
            "valid_pixels": valid_pixels,
            "flooded_percentage": round(percentage, 4),
            "feature_importances": importances,
            "source": "bundled",
            "metrics": {
                "accuracy":     round(metrics["accuracy"],  4),
                "precision":    round(metrics["precision"], 4),
                "recall":       round(metrics["recall"],    4),
                "f1":           round(metrics["f1"],        4),
                "iou":          round(metrics["iou"],       4),
                "train_pixels": metrics["train_pixels"],
                "test_pixels":  metrics["test_pixels"],
                "n_estimators": metrics.get("n_estimators", 200),
                "features":     metrics.get("features_used", FEATURE_NAMES),
            },
        }
        try:
            flooded_area = calculate_area(mask & valid, profile)
            total_area   = calculate_area(valid, profile)
            risk         = risk_summary(flooded_area, total_area, percentage)
            result["flooded_area_km2"] = round(flooded_area, 4)
            result["total_area_km2"]   = round(total_area,   4)
            result["risk"]             = risk
        except ValueError as exc:
            result["area_error"] = str(exc)
            result["risk"]       = None
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Bundled RF detection failed: {exc}")



@app.post("/api/routing/find-bundled")
async def find_safe_route_bundled(
    latitude: float = Form(...),
    longitude: float = Form(...),
    band: int = Form(1),
    threshold: float = Form(-17.0),
    value_scale: str = Form("dB"),
):
    """
    Flood-aware routing using the latest Random Forest prediction mask.
    The band, threshold, and value_scale parameters are retained for
    frontend compatibility; the binary prediction mask is used directly.
    """
    import rasterio
    import numpy as np

    predictions_dir = (
        Path(__file__).resolve().parent
        / "outputs"
        / "predictions"
    )

    prediction_files = sorted(
        predictions_dir.glob("flood_candidates_*.tif"),
        key=lambda file: file.stat().st_mtime,
        reverse=True,
    )

    if not prediction_files:
        raise HTTPException(
            status_code=404,
            detail="No Random Forest prediction found. Run flood prediction first.",
        )

    prediction_path = prediction_files[0]

    for label, path in [
        ("roads", BUNDLED_ROADS_PATH),
        ("shelters", BUNDLED_SHELTERS_PATH),
    ]:
        if not path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Bundled {label} not found on server.",
            )

    try:
        # 1. Load the latest binary flood-candidate mask.
                # 1. Load the latest binary flood-candidate mask.
        with rasterio.open(prediction_path) as src:
            if src.crs is None:
                raise ValueError(
                    "Prediction raster has no CRS; routing cannot align coordinates."
                )

            raw_mask = src.read(1)

            # 1 = flood candidate, 0 = non-candidate, 255 = invalid
            mask = raw_mask == 1
            valid = (raw_mask == 0) | (raw_mask == 1)

            profile = src.profile.copy()

        if not valid.any():
            raise ValueError("Prediction raster contains no valid pixels.")

        # 2. Load roads and shelters in the prediction raster's CRS.
        roads_gdf, shelters_gdf = load_vectors(
            BUNDLED_ROADS_PATH,
            BUNDLED_SHELTERS_PATH,
            profile["crs"],
        )

        # 3. Convert the user's start point from WGS84 into raster coordinates.
        x, y = reproject_coords(
            "EPSG:4326",
            profile["crs"],
            [longitude],
            [latitude],
        )
        start_xy = (x[0], y[0])

        # 4. Calculate a route using the prediction mask.
        result, _, _, flooded_roads = route(
            roads_gdf,
            shelters_gdf,
            mask,
            valid,
            profile["transform"],
            start_xy,
            raster_crs=profile["crs"],
        )

        if result is None:
            return {
                "success": False,
                "message": (
                    "No safe reachable shelter was found from this location."
                ),
                "affected_roads": int(sum(flooded_roads)),
                "prediction_file": prediction_path.name,
                "label_warning": (
                    "The input mask contains flood candidates, "
                    "not independently confirmed flooding."
                ),
            }

        # 5. Convert route coordinates back to WGS84 for the frontend.
        route_x = [point[0] for point in result["coordinates"]]
        route_y = [point[1] for point in result["coordinates"]]

        route_lon, route_lat = reproject_coords(
            profile["crs"],
            "EPSG:4326",
            route_x,
            route_y,
        )

        route_coordinates = [
            [lat, lon]
            for lat, lon in zip(route_lat, route_lon)
        ]

        # 6. Get the selected shelter's details.
        shelter_row = shelters_gdf.loc[result["shelter_index"]]
        shelter_name = (
            shelter_row.get("name")
            if "name" in shelter_row.index
            else "Safe Shelter"
        )

        if shelter_name is None:
            shelter_name = "Safe Shelter"

        shelter_point = result["shelter"]

        shelter_lon, shelter_lat = reproject_coords(
            profile["crs"],
            "EPSG:4326",
            [shelter_point.x],
            [shelter_point.y],
        )

        # 7. Return the route in the format expected by the frontend.
        return {
            "success": True,
            "message": "Safe route calculated using the latest prediction mask.",
            "route": route_coordinates,
            "distance_m": round(float(result["length_m"]), 2),
            "affected_roads": int(sum(flooded_roads)),
            "shelter": {
                "name": str(shelter_name),
                "latitude": float(shelter_lat[0]),
                "longitude": float(shelter_lon[0]),
            },
            "start": {
                "latitude": latitude,
                "longitude": longitude,
            },
            "prediction_file": prediction_path.name,
            "label_warning": (
                "Flood candidates are not independently confirmed flooding."
            ),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Prediction-based routing failed: {exc}",
        )



@app.post("/api/flood/rf-pretrained")
def rf_pretrained_detection(
    file: UploadFile = File(...),
    band: int = Form(1),
    value_scale: str = Form("dB"),
):
    """
    Multi-feature Random Forest flood classifier — no labelled data required.

    Pipeline:
      1. Read SAR raster via memory-efficient tiled loader.
      2. Convert to dB (if needed).
      3. Auto-generate pseudo-labels with vectorised Otsu thresholding.
      4. Extract 6 texture/spatial features per valid pixel:
            raw_db · local_mean · local_std ·
            gradient_magnitude · local_contrast · homogeneity
      5. Stratified sub-sample (≤200 k pixels) for fast training.
      6. Train Random Forest (200 trees, all CPU cores, balanced weights).
      7. Predict flood mask in PREDICT_CHUNK-sized batches.
      8. Return flood stats + model metrics + feature importances.
    """
    raster_path = save_uploaded_file(file, "rf_pretrained")
    try:
        # ── 1. Validate band ──────────────────────────────────────────────
        info = raster_info(raster_path)
        if band < 1 or band > info["bands"]:
            raise HTTPException(
                status_code=400,
                detail=f"Band must be between 1 and {info['bands']}.",
            )

        # ── 2. Tiled read — memory-efficient for large GeoTIFFs ───────────
        features, valid, profile = read_features_tiled(raster_path, [band])

        if not valid.any():
            raise HTTPException(
                status_code=400,
                detail="The raster band contains no valid pixels.",
            )

        # ── 3. Convert to dB & generate pseudo-labels via Otsu ───────────
        db_vals   = db_features(features, value_scale)   # H×W×1
        flat_vals = db_vals[valid, 0]                    # 1-D array

        otsu_t        = otsu_threshold(flat_vals)
        pseudo_labels = np.zeros(valid.shape, dtype="uint8")
        pseudo_labels[valid] = (flat_vals <= otsu_t).astype("uint8")

        # Fallback if Otsu produces only one class (very homogeneous scene)
        if len(np.unique(pseudo_labels[valid])) < 2:
            # Label bottom 30% of backscatter values as flooded
            fallback_t = float(np.percentile(flat_vals, 30))
            mask_fb, _ = threshold_mask(features, valid, fallback_t, value_scale)
            pseudo_labels = mask_fb.astype("uint8")

        if len(np.unique(pseudo_labels[valid])) < 2:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Could not generate two-class pseudo-labels for this raster. "
                    "The scene may be entirely flooded or entirely dry."
                ),
            )

        # ── 4–6. Extract 6 texture features + train RF ────────────────────
        model, _, metrics = train_random_forest(
            features,
            valid,
            pseudo_labels,
            value_scale=value_scale,
            use_texture=True,   # ← enables 6-feature extraction
        )

        # ── 7. Chunked prediction ─────────────────────────────────────────
        mask = predict(model, features, valid, value_scale, use_texture=True)

        # ── 8. Compute stats ──────────────────────────────────────────────
        flooded_pixels = int(mask.sum())
        valid_pixels   = int(valid.sum())
        percentage     = 100.0 * flooded_pixels / max(valid_pixels, 1)

        # Feature importances (available after training)
        importances = {
            name: round(float(imp), 6)
            for name, imp in zip(
                metrics.get("features_used", FEATURE_NAMES),
                model.feature_importances_,
            )
        }

        result = {
            "success":              True,
            "method":               "Random Forest · 6-feature multi-texture",
            "otsu_threshold_db":    round(float(otsu_t), 4),
            "flooded_pixels":       flooded_pixels,
            "valid_pixels":         valid_pixels,
            "flooded_percentage":   round(percentage, 4),
            "feature_importances":  importances,
            "metrics": {
                "accuracy":     round(metrics["accuracy"],  4),
                "precision":    round(metrics["precision"], 4),
                "recall":       round(metrics["recall"],    4),
                "f1":           round(metrics["f1"],        4),
                "iou":          round(metrics["iou"],       4),
                "train_pixels": metrics["train_pixels"],
                "test_pixels":  metrics["test_pixels"],
                "n_estimators": metrics.get("n_estimators", 200),
                "features":     metrics.get("features_used", FEATURE_NAMES),
            },
        }

        # Area + risk (only possible with a projected CRS)
        try:
            flooded_area = calculate_area(mask & valid, profile)
            total_area   = calculate_area(valid, profile)
            risk         = risk_summary(flooded_area, total_area, percentage)
            result["flooded_area_km2"] = round(flooded_area, 4)
            result["total_area_km2"]   = round(total_area,   4)
            result["risk"]             = risk
        except ValueError as exc:
            result["area_error"] = str(exc)
            result["risk"]       = None

        return result

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"RF-pretrained detection failed: {exc}",
        )
    finally:
        raster_path.unlink(missing_ok=True)


@app.post("/api/flood/detect-pretrained")
def detect_flood_pretrained(
    file: UploadFile = File(...),
    band: int = Form(1),
    value_scale: str = Form("dB"),
):
    """
    Run flood detection using the bundled pretrained Random Forest weights.
    No label upload needed — just the SAR raster.

    Pipeline:
      1. Load pretrained RF + StandardScaler from weights/.
      2. Read SAR raster via tiled loader.
      3. Extract 6 SAR texture features per valid pixel.
      4. Apply StandardScaler (required by the pretrained model).
      5. Predict flood mask in chunks.
      6. Return flood stats + risk summary.
    """
    if not PRETRAINED_MODEL_PATH.is_file() or not PRETRAINED_SCALER_PATH.is_file():
        raise HTTPException(
            status_code=503,
            detail=(
                "Pretrained weights not found on server. "
                f"Expected: {PRETRAINED_MODEL_PATH} and {PRETRAINED_SCALER_PATH}"
            ),
        )

    raster_path = save_uploaded_file(file, "pretrained")
    try:
        info = raster_info(raster_path)
        if band < 1 or band > info["bands"]:
            raise HTTPException(status_code=400, detail=f"Band must be between 1 and {info['bands']}.")

        pt_model, pt_scaler = load_pretrained_model()

        features, valid, profile = read_features_tiled(raster_path, [band])
        if not valid.any():
            raise HTTPException(status_code=400, detail="The raster band contains no valid pixels.")

        mask = predict(pt_model, features, valid, value_scale, use_texture=True, scaler=pt_scaler)

        flooded_pixels = int(mask.sum())
        valid_pixels   = int(valid.sum())
        percentage     = 100.0 * flooded_pixels / max(valid_pixels, 1)

        result = {
            "success":            True,
            "method":             "Pretrained Random Forest (bundled weights)",
            "n_estimators":       pt_model.n_estimators,
            "features":           FEATURE_NAMES,
            "flooded_pixels":     flooded_pixels,
            "valid_pixels":       valid_pixels,
            "flooded_percentage": round(percentage, 4),
        }
        try:
            flooded_area = calculate_area(mask & valid, profile)
            total_area   = calculate_area(valid, profile)
            risk         = risk_summary(flooded_area, total_area, percentage)
            result["flooded_area_km2"] = round(flooded_area, 4)
            result["total_area_km2"]   = round(total_area, 4)
            result["risk"]             = risk
        except ValueError as exc:
            result["area_error"] = str(exc)
            result["risk"]       = None
        return result

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Pretrained RF detection failed: {exc}")
    finally:
        raster_path.unlink(missing_ok=True)


@app.post("/api/flood/detect-pretrained-bundled")
def detect_flood_pretrained_bundled(
    band: int = Form(1),
    value_scale: str = Form("dB"),
):
    """
    Run pretrained RF flood detection on the bundled SAR raster — no upload needed.
    """
    if not BUNDLED_RASTER_PATH.exists():
        raise HTTPException(status_code=404, detail="Bundled SAR raster not found on server.")
    if not PRETRAINED_MODEL_PATH.is_file() or not PRETRAINED_SCALER_PATH.is_file():
        raise HTTPException(
            status_code=503,
            detail="Pretrained weights not found on server.",
        )
    try:
        info = raster_info(BUNDLED_RASTER_PATH)
        if band < 1 or band > info["bands"]:
            raise HTTPException(status_code=400, detail=f"Band must be between 1 and {info['bands']}.")

        pt_model, pt_scaler = load_pretrained_model()

        features, valid, profile = read_features_tiled(BUNDLED_RASTER_PATH, [band])
        if not valid.any():
            raise HTTPException(status_code=400, detail="No valid pixels in bundled raster.")

        # Auto-detect dB vs linear scale
        detected_scale = _auto_detect_scale(features[valid, 0])
        eff_scale      = detected_scale if value_scale == "dB" else value_scale

        mask = predict(pt_model, features, valid, eff_scale, use_texture=True, scaler=pt_scaler)

        flooded_pixels = int(mask.sum())
        valid_pixels   = int(valid.sum())
        percentage     = 100.0 * flooded_pixels / max(valid_pixels, 1)

        result = {
            "success":            True,
            "method":             "Pretrained Random Forest (bundled weights)",
            "n_estimators":       pt_model.n_estimators,
            "features":           FEATURE_NAMES,
            "value_scale":        eff_scale,
            "detected_scale":     detected_scale,
            "flooded_pixels":     flooded_pixels,
            "valid_pixels":       valid_pixels,
            "flooded_percentage": round(percentage, 4),
            "source":             "bundled",
            "filename":           _RASTER_FILENAME,
        }
        try:
            flooded_area = calculate_area(mask & valid, profile)
            total_area   = calculate_area(valid, profile)
            risk         = risk_summary(flooded_area, total_area, percentage)
            result["flooded_area_km2"] = round(flooded_area, 4)
            result["total_area_km2"]   = round(total_area, 4)
            result["risk"]             = risk
        except ValueError as exc:
            result["area_error"] = str(exc)
            result["risk"]       = None
        return result

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Bundled pretrained RF detection failed: {exc}")


# ============================================================
# GEE RANDOM FOREST — MODEL STATUS
# ============================================================

@app.get("/api/model/status")
def model_status():
    """
    Report whether the GEE-based pretrained RF model is ready.

    Returns model version, expected feature names, whether the GEE feature
    raster is accessible, and clear diagnostics if anything is missing.
    """
    try:
        status = get_model_status()
        return status
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve model status: {exc}",
        )


# ============================================================
# GEE RANDOM FOREST — FLOOD-CANDIDATE PREDICTION
# ============================================================

class PredictRequest(BaseModel):
    output_filename: str | None = Field(
        default=None,
        description="Optional output filename stem (no extension, no path). "
                    "Defaults to a UUID-based name.",
        max_length=128,
        pattern=r"^[A-Za-z0-9_\-]*$",
    )


@app.post("/api/flood/predict")
def flood_predict(request: PredictRequest = PredictRequest()):
    """
    Run the GEE-based pretrained Random Forest over the configured feature raster.

    Pipeline
    --------
    1. Locate patna_s1_features_aug2026.tif (env var or well-known path).
    2. Validate 6-band feature order (beforeVV/afterVV/beforeVH/afterVH/vvChange/vhChange).
    3. Apply StandardScaler then predict in 256-row tiles / 500 k-pixel chunks.
    4. Write georeferenced uint8 output GeoTIFF to outputs/predictions/.
    5. Return statistics and the output filename.

    Note: outputs are labelled "flood-candidate pixels", NOT confirmed flooding.
    The training labels are threshold-generated candidates from GEE.
    """
    try:
        result = predict_flood_candidates(
            output_filename=request.output_filename,
        )
        return {
            "success":              True,
            "method":               "GEE Random Forest (pretrained)",
            "feature_names":        ["beforeVV", "afterVV", "beforeVH",
                                     "afterVH", "vvChange", "vhChange"],
            "candidate_pixels":     result["candidate_pixels"],
            "valid_pixels":         result["valid_pixels"],
            "candidate_percentage": result["candidate_percentage"],
            "raster":               result["raster"],
            "output_filename":      result["output_filename"],
            "label_warning": (
                "Output pixels labelled 1 are flood CANDIDATES based on "
                "SAR backscatter change detection. They are not confirmed flooding."
            ),
        }
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=(
                f"{exc}\n\n"
                "To fix: download patna_s1_features_aug2026.tif from Google Drive "
                "and place it in EPICS--main/datasets/, or set "
                "HYDROSHIELD_FEATURE_RASTER=/absolute/path/to/file.tif "
                "in your .env file."
            ),
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Model not ready: {exc}",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {exc}",
        )


@app.get("/api/flood/candidates/overlay")
def flood_candidates_overlay():
    from pathlib import Path
    from fastapi import HTTPException
    import numpy as np

    predictions_dir = (
        Path(__file__).resolve().parent
        / "outputs"
        / "predictions"
    )

    files = sorted(
        predictions_dir.glob("flood_candidates_*.tif"),
        key=lambda file: file.stat().st_mtime,
        reverse=True,
    )

    if not files:
        raise HTTPException(
            status_code=404,
            detail="No flood prediction raster found. Run prediction first.",
        )

    raster_path = files[0]

    try:
        with rasterio.open(raster_path) as src:
            if src.crs is None:
                raise HTTPException(
                    status_code=422,
                    detail="Prediction raster has no coordinate reference system.",
                )

            scale = min(1.0, 1200 / max(src.width, src.height))
            width = max(1, int(src.width * scale))
            height = max(1, int(src.height * scale))

            mask = src.read(
                1,
                out_shape=(height, width),
                resampling=Resampling.nearest,
            )

            bounds = transform_bounds(
                src.crs,
                "EPSG:4326",
                *src.bounds,
            )

        rgba = np.zeros((height, width, 4), dtype=np.uint8)
        rgba[mask == 1] = [239, 68, 68, 165]

        image_buffer = BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(
            image_buffer,
            format="PNG",
            optimize=True,
        )

        image_data = base64.b64encode(
            image_buffer.getvalue()
        ).decode("ascii")

        return {
            "success": True,
            "filename": raster_path.name,
            "image": f"data:image/png;base64,{image_data}",
            "bounds": [
                [bounds[1], bounds[0]],
                [bounds[3], bounds[2]],
            ],
            "label_warning": (
                "Red areas are flood candidates, not confirmed flooding."
            ),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not create flood overlay: {exc}",
        )



@app.post("/api/assistant")
async def assistant_chat(request: AssistantRequest):
    """
    Real HydroShield AI conversational assistant.

    Accepts arbitrary natural-language questions and sends
    the conversation to the OpenAI Responses API.
    """

    if openai_client is None:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is not configured on the backend."
        )

    message = request.message.strip()

    if not message:
        raise HTTPException(
            status_code=400,
            detail="Message cannot be empty."
        )

    developer_instructions = """
You are HydroShield AI Assistant, the conversational AI component
of the HydroShield AI disaster-management project.

Your primary domain is:
- Flood detection
- Flood-risk analysis
- Sentinel-1 SAR imagery
- GeoAI
- Random Forest flood classification
- Threshold-based flood detection
- Flooded-area calculation
- Flood-risk interpretation
- Disaster-response planning
- Emergency shelters and relief centres
- Flood-aware routing
- Road accessibility
- Geospatial data
- OpenStreetMap
- GIS
- Remote sensing
- AI/ML concepts
- HydroShield project architecture
- Explaining the project to students, reviewers and users

PROJECT CONTEXT:

HydroShield AI is a flood-management and disaster-response
decision-support prototype.

The current technical workflow can include:

Sentinel-1 GRD raster
        ↓
Raster preprocessing
        ↓
SAR feature extraction
        ↓
Flood detection
        ↓
Flood mask
        ↓
Flooded area calculation
        ↓
Risk classification
        ↓
Alerts / maps / analytics
        ↓
Flood-aware routing and shelter assistance

The flood-detection backend supports:
1. Exploratory threshold-based detection.
2. Random Forest classification when an aligned labelled
   raster dataset is supplied.

The backend is implemented in Python and exposes FastAPI
endpoints. The frontend is React/Vite.

The system also contains modules for:
- Dashboard
- Flood Map
- Alerts
- Shelters
- Routing
- Analytics
- AI Assistant

IMPORTANT BEHAVIOR:

1. Answer arbitrary user questions naturally.
2. Do NOT restrict yourself to predefined questions.
3. If the user asks something unrelated to HydroShield,
   you may answer it normally when appropriate.
4. If the question requires current real-world information
   that you do not have, clearly state that limitation.
5. Never invent live flood conditions, shelter occupancy,
   emergency alerts, rainfall measurements, satellite data,
   or evacuation orders.
6. Do not claim that HydroShield has live data unless live data
   has actually been supplied to the application.
7. Distinguish between the project's implemented prototype
   capabilities and future/planned capabilities.
8. Explain technical concepts at the user's requested level.
9. When explaining the HydroShield project, use terminology
   consistent with its actual architecture.
10. For real emergencies, advise users to follow official
    emergency authorities rather than treating this assistant
    as an emergency service.
11. Be concise by default but provide enough explanation to
    answer the question properly.
12. If the user asks a follow-up question, use the previous
    conversation context.
"""

    # Keep a reasonable amount of conversation history.
    history = request.history[-12:]

    conversation_input = []

    for item in history:
        if item.role not in ("user", "assistant"):
            continue

        content = item.content.strip()

        if not content:
            continue

        conversation_input.append(
            {
                "role": item.role,
                "content": content,
            }
        )

    # Add the newest user message.
    conversation_input.append(
        {
            "role": "user",
            "content": message,
        }
    )

    try:
        messages = [{"role": "system", "content": developer_instructions}] + conversation_input
        response = openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
        )
        answer = response.choices[0].message.content.strip()

        if not answer:
            answer = (
                "I couldn't generate a response for that question."
            )

        return {
            "success": True,
            "answer": answer,
            "model": OPENAI_MODEL,
        }

    except RateLimitError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "The AI provider quota or rate limit has been reached. "
                "Try again later or check the configured account."
            ),
        ) from exc

    except APIConnectionError as exc:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to the AI provider. Please try again later.",
        ) from exc

    except APIStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                f"The AI provider returned an error (HTTP {exc.status_code}). "
                "Please try again later."
            ),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="AI assistant request failed. Please try again.",
        ) from exc