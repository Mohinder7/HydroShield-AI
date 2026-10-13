
from pathlib import Path

import joblib
import numpy as np
import rasterio

root = Path(__file__).resolve().parent
raster_path = Path(r"D:\patna_s1_features_aug2026.tif")
model_path = root / "weights" / "random_forest_model.joblib"
scaler_path = root / "weights" / "scaler.joblib"

model = joblib.load(model_path)
scaler = joblib.load(scaler_path)

rng = np.random.default_rng(42)
samples = []

with rasterio.open(raster_path) as src:
    print("Raster:", src.width, "x", src.height)
    print("Bands:", src.count)
    print("CRS:", src.crs)

    # Sample up to 20 separated row windows to limit memory use.
    starts = np.linspace(
        0, max(0, src.height - 100), num=20, dtype=int
    )

    for row in starts:
        block = src.read(
            indexes=[1, 2, 3, 4, 5, 6],
            window=((int(row), min(int(row) + 100, src.height)),
                    (0, src.width)),
        )

        # Convert bands x rows x cols to pixels x bands.
        pixels = block.reshape(6, -1).T
        pixels = pixels[np.isfinite(pixels).all(axis=1)]

        if len(pixels):
            count = min(5000, len(pixels))
            idx = rng.choice(len(pixels), size=count, replace=False)
            samples.append(pixels[idx])

X = np.vstack(samples)

print("\nSampled pixels:", len(X))
print("Feature order:", [
    "beforeVV", "afterVV", "beforeVH",
    "afterVH", "vvChange", "vhChange"
])
print("Input feature minima:", np.round(X.min(axis=0), 3))
print("Input feature maxima:", np.round(X.max(axis=0), 3))
print("Input feature means: ", np.round(X.mean(axis=0), 3))

print("\nModel expected features:", getattr(model, "n_features_in_", "unknown"))
print("Model classes:", getattr(model, "classes_", "unknown"))
print("Scaler expected features:", getattr(scaler, "n_features_in_", "unknown"))
print("Scaler means:", np.round(getattr(scaler, "mean_", []), 3))
print("Scaler scales:", np.round(getattr(scaler, "scale_", []), 3))

try:
    X_scaled = scaler.transform(X)
    predictions = model.predict(X_scaled)

    values, counts = np.unique(predictions, return_counts=True)
    print("\nPredicted class counts:", dict(zip(values.tolist(), counts.tolist())))

    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(X_scaled)
        print("Probability columns/classes:", model.classes_)
        print("Mean probabilities:", np.round(probabilities.mean(axis=0), 5))
        print("Max probability per class:", np.round(probabilities.max(axis=0), 5))

except Exception as exc:
    print("\nDIAGNOSTIC ERROR:", repr(exc))
