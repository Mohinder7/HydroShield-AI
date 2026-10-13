import os
import rasterio

files = [
    r"D:\patna_s1_features_aug2026.tif",
    r"D:\patna_sar_flood.tif",
]

for path in files:
    print("\nFILE:", path)

    if not os.path.exists(path):
        print("FILE NOT FOUND")
        continue

    print("SIZE:", os.path.getsize(path), "bytes")

    try:
        with rasterio.open(path) as ds:
            print("BANDS:", ds.count)
            print("DIMENSIONS:", ds.width, "x", ds.height)
            print("CRS:", ds.crs)
            print("DATA TYPES:", ds.dtypes)
            print("NODATA:", ds.nodata)
            print("BAND NAMES:", ds.descriptions)

            for i in range(1, ds.count + 1):
                arr = ds.read(
                    i,
                    masked=True,
                    out_shape=(min(ds.height, 400), min(ds.width, 400))
                ).compressed()

                if arr.size:
                    print(
                        f"BAND {i}: min={arr.min():.4f}, "
                        f"max={arr.max():.4f}, mean={arr.mean():.4f}"
                    )
                else:
                    print(f"BAND {i}: no valid pixels")

    except Exception as exc:
        print("ERROR:", exc)
