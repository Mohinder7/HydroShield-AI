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

import rasterio

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from src.pipeline import (
    calculate_area,
    otsu_threshold,
    predict,
    raster_info,
    read_features,
    risk_summary,
    threshold_mask,
    train_random_forest,
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

@app.get("/api/datasets/raster")
def serve_bundled_raster():
    """Serve the bundled peak_flood_subset SAR raster."""
    path = DATASETS_DIR / "sar" / "peak_flood_subset.tif"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Bundled raster not found.")
    return FileResponse(str(path), media_type="image/tiff", filename="peak_flood_subset.tif")

@app.get("/api/datasets/roads")
def serve_bundled_roads():
    """Serve the bundled Patna roads GeoJSON."""
    path = DATASETS_DIR / "roads" / "patna_roads.geojson"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Bundled roads not found.")
    return FileResponse(str(path), media_type="application/json", filename="patna_roads.geojson")

@app.get("/api/datasets/shelters")
def serve_bundled_shelters():
    """Serve the bundled Patna shelters GeoJSON."""
    path = DATASETS_DIR / "shelters" / "patna_shelters.geojson"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Bundled shelters not found.")
    return FileResponse(str(path), media_type="application/json", filename="patna_shelters.geojson")


@app.post("/api/flood/rf-pretrained")
def rf_pretrained_detection(
    file: UploadFile = File(...),
    band: int = Form(1),
    value_scale: str = Form("dB"),
):
    """
    Pretrained Random Forest using Otsu-generated pseudo-labels.
    No labelled data required.
    """
    raster_path = save_uploaded_file(file, "rf_pretrained")
    try:
        info = raster_info(raster_path)
        if band < 1 or band > info["bands"]:
            raise HTTPException(status_code=400, detail=f"Band must be between 1 and {info['bands']}.")

        features, valid, profile = read_features(raster_path, [band])

        if not valid.any():
            raise HTTPException(status_code=400, detail="The raster band contains no valid pixels.")

        # Use db features for thresholding and training
        from src.pipeline import db_features as _db_features
        db_vals = _db_features(features, value_scale)
        flat_vals = db_vals[valid, 0]

        # Auto-generate pseudo-labels using Otsu thresholding
        otsu_t = otsu_threshold(flat_vals)
        pseudo_labels = np.zeros(valid.shape, dtype="uint8")
        pseudo_labels[valid] = (db_vals[..., 0][valid] <= otsu_t).astype("uint8")

        # Need at least 2 classes for RF training
        ys = pseudo_labels[valid]
        if len(np.unique(ys)) < 2:
            # fallback: use threshold_mask result
            mask_fb, _ = threshold_mask(features, valid, -17.0, value_scale)
            pseudo_labels = mask_fb.astype("uint8")
            ys = pseudo_labels[valid]

        if len(np.unique(ys)) < 2:
            raise HTTPException(status_code=400, detail="Could not generate two-class pseudo-labels for this raster.")

        model, _, metrics = train_random_forest(features, valid, pseudo_labels, value_scale)
        mask = predict(model, features, valid, value_scale)

        flooded_pixels = int(mask.sum())
        valid_pixels = int(valid.sum())
        percentage = 100.0 * flooded_pixels / max(valid_pixels, 1)

        result = {
            "success": True,
            "method": "Random Forest (Otsu pseudo-labels)",
            "otsu_threshold_db": round(float(otsu_t), 4),
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
            flooded_area = calculate_area(mask & valid, profile)
            total_area = calculate_area(valid, profile)
            risk = risk_summary(flooded_area, total_area, percentage)
            result["flooded_area_km2"] = round(flooded_area, 4)
            result["total_area_km2"] = round(total_area, 4)
            result["risk"] = risk
        except ValueError as exc:
            result["area_error"] = str(exc)
            result["risk"] = None

        return result

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"RF-pretrained detection failed: {exc}")
    finally:
        raster_path.unlink(missing_ok=True)


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