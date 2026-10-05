"""Raster ingest, explainable SAR feature handling, and flood mask generation."""
import numpy as np
import rasterio
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, jaccard_score


def raster_info(path):
    with rasterio.open(path) as src:
        return {"bands": src.count, "width": src.width, "height": src.height,
                "crs": str(src.crs) if src.crs else "Missing CRS", "bounds": tuple(src.bounds),
                "descriptions": src.descriptions, "dtype": src.dtypes[0], "nodata": src.nodata,
                "transform": src.transform}


def read_features(path, band_indexes):
    """Read selected bands as float features; values are unchanged (often linear power)."""
    with rasterio.open(path) as src:
        if not src.crs:
            raise ValueError("The input raster has no CRS; geospatial area and routing require a CRS.")
        arrays = [src.read(i, masked=True).astype("float32").filled(np.nan) for i in band_indexes]
        stack = np.stack(arrays, axis=-1)
        # Negative values are valid for dB backscatter. Unit interpretation is selected by the user.
        valid = np.isfinite(stack).all(axis=-1)
        if valid.any() and not np.any(stack[valid] != 0):
            raise ValueError("All valid raster pixels are zero; verify that the input contains Sentinel-1 backscatter data.")
        return stack, valid, src.profile.copy()


def db_features(stack, value_scale="dB"):
    """Return selected features in dB using the operator-declared input scale."""
    if value_scale == "dB":
        return stack.copy()
    if value_scale != "Linear power":
        raise ValueError("Select either dB or linear power based on the input product metadata.")
    return 10 * np.log10(np.maximum(stack, 1e-10))


def threshold_mask(features, valid, threshold_db=-17.0, value_scale="dB"):
    """Exploratory low-backscatter water candidate rule, not a trained flood model."""
    values = db_features(features, value_scale)
    # For one selected channel; with multiple channels use the first selected polarization.
    mask = valid & (values[..., 0] <= threshold_db)
    return mask, values


def train_random_forest(features, valid, labels, value_scale="dB", random_state=42):
    """Train RF and calculate a stratified random-pixel holdout evaluation."""
    if labels.shape != valid.shape:
        raise ValueError("Label raster dimensions must match the Sentinel-1 raster.")
    good = valid & np.isfinite(labels) & np.isin(labels, [0, 1])
    y = labels[good].astype("uint8")
    counts = np.bincount(y, minlength=2)
    if len(np.unique(y)) != 2 or counts.min() < 2:
        raise ValueError("Training labels must contain both class 0 and class 1.")
    x = db_features(features, value_scale)[good]
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, random_state=random_state, stratify=y
    )
    model = RandomForestClassifier(n_estimators=150, class_weight="balanced", random_state=random_state,
                                   n_jobs=-1, min_samples_leaf=2)
    model.fit(x_train, y_train)
    predicted = model.predict(x_test)
    metrics = {"accuracy": accuracy_score(y_test, predicted),
               "precision": precision_score(y_test, predicted, zero_division=0),
               "recall": recall_score(y_test, predicted, zero_division=0),
               "f1": f1_score(y_test, predicted, zero_division=0),
               "iou": jaccard_score(y_test, predicted, zero_division=0),
               "train_pixels": len(y_train), "test_pixels": len(y_test)}
    return model, good, metrics


def predict(model, features, valid, value_scale="dB"):
    result = np.zeros(valid.shape, dtype="uint8")
    result[valid] = model.predict(db_features(features, value_scale)[valid]).astype("uint8")
    return result.astype(bool)


def save_mask(path, mask, profile, valid=None):
    profile.update(count=1, dtype="uint8", nodata=255, compress="deflate")
    with rasterio.open(path, "w", **profile) as dst:
        output = np.where(mask, 1, 0).astype("uint8")
        if valid is not None:
            output[~valid] = 255
        dst.write(output, 1)


def calculate_area(mask, profile):
    """Calculate area using pixel dimensions; projected CRS units are assumed metres."""
    transform = profile["transform"]
    pixel_area = abs(transform.a * transform.e - transform.b * transform.d)
    crs = profile.get("crs")
    if crs is None or not crs.is_projected:
        raise ValueError("Area reporting requires a projected CRS in metres; reproject the raster first.")
    unit = crs.linear_units.lower() if crs.linear_units else ""
    if unit not in ("metre", "meter", "metres", "meters"):
        raise ValueError(f"Area reporting expects metre units, got {crs.linear_units}.")
    return int(mask.sum()) * pixel_area / 1_000_000


def risk_summary(area_km2, total_km2, flooded_percent):
    """Illustrative prototype categories; thresholds are not validated hazard standards."""
    if flooded_percent >= 30:
        level = "High Risk"
    elif flooded_percent >= 10:
        level = "Moderate Risk"
    else:
        level = "Low Risk"
    return {"flooded_km2": area_km2, "total_km2": total_km2,
            "flooded_percent": flooded_percent, "level": level,
            "rule": "Prototype area-share rule: <10% Low, 10–<30% Moderate, ≥30% High."}


def otsu_threshold(values_1d):
    """Manual Otsu thresholding for automatic pseudo-label generation."""
    hist, bin_edges = np.histogram(values_1d, bins=256)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    total = hist.sum()
    best_t, best_var = bin_centers[0], 0.0
    for i in range(1, len(hist)):
        w0 = hist[:i].sum() / total
        w1 = hist[i:].sum() / total
        if w0 == 0 or w1 == 0:
            continue
        mu0 = (hist[:i] * bin_centers[:i]).sum() / (hist[:i].sum() + 1e-12)
        mu1 = (hist[i:] * bin_centers[i:]).sum() / (hist[i:].sum() + 1e-12)
        var = w0 * w1 * (mu0 - mu1) ** 2
        if var > best_var:
            best_var = var
            best_t = bin_centers[i]
    return best_t
