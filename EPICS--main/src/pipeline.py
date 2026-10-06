"""
Raster ingest, multi-feature SAR extraction, and flood mask generation.

Feature engineering:
  1. Raw dB backscatter value
  2. Local mean   (3×3 uniform window)
  3. Local std    (3×3 uniform window)
  4. Gradient magnitude (Sobel-style via numpy diff)
  5. GLCM-proxy texture contrast   (local range = max - min in 3×3)
  6. GLCM-proxy texture homogeneity (inverse of local range)

Lazy / memory-efficient loading:
  - read_features_tiled: streams the raster in row-blocks so very large
    GeoTIFFs never need to be fully resident in RAM.
  - extract_sar_features: operates on a 2-D float32 band already in memory
    using only numpy (no extra dependencies).

Training optimisations:
  - RandomForestClassifier uses n_jobs=-1 (all cores).
  - For large pixel counts the training set is capped at MAX_TRAIN_PIXELS
    using stratified sampling; the full valid array is still predicted.
  - predict_in_chunks: predicts the flat feature matrix in chunks so the
    RF never needs to materialise a huge temporary array.
"""

from __future__ import annotations

import math
from functools import lru_cache
from typing import Generator

import numpy as np
import rasterio
import rasterio.windows
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    jaccard_score,
    precision_score,
    recall_score,
)

# ── tunables ──────────────────────────────────────────────────────────────────
MAX_TRAIN_PIXELS = 200_000   # cap for RF training (stratified sub-sample)
PREDICT_CHUNK    = 500_000   # pixels per predict() call to limit RAM spike
TILE_ROWS        = 512       # row block height for tiled reading
WINDOW_RADIUS    = 1         # half-size of the 3×3 neighbourhood (radius=1)
# ─────────────────────────────────────────────────────────────────────────────


# ══════════════════════════════════════════════════════════════════════════════
#  METADATA
# ══════════════════════════════════════════════════════════════════════════════

def raster_info(path):
    with rasterio.open(path) as src:
        return {
            "bands":        src.count,
            "width":        src.width,
            "height":       src.height,
            "crs":          str(src.crs) if src.crs else "Missing CRS",
            "bounds":       tuple(src.bounds),
            "descriptions": src.descriptions,
            "dtype":        src.dtypes[0],
            "nodata":       src.nodata,
            "transform":    src.transform,
        }


# ══════════════════════════════════════════════════════════════════════════════
#  CORE RASTER READING  (eager — loads entire raster into RAM)
# ══════════════════════════════════════════════════════════════════════════════

def read_features(path, band_indexes):
    """Read selected bands as float32 features (eager, full raster in RAM)."""
    with rasterio.open(path) as src:
        if not src.crs:
            raise ValueError(
                "The input raster has no CRS; "
                "geospatial area and routing require a CRS."
            )
        arrays = [
            src.read(i, masked=True).astype("float32").filled(np.nan)
            for i in band_indexes
        ]
        stack = np.stack(arrays, axis=-1)          # H × W × B
        valid = np.isfinite(stack).all(axis=-1)    # H × W  bool
        if valid.any() and not np.any(stack[valid] != 0):
            raise ValueError(
                "All valid raster pixels are zero; "
                "verify that the input contains Sentinel-1 backscatter data."
            )
        return stack, valid, src.profile.copy()


# ══════════════════════════════════════════════════════════════════════════════
#  LAZY / TILED RASTER READING  (memory-efficient for large GeoTIFFs)
# ══════════════════════════════════════════════════════════════════════════════

def _row_windows(height: int, width: int, tile_rows: int = TILE_ROWS
                 ) -> Generator[rasterio.windows.Window, None, None]:
    """Yield rasterio Windows covering the full raster in horizontal strips."""
    for row_off in range(0, height, tile_rows):
        rows = min(tile_rows, height - row_off)
        yield rasterio.windows.Window(0, row_off, width, rows)


def read_features_tiled(path, band_indexes, tile_rows: int = TILE_ROWS):
    """
    Memory-efficient tiled reader.

    Returns the same (stack, valid, profile) tuple as read_features but
    assembles the result tile-by-tile, keeping peak RAM usage proportional
    to one tile rather than the full scene.
    """
    with rasterio.open(path) as src:
        if not src.crs:
            raise ValueError(
                "The input raster has no CRS; "
                "geospatial area and routing require a CRS."
            )
        profile = src.profile.copy()
        H, W = src.height, src.width
        B = len(band_indexes)

        # Pre-allocate output arrays
        stack = np.full((H, W, B), np.nan, dtype="float32")
        valid = np.zeros((H, W), dtype=bool)

        for win in _row_windows(H, W, tile_rows):
            r0 = win.row_off
            rows = win.height
            for b_idx, band in enumerate(band_indexes):
                tile = src.read(
                    band,
                    window=win,
                    masked=True,
                ).astype("float32").filled(np.nan)
                stack[r0:r0 + rows, :, b_idx] = tile

        valid = np.isfinite(stack).all(axis=-1)

        # Sample-based zero check to avoid 1+ GB index array
        sample_idxs = np.argwhere(valid)
        if len(sample_idxs) > 0:
            sample_n = min(100_000, len(sample_idxs))
            rng = np.random.default_rng(0)
            chosen = sample_idxs[rng.choice(len(sample_idxs), sample_n, replace=False)]
            sample_vals = stack[chosen[:, 0], chosen[:, 1], :]
            if not np.any(sample_vals != 0):
                raise ValueError(
                    "All valid raster pixels are zero; "
                    "verify that the input contains Sentinel-1 backscatter data."
                )

    return stack, valid, profile


# ══════════════════════════════════════════════════════════════════════════════
#  dB CONVERSION
# ══════════════════════════════════════════════════════════════════════════════

def db_features(stack, value_scale="dB"):
    """Return features in dB using the operator-declared input scale."""
    if value_scale == "dB":
        return stack.copy()
    if value_scale != "Linear power":
        raise ValueError(
            "Select either dB or linear power based on the input product metadata."
        )
    return 10 * np.log10(np.maximum(stack, 1e-10))


# ══════════════════════════════════════════════════════════════════════════════
#  MULTI-FEATURE EXTRACTION  (pure numpy, no extra dependencies)
# ══════════════════════════════════════════════════════════════════════════════

def _uniform_mean(arr: np.ndarray, r: int = WINDOW_RADIUS) -> np.ndarray:
    """Fast box-filter mean using cumulative sum (O(N), not O(N·k²))."""
    cs = np.nancumsum(np.nancumsum(arr, axis=0), axis=1)
    H, W = arr.shape
    d = 2 * r + 1

    def _slice(cs, r0, r1, c0, c1):
        result = cs[r1, c1].copy()
        if r0 > 0:
            result -= cs[r0 - 1, c1]
        if c0 > 0:
            result -= cs[r1, c0 - 1]
        if r0 > 0 and c0 > 0:
            result += cs[r0 - 1, c0 - 1]
        return result

    out = np.full_like(arr, np.nan)
    r0 = r;  r1 = H - r - 1
    c0 = r;  c1 = W - r - 1
    if r1 < r0 or c1 < c0:
        return out
    out[r:H - r, r:W - r] = _slice(cs, r0, r1, c0, c1) / (d * d)
    return out


def _local_std(arr: np.ndarray, r: int = WINDOW_RADIUS) -> np.ndarray:
    """Local standard deviation: sqrt(E[X²] - E[X]²) via two box filters."""
    mean  = _uniform_mean(arr,       r)
    mean2 = _uniform_mean(arr ** 2,  r)
    var   = mean2 - mean ** 2
    # Clamp tiny negatives from floating-point error
    var   = np.where(var < 0, 0.0, var)
    return np.sqrt(var)


def _gradient_magnitude(arr: np.ndarray) -> np.ndarray:
    """Gradient magnitude using central differences (Sobel-like, numpy only)."""
    # Pad with NaN so border pixels stay NaN
    padded = np.pad(arr, 1, mode="constant", constant_values=np.nan)
    gx = (padded[1:-1, 2:] - padded[1:-1, :-2]) / 2.0
    gy = (padded[2:, 1:-1] - padded[:-2, 1:-1]) / 2.0
    return np.sqrt(gx ** 2 + gy ** 2)


def _local_range(arr: np.ndarray, r: int = WINDOW_RADIUS) -> np.ndarray:
    """
    Local range (max − min in 3×3 window) — proxy for GLCM contrast.
    Uses scipy.ndimage-free sliding window via numpy stride tricks.
    """
    H, W = arr.shape
    d = 2 * r + 1
    # Reflect-pad to handle borders
    padded = np.pad(arr, r, mode="reflect")
    out = np.full((H, W), np.nan, dtype="float32")

    # Build a view: shape (H, W, d, d)
    shape   = (H, W, d, d)
    strides = (
        padded.strides[0],
        padded.strides[1],
        padded.strides[0],
        padded.strides[1],
    )
    try:
        patches = np.lib.stride_tricks.as_strided(
            padded, shape=shape, strides=strides
        )
        # Flatten last two dims → (H, W, d²)
        flat    = patches.reshape(H, W, d * d)
        out     = np.nanmax(flat, axis=-1) - np.nanmin(flat, axis=-1)
    except ValueError:
        # Fallback for very small rasters: just return zeros
        out = np.zeros((H, W), dtype="float32")
    return out.astype("float32")


def extract_sar_features(band_db: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """
    Build a 6-feature matrix from a single dB backscatter band.

    Features (all in dB domain):
        0  raw_db          — raw backscatter value
        1  local_mean      — 3×3 neighbourhood mean
        2  local_std       — 3×3 neighbourhood std  (texture energy proxy)
        3  gradient_mag    — gradient magnitude      (edge strength)
        4  local_contrast  — 3×3 local range         (GLCM contrast proxy)
        5  homogeneity     — 1 / (1 + local_contrast)(GLCM homogeneity proxy)

    Returns
    -------
    np.ndarray  shape (n_valid_pixels, 6)
    """
    raw   = band_db.astype("float32")

    f0 = raw
    f1 = _uniform_mean(raw).astype("float32")
    f2 = _local_std(raw).astype("float32")
    f3 = _gradient_magnitude(raw).astype("float32")
    f4 = _local_range(raw).astype("float32")
    f5 = (1.0 / (1.0 + np.where(np.isfinite(f4), f4, 0.0))).astype("float32")

    # Stack into H×W×6
    feature_cube = np.stack([f0, f1, f2, f3, f4, f5], axis=-1)

    # Return only valid pixels → (N, 6)
    return feature_cube[valid]


FEATURE_NAMES = [
    "raw_db",
    "local_mean_db",
    "local_std_db",
    "gradient_magnitude",
    "local_contrast",
    "homogeneity",
]


# ══════════════════════════════════════════════════════════════════════════════
#  THRESHOLD-BASED FLOOD MASK  (fast baseline)
# ══════════════════════════════════════════════════════════════════════════════

def threshold_mask(features, valid, threshold_db=-17.0, value_scale="dB"):
    """Exploratory low-backscatter water candidate rule."""
    values = db_features(features, value_scale)
    mask = valid & (values[..., 0] <= threshold_db)
    return mask, values


# ══════════════════════════════════════════════════════════════════════════════
#  RANDOM FOREST — with multi-feature support
# ══════════════════════════════════════════════════════════════════════════════

def _subsample(x: np.ndarray, y: np.ndarray,
               max_n: int = MAX_TRAIN_PIXELS,
               random_state: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """
    Stratified sub-sample to cap training size.
    Keeps class balance even when dataset is very large.
    """
    if len(y) <= max_n:
        return x, y
    rng = np.random.default_rng(random_state)
    indices = []
    for cls in np.unique(y):
        cls_idx = np.where(y == cls)[0]
        n_take  = max(2, int(max_n * len(cls_idx) / len(y)))
        chosen  = rng.choice(cls_idx, size=min(n_take, len(cls_idx)),
                             replace=False)
        indices.append(chosen)
    idx = np.concatenate(indices)
    rng.shuffle(idx)
    return x[idx], y[idx]


def train_random_forest(features, valid, labels, value_scale="dB",
                        random_state=42, use_texture=True):
    """
    Train RF on multi-feature SAR data with optional texture features.

    Parameters
    ----------
    features     : H×W×B stack (raw, possibly linear)
    valid        : H×W bool mask
    labels       : H×W uint8 (0=dry, 1=flooded)
    value_scale  : "dB" or "Linear power"
    random_state : int
    use_texture  : if True, extract 6-feature texture matrix (default);
                   if False, fall back to single raw-dB feature (legacy).
    """
    if labels.shape != valid.shape:
        raise ValueError(
            "Label raster dimensions must match the Sentinel-1 raster."
        )

    good = valid & np.isfinite(labels) & np.isin(labels, [0, 1])
    y    = labels[good].astype("uint8")
    counts = np.bincount(y, minlength=2)

    if len(np.unique(y)) != 2 or counts.min() < 2:
        raise ValueError(
            "Training labels must contain both class 0 and class 1."
        )

    # ── Build feature matrix ──────────────────────────────────────────────
    if use_texture:
        db_band = db_features(features, value_scale)[..., 0]   # H×W
        x_full  = extract_sar_features(db_band, good)           # N×6
    else:
        x_full  = db_features(features, value_scale)[good]      # N×B (legacy)

    # ── Stratified sub-sample for very large scenes ───────────────────────
    x_sub, y_sub = _subsample(x_full, y, MAX_TRAIN_PIXELS, random_state)

    # ── Train / test split ────────────────────────────────────────────────
    x_train, x_test, y_train, y_test = train_test_split(
        x_sub, y_sub,
        test_size=0.20,
        random_state=random_state,
        stratify=y_sub,
    )

    # ── Model ─────────────────────────────────────────────────────────────
    model = RandomForestClassifier(
        n_estimators=200,          # more trees → better generalisation
        max_features="sqrt",       # standard RF heuristic
        class_weight="balanced",   # handles imbalanced flood/dry ratio
        random_state=random_state,
        n_jobs=-1,                 # use all CPU cores
        min_samples_leaf=3,        # slight regularisation
        max_depth=None,            # full trees
    )
    model.fit(x_train, y_train)
    predicted = model.predict(x_test)

    metrics = {
        "accuracy":     float(accuracy_score(y_test, predicted)),
        "precision":    float(precision_score(y_test, predicted, zero_division=0)),
        "recall":       float(recall_score(y_test, predicted, zero_division=0)),
        "f1":           float(f1_score(y_test, predicted, zero_division=0)),
        "iou":          float(jaccard_score(y_test, predicted, zero_division=0)),
        "train_pixels": len(y_train),
        "test_pixels":  len(y_test),
        "features_used": FEATURE_NAMES if use_texture else ["raw_db"],
        "n_estimators":  model.n_estimators,
    }
    return model, good, metrics


def predict(model, features, valid, value_scale="dB", use_texture=True):
    """
    Predict flood mask using the trained RF model.

    Prediction is done in PREDICT_CHUNK-sized batches to avoid
    materialising a huge temporary array for large rasters.
    """
    result = np.zeros(valid.shape, dtype="uint8")

    if use_texture:
        db_band = db_features(features, value_scale)[..., 0]
        x_all   = extract_sar_features(db_band, valid)     # N×6
    else:
        x_all   = db_features(features, value_scale)[valid]

    n = len(x_all)
    preds = np.empty(n, dtype="uint8")

    for start in range(0, n, PREDICT_CHUNK):
        end = min(start + PREDICT_CHUNK, n)
        preds[start:end] = model.predict(x_all[start:end]).astype("uint8")

    result[valid] = preds
    return result.astype(bool)


# ══════════════════════════════════════════════════════════════════════════════
#  OTSU THRESHOLDING  (auto pseudo-label generation)
# ══════════════════════════════════════════════════════════════════════════════

def otsu_threshold(values_1d: np.ndarray) -> float:
    """
    Manual Otsu thresholding via between-class variance maximisation.

    Operates on the raw 1-D array of valid pixel values.
    Uses 256 histogram bins — fast even for millions of pixels.
    """
    hist, bin_edges = np.histogram(values_1d, bins=256)
    bin_centers     = (bin_edges[:-1] + bin_edges[1:]) / 2.0
    total           = hist.sum()
    best_t, best_var = float(bin_centers[0]), 0.0

    # Vectorised between-class variance sweep
    cum0   = np.cumsum(hist)
    cum1   = total - cum0
    mean0  = np.cumsum(hist * bin_centers) / np.maximum(cum0, 1)
    mean1  = (np.cumsum(hist[::-1] * bin_centers[::-1])[::-1]
              / np.maximum(cum1, 1))

    w0 = cum0  / total
    w1 = cum1  / total
    bv = w0 * w1 * (mean0 - mean1) ** 2

    # Ignore first and last bins (boundary artefacts)
    bv[0]  = 0.0
    bv[-1] = 0.0
    best_idx = int(np.argmax(bv))
    return float(bin_centers[best_idx])


# ══════════════════════════════════════════════════════════════════════════════
#  MASK I/O
# ══════════════════════════════════════════════════════════════════════════════

def save_mask(path, mask, profile, valid=None):
    profile.update(count=1, dtype="uint8", nodata=255, compress="deflate")
    with rasterio.open(path, "w", **profile) as dst:
        output = np.where(mask, 1, 0).astype("uint8")
        if valid is not None:
            output[~valid] = 255
        dst.write(output, 1)


# ══════════════════════════════════════════════════════════════════════════════
#  AREA AND RISK HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def calculate_area(mask, profile):
    """Calculate area in km²; requires a projected CRS in metres."""
    transform  = profile["transform"]
    pixel_area = abs(transform.a * transform.e - transform.b * transform.d)
    crs        = profile.get("crs")
    if crs is None or not crs.is_projected:
        raise ValueError(
            "Area reporting requires a projected CRS in metres; "
            "reproject the raster first."
        )
    unit = crs.linear_units.lower() if crs.linear_units else ""
    if unit not in ("metre", "meter", "metres", "meters"):
        raise ValueError(
            f"Area reporting expects metre units, got {crs.linear_units}."
        )
    return int(mask.sum()) * pixel_area / 1_000_000


def risk_summary(area_km2, total_km2, flooded_percent):
    """Illustrative prototype risk categories."""
    if flooded_percent >= 30:
        level = "High Risk"
    elif flooded_percent >= 10:
        level = "Moderate Risk"
    else:
        level = "Low Risk"
    return {
        "flooded_km2":     area_km2,
        "total_km2":       total_km2,
        "flooded_percent": flooded_percent,
        "level":           level,
        "rule": (
            "Prototype area-share rule: "
            "<10% Low · 10–<30% Moderate · ≥30% High."
        ),
    }


# ══════════════════════════════════════════════════════════════════════════════
#  VALUE SCALE AUTO-DETECTION
# ══════════════════════════════════════════════════════════════════════════════

def auto_detect_scale(flat_raw: np.ndarray) -> str:
    """
    Detect whether pixel values are in dB or linear power.

    Sentinel-1 dB values are typically in the range -30..0.
    Linear power (sigma0) values are typically 0..1 (max < 10).
    Returns 'Linear power' or 'dB'.
    """
    max_val = float(np.nanmax(flat_raw))
    if max_val < 10.0:
        return "Linear power"
    return "dB"
