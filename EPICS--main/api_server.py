from pathlib import Path
import tempfile
import shutil
import geopandas as gpd
from rasterio.warp import transform as reproject_coords

from src.routing import load_vectors, route

import numpy as np
import rasterio

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.pipeline import (
    calculate_area,
    predict,
    raster_info,
    read_features,
    risk_summary,
    threshold_mask,
    train_random_forest,
)

from src.routing import load_vectors, route


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="HydroShield AI API",
    description="Backend API for HydroShield AI flood analysis and routing",
    version="1.0.0",
)


# ============================================================
# CORS
# Allows the React frontend to communicate with this backend.
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
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

    safe_name = Path(uploaded_file.filename).name
    file_path = TEMP_DIR / f"{prefix}_{safe_name}"

    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(uploaded_file.file, buffer)

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not save uploaded file: {exc}",
        )

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
            "bounds": [
                info["bounds"].left,
                info["bounds"].bottom,
                info["bounds"].right,
                info["bounds"].top,
            ],
        }

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not inspect raster: {exc}",
        )

    finally:
        raster_path.unlink(missing_ok=True)


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

        model, train_valid, metrics = train_random_forest(
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
            "GET /api/shelters",
        ],
    }

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
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix="hydroshield_route_"))

        raster_path = temp_dir / raster.filename
        roads_path = temp_dir / roads.filename
        shelters_path = temp_dir / shelters.filename

        raster_path.write_bytes(await raster.read())
        roads_path.write_bytes(await roads.read())
        shelters_path.write_bytes(await shelters.read())

        # -----------------------------------------
        # 1. Read Sentinel-1 raster
        # -----------------------------------------
        info = raster_info(raster_path)

        features, valid, profile = read_features(
            raster_path,
            [band]
        )

        if not valid.any():
            raise ValueError("The raster contains no valid pixels.")

        # -----------------------------------------
        # 2. Generate flood mask
        # -----------------------------------------
        mask = threshold_mask(
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
        result, source_node, road_parts, flooded_roads = route(
            roads_gdf,
            shelters_gdf,
            mask,
            valid,
            profile["transform"],
            start_xy,
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