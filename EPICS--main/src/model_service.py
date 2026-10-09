"""
model_service.py
================
GEE-based pretrained Random Forest flood-candidate prediction service.

This module is SEPARATE from the texture-based model in pipeline.py.
It handles the six-band Sentinel-1 change-detection feature set exported
from Google Earth Engine:

    Band order (must match training exactly):
        0  beforeVV   — pre-event VV backscatter (dB)
        1  afterVV    — post-event VV backscatter (dB)
        2  beforeVH   — pre-event VH backscatter (dB)
        3  afterVH    — post-event VH backscatter (dB)
        4  vvChange   — afterVV − beforeVV (dB change)
        5  vhChange   — afterVH − beforeVH (dB change)

Important caveats
-----------------
* Training labels are threshold-generated flood CANDIDATES, not verified
  ground truth.  Outputs should be labelled "flood-candidate pixels",
  never "confirmed flooding".
* The model is loaded once (lazy singleton) and reused for all requests.
* Inference runs in TILE_ROWS-sized horizontal strips to avoid loading
  the full raster into RAM.
* Missing pixels (NaN / nodata) are never classified — they receive
  nodata value 255 in the output raster.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import rasterio
import rasterio.windows
from rasterio.transform import from_bounds
from rasterio.crs import CRS

logger = logging.getLogger(__name__)

# ── paths ──────────────────────────────────────────────────────────────────────
_BACKEND_ROOT   = Path(__file__).resolve().parent.parent          # EPICS--main/
_WEIGHTS_DIR    = _BACKEND_ROOT / "weights"
_MODEL_PATH     = _WEIGHTS_DIR / "random_forest_model.joblib"
_SCALER_PATH    = _WEIGHTS_DIR / "scaler.joblib"
_META_PATH      = _BACKEND_ROOT / "model_meta.json"

# ── tunables ───────────────────────────────────────────────────────────────────
TILE_ROWS       = 256          # row-block height for tiled inference
PREDICT_CHUNK   = 500_000      # pixels per model.predict() call
NODATA_OUT      = 255          # output nodata value (uint8)

# ── expected feature contract ──────────────────────────────────────────────────
FEATURE_NAMES   = [
    "beforeVV",
    "afterVV",
    "beforeVH",
    "afterVH",
    "vvChange",
    "vhChange",
]
N_FEATURES      = len(FEATURE_NAMES)   # 6

# ── output directory (overridable via env var) ─────────────────────────────────
def _output_dir() -> Path:
    raw = os.getenv("HYDROSHIELD_OUTPUT_DIR", str(_BACKEND_ROOT / "outputs" / "predictions"))
    p = Path(raw)
    p.mkdir(parents=True, exist_ok=True)
    return p


# ══════════════════════════════════════════════════════════════════════════════
#  LAZY SINGLETON MODEL LOADER
# ══════════════════════════════════════════════════════════════════════════════

class _ModelState:
    """Thread-safe lazy loader for the RF model and scaler."""

    def __init__(self) -> None:
        self._lock   = threading.Lock()
        self._model  = None
        self._scaler = None
        self._meta   : dict[str, Any] = {}
        self._error  : str | None = None
        self._loaded = False

    def load(self) -> None:
        """Load model, scaler, and metadata; store any error for status reporting."""
        with self._lock:
            if self._loaded:
                return
            self._loaded = True   # prevent re-entry even on failure
            try:
                if not _MODEL_PATH.is_file():
                    raise FileNotFoundError(
                        f"Model artifact not found: {_MODEL_PATH}\n"
                        "Run train_model.py to generate it, or place "
                        "random_forest_model.joblib in weights/."
                    )
                if not _SCALER_PATH.is_file():
                    raise FileNotFoundError(
                        f"Scaler artifact not found: {_SCALER_PATH}\n"
                        "Run train_model.py to regenerate it."
                    )
                model  = joblib.load(_MODEL_PATH)
                scaler = joblib.load(_SCALER_PATH)

                if model.n_features_in_ != N_FEATURES:
                    raise ValueError(
                        f"Model expects {model.n_features_in_} features; "
                        f"service provides {N_FEATURES} ({FEATURE_NAMES})."
                    )
                if scaler.n_features_in_ != N_FEATURES:
                    raise ValueError(
                        f"Scaler expects {scaler.n_features_in_} features; "
                        f"service provides {N_FEATURES}."
                    )

                self._model  = model
                self._scaler = scaler
                if _META_PATH.is_file():
                    with open(_META_PATH, encoding="utf-8") as fh:
                        self._meta = json.load(fh)
                logger.info(
                    "GEE RF model loaded: %d trees, %d features",
                    model.n_estimators, model.n_features_in_,
                )
            except Exception as exc:
                self._error = str(exc)
                logger.error("Failed to load GEE RF model: %s", exc)

    @property
    def ready(self) -> bool:
        return self._model is not None and self._scaler is not None

    @property
    def model(self):
        return self._model

    @property
    def scaler(self):
        return self._scaler

    @property
    def meta(self) -> dict[str, Any]:
        return self._meta

    @property
    def error(self) -> str | None:
        return self._error


_state = _ModelState()


def ensure_loaded() -> None:
    """Call once at app startup (or lazily on first request)."""
    _state.load()


# ══════════════════════════════════════════════════════════════════════════════
#  FEATURE RASTER RESOLUTION
# ══════════════════════════════════════════════════════════════════════════════

def _resolve_feature_raster() -> Path | None:
    """
    Find the GEE feature raster using env var or well-known filenames.
    Returns None if not found (caller handles missing-file response).
    """
    env_path = os.getenv("HYDROSHIELD_FEATURE_RASTER", "")
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return p
        logger.warning("HYDROSHIELD_FEATURE_RASTER set but file missing: %s", p)

    # Search well-known locations relative to backend root
    candidates = [
        _BACKEND_ROOT / "datasets" / "patna_s1_features_aug2026.tif",
        _BACKEND_ROOT.parent / "datasets" / "patna_s1_features_aug2026.tif",
        _BACKEND_ROOT / "data" / "patna_s1_features_aug2026.tif",
    ]
    # Also accept any *_features_*.tif in datasets/
    dataset_dirs = [
        _BACKEND_ROOT / "datasets",
        _BACKEND_ROOT.parent / "datasets",
    ]
    for d in dataset_dirs:
        if d.is_dir():
            for p in sorted(d.glob("**/*features*.tif")):
                candidates.append(p)

    for c in candidates:
        if c.is_file():
            logger.info("Found feature raster: %s", c)
            return c
    return None


def _resolve_mask_raster() -> Path | None:
    """
    Find the GEE candidate-mask raster using env var or well-known filenames.
    """
    env_path = os.getenv("HYDROSHIELD_MASK_RASTER", "")
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return p

    candidates = [
        _BACKEND_ROOT / "datasets" / "patna_flood_candidates_aug2026.tif",
        _BACKEND_ROOT.parent / "datasets" / "patna_flood_candidates_aug2026.tif",
        _BACKEND_ROOT / "data" / "patna_flood_candidates_aug2026.tif",
    ]
    dataset_dirs = [
        _BACKEND_ROOT / "datasets",
        _BACKEND_ROOT.parent / "datasets",
    ]
    for d in dataset_dirs:
        if d.is_dir():
            for p in sorted(d.glob("**/*candidates*.tif")):
                candidates.append(p)

    for c in candidates:
        if c.is_file():
            return c
    return None


# ══════════════════════════════════════════════════════════════════════════════
#  RASTER VALIDATION
# ══════════════════════════════════════════════════════════════════════════════

def validate_feature_raster(path: Path) -> dict[str, Any]:
    """
    Open the feature raster and return basic metadata.
    Raises ValueError if band count is wrong.
    """
    with rasterio.open(path) as src:
        if src.count != N_FEATURES:
            raise ValueError(
                f"Feature raster has {src.count} bands; expected {N_FEATURES} "
                f"({FEATURE_NAMES}). Check the GEE export."
            )
        return {
            "bands":     src.count,
            "width":     src.width,
            "height":    src.height,
            "crs":       str(src.crs) if src.crs else "Missing CRS",
            "bounds":    list(src.bounds),
            "dtype":     str(src.dtypes[0]),
            "nodata":    src.nodata,
            "transform": list(src.transform)[:6],
        }


# ══════════════════════════════════════════════════════════════════════════════
#  TILED INFERENCE
# ══════════════════════════════════════════════════════════════════════════════

def _row_windows(height: int, width: int, tile_rows: int = TILE_ROWS):
    """Yield rasterio Windows covering the full raster in horizontal strips."""
    for row_off in range(0, height, tile_rows):
        rows = min(tile_rows, height - row_off)
        yield rasterio.windows.Window(0, row_off, width, rows)


def _predict_chunk(model, scaler, x: np.ndarray) -> np.ndarray:
    """Predict in PREDICT_CHUNK batches; returns uint8 array."""
    n = len(x)
    out = np.empty(n, dtype="uint8")
    for start in range(0, n, PREDICT_CHUNK):
        end = min(start + PREDICT_CHUNK, n)
        scaled = scaler.transform(x[start:end])
        out[start:end] = model.predict(scaled).astype("uint8")
    return out


def run_inference(
    feature_path: Path,
    output_path: Path,
    tile_rows: int = TILE_ROWS,
) -> dict[str, Any]:
    """
    Run tiled inference over the feature raster and write a uint8 output GeoTIFF.

    Parameters
    ----------
    feature_path : Path to the 6-band GEE feature raster.
    output_path  : Where to write the prediction raster (uint8, deflate).
    tile_rows    : Height of each processing tile.

    Returns
    -------
    dict with candidate_pixels, valid_pixels, candidate_percentage,
    raster metadata, and output_path.
    """
    ensure_loaded()
    if not _state.ready:
        raise RuntimeError(f"Model not loaded: {_state.error}")

    model  = _state.model
    scaler = _state.scaler

    with rasterio.open(feature_path) as src:
        if src.count != N_FEATURES:
            raise ValueError(
                f"Feature raster has {src.count} bands; expected {N_FEATURES}."
            )

        H, W   = src.height, src.width
        crs    = src.crs
        transform = src.transform
        nodata = src.nodata
        profile = src.profile.copy()

        # Output profile: uint8, single band, deflate compression
        out_profile = profile.copy()
        out_profile.update(
            count=1,
            dtype="uint8",
            nodata=NODATA_OUT,
            compress="deflate",
            predictor=2,
            tiled=True,
            blockxsize=256,
            blockysize=256,
        )

        candidate_pixels = 0
        valid_pixels     = 0

        # Write output tile-by-tile
        with rasterio.open(output_path, "w", **out_profile) as dst:
            for win in _row_windows(H, W, tile_rows):
                r0   = win.row_off
                rows = win.height

                # Read all 6 bands for this tile: shape (6, rows, W)
                tile_data = src.read(
                    list(range(1, N_FEATURES + 1)),
                    window=win,
                    masked=True,
                ).astype("float32")   # (6, rows, W)

                # Replace masked/nodata with NaN
                tile_arr = tile_data.filled(np.nan)   # (6, rows, W)

                # Transpose to (rows, W, 6) then reshape to (rows*W, 6)
                pixels = tile_arr.transpose(1, 2, 0).reshape(-1, N_FEATURES)

                # Valid mask: all 6 features are finite
                valid_mask_flat = np.isfinite(pixels).all(axis=1)
                valid_pixels   += int(valid_mask_flat.sum())

                # Output tile, default nodata
                out_tile = np.full(rows * W, NODATA_OUT, dtype="uint8")

                if valid_mask_flat.any():
                    x_valid = pixels[valid_mask_flat]
                    preds   = _predict_chunk(model, scaler, x_valid)
                    out_tile[valid_mask_flat] = preds
                    candidate_pixels += int((preds == 1).sum())

                out_tile_2d = out_tile.reshape(rows, W)
                dst.write(out_tile_2d, 1, window=win)

    pct = 100.0 * candidate_pixels / max(valid_pixels, 1)
    return {
        "candidate_pixels":    candidate_pixels,
        "valid_pixels":        valid_pixels,
        "candidate_percentage": round(pct, 4),
        "raster": {
            "width":     W,
            "height":    H,
            "crs":       str(crs) if crs else "Missing CRS",
            "bounds":    list(rasterio.open(feature_path).bounds),
            "transform": list(transform)[:6],
        },
        "output_filename": output_path.name,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  PUBLIC API
# ══════════════════════════════════════════════════════════════════════════════

def get_model_status() -> dict[str, Any]:
    """
    Return a diagnostics dictionary suitable for the /api/model/status endpoint.
    Does NOT load the model itself; call ensure_loaded() at startup for that.
    """
    ensure_loaded()   # lazy load on first status check

    feature_raster = _resolve_feature_raster()
    mask_raster    = _resolve_mask_raster()

    raster_info: dict[str, Any] = {}
    raster_error = None
    if feature_raster:
        try:
            raster_info = validate_feature_raster(feature_raster)
        except Exception as exc:
            raster_error = str(exc)

    meta = _state.meta

    return {
        "model_ready":           _state.ready,
        "model_error":           _state.error,
        "model_path":            str(_MODEL_PATH.relative_to(_BACKEND_ROOT)),
        "scaler_path":           str(_SCALER_PATH.relative_to(_BACKEND_ROOT)),
        "model_exists":          _MODEL_PATH.is_file(),
        "scaler_exists":         _SCALER_PATH.is_file(),
        "model_version":         meta.get("model_version", "unknown"),
        "training_date":         meta.get("training_date", "unknown"),
        "feature_names":         FEATURE_NAMES,
        "n_features":            N_FEATURES,
        "n_estimators":          _state.model.n_estimators if _state.ready else None,
        "label_warning":         meta.get("label_warning", ""),
        "feature_raster_found":  feature_raster is not None,
        "feature_raster_path":   str(feature_raster) if feature_raster else None,
        "feature_raster_info":   raster_info,
        "feature_raster_error":  raster_error,
        "mask_raster_found":     mask_raster is not None,
        "mask_raster_path":      str(mask_raster) if mask_raster else None,
        "output_dir":            str(_output_dir()),
    }


def predict_flood_candidates(output_filename: str | None = None) -> dict[str, Any]:
    """
    Locate the feature raster, run tiled inference, save output GeoTIFF.

    Parameters
    ----------
    output_filename : Optional stem for the output file.
                      Defaults to a UUID-based name.

    Returns
    -------
    Inference statistics dict (see run_inference) plus output_path key.

    Raises
    ------
    FileNotFoundError  if the feature raster cannot be found.
    RuntimeError       if the model is not loaded.
    ValueError         if the feature raster has wrong band count.
    """
    feature_path = _resolve_feature_raster()
    if feature_path is None:
        raise FileNotFoundError(
            "GEE feature raster not found. "
            "Download patna_s1_features_aug2026.tif from Google Drive and place it "
            "in EPICS--main/datasets/ or set the HYDROSHIELD_FEATURE_RASTER "
            "environment variable to its absolute path."
        )

    if output_filename:
        stem = Path(output_filename).stem
    else:
        stem = f"flood_candidates_{uuid.uuid4().hex[:8]}"

    out_path = _output_dir() / f"{stem}.tif"

    result = run_inference(feature_path, out_path)
    result["output_path"] = str(out_path)
    return result
