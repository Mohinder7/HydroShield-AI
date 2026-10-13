import numpy as np
import rasterio
from rasterio.windows import Window

path = r"D:\patna_s1_features_aug2026.tif"

with rasterio.open(path) as ds:
    print("Raster:", path)
    print("Size:", ds.width, "x", ds.height)
    print("Bands:", ds.count)

    for band in range(1, ds.count + 1):
        valid_count = 0
        nan_count = 0
        min_value = float("inf")
        max_value = float("-inf")
        total = 0.0

        for row in range(0, ds.height, 512):
            for col in range(0, ds.width, 512):
                window = Window(
                    col, row,
                    min(512, ds.width - col),
                    min(512, ds.height - row)
                )
                arr = ds.read(band, window=window)
                finite = arr[np.isfinite(arr)]
                valid_count += finite.size
                nan_count += arr.size - finite.size

                if finite.size:
                    min_value = min(min_value, float(finite.min()))
                    max_value = max(max_value, float(finite.max()))
                    total += float(finite.sum(dtype=np.float64))

        print(f"\nBand {band}: {ds.descriptions[band-1]}")
        print("Finite pixels:", valid_count)
        print("NaN/Inf pixels:", nan_count)

        if valid_count:
            print("Min:", min_value)
            print("Max:", max_value)
            print("Mean:", total / valid_count)
        else:
            print("NO VALID PIXELS")
