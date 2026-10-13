
from pathlib import Path
import joblib
import numpy as np
import rasterio

root = Path(__file__).resolve().parent
raster_path = Path(r"D:\patna_s1_features_aug2026.tif")

model = joblib.load(root / "weights" / "random_forest_model.joblib")
scaler = joblib.load(root / "weights" / "scaler.joblib")

rng = np.random.default_rng(42)
features_list = []
labels_list = []

with rasterio.open(raster_path) as src:
    for row in range(0, src.height, 100):
        block = src.read(
            indexes=[1, 2, 3, 4, 5, 6],
            window=(
                (row, min(row + 100, src.height)),
                (0, src.width),
            ),
        )
        pixels = block.reshape(6, -1).T
        valid = np.isfinite(pixels).all(axis=1)
        pixels = pixels[valid]

        if len(pixels) == 0:
            continue

        # Original candidate rule: both changes below -3 dB
        labels = (pixels[:, 4] < -3) & (pixels[:, 5] < -3)

        features_list.append(pixels)
        labels_list.append(labels)

X = np.vstack(features_list)
y = np.concatenate(labels_list)

# Use a reproducible sample for faster diagnosis
n = min(200_000, len(X))
idx = rng.choice(len(X), size=n, replace=False)
X = X[idx]
y = y[idx]

X_scaled = scaler.transform(X)
pred = model.predict(X_scaled)
prob = model.predict_proba(X_scaled)

print("Sampled pixels:", n)
print("Rule-based candidate count:", int(y.sum()))
print("Rule-based candidate percentage:", round(100 * y.mean(), 4))
print("Model class counts:", dict(zip(*np.unique(pred, return_counts=True))))
print("Mean class probabilities:", prob.mean(axis=0))
print("Max class-1 probability:", float(prob[:, list(model.classes_).index(1)].max()))

for label in [False, True]:
    subset = prob[y == label]
    if len(subset):
        p1 = subset[:, list(model.classes_).index(1)]
        print(
            f"Rule label {int(label)}: n={len(p1)}, "
            f"mean P(class 1)={p1.mean():.6f}, "
            f"max P(class 1)={p1.max():.6f}, "
            f">0.5={(p1 > 0.5).sum()}"
        )
