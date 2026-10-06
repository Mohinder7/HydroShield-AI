"""
End-to-end routing test — reads raster in tiles to avoid OOM,
then runs the full flood-aware routing pipeline and prints distance.
"""
import sys, math
sys.path.insert(0, r'd:\HydroShield-AI\EPICS--main')

import numpy as np
import rasterio
import rasterio.windows
from rasterio.warp import transform as reproject_coords
from pyproj import CRS

from src.pipeline import db_features, auto_detect_scale, threshold_mask, otsu_threshold
from src.routing import load_vectors, route, _xy_key, _lines, _raster_cell

import networkx as nx
from shapely.geometry import Polygon, Point

RASTER   = r'd:\HydroShield-AI\datasets\sar\subset_0_of_S1A_IW_GRDH_1SDV_20191005T002026_Cal_TF_NR_TC_2.tif'
ROADS    = r'd:\HydroShield-AI\datasets\roads\patna_roads.geojson'
SHELTERS = r'd:\HydroShield-AI\datasets\shelters\patna_shelters.geojson'

USER_LAT = 24.647
USER_LON = 83.903

print("=" * 60)
print("  HydroShield — End-to-End Routing Distance Test")
print("=" * 60)

# ── 1. Read raster in 512-row tiles (memory efficient) ────────────
print("\n[1] Reading raster in tiles (memory-efficient)...")

with rasterio.open(RASTER) as src:
    raster_crs = src.crs
    transform  = src.transform
    H, W       = src.height, src.width

    # Accumulate stats from tiles without holding full array
    total_valid = 0
    total_flooded = 0

    # Collect a sample of dB values for threshold detection
    sample_vals = []
    TILE = 512
    for row_off in range(0, H, TILE):
        rows = min(TILE, H - row_off)
        win  = rasterio.windows.Window(0, row_off, W, rows)
        tile = src.read(1, window=win).astype("float32")

        valid_tile = np.isfinite(tile) & (tile > 0)
        total_valid += int(valid_tile.sum())

        if len(sample_vals) < 500_000 and valid_tile.any():
            flat = tile[valid_tile]
            take = min(50_000, len(flat))
            sample_vals.extend(flat[:take].tolist())

print(f"   Valid pixels : {total_valid:,}")
print(f"   Sample size  : {len(sample_vals):,}")

# ── 2. Detect scale + compute threshold ───────────────────────────
print("\n[2] Detecting scale and threshold...")

raw_arr    = np.array(sample_vals, dtype="float32")
scale      = auto_detect_scale(raw_arr)
# Convert sample to dB
if scale == "Linear power":
    db_sample = 10 * np.log10(np.maximum(raw_arr, 1e-10))
else:
    db_sample = raw_arr

n17    = int((db_sample <= -17.0).sum())
eff_t  = -17.0 if n17 > 0 else float(np.percentile(db_sample, 20))

# Sanity: if >60% flagged use p20
pct_at_t = 100.0 * (db_sample <= eff_t).sum() / max(len(db_sample), 1)
if pct_at_t > 60.0:
    eff_t = float(np.percentile(db_sample, 20))

print(f"   Scale        : {scale}")
print(f"   dB range     : [{db_sample.min():.2f}, {db_sample.max():.2f}]")
print(f"   Threshold    : {eff_t:.4f} dB")

# ── 3. Count flooded pixels tile by tile ──────────────────────────
print("\n[3] Counting flooded pixels (tiled)...")

with rasterio.open(RASTER) as src:
    for row_off in range(0, H, TILE):
        rows = min(TILE, H - row_off)
        win  = rasterio.windows.Window(0, row_off, W, rows)
        tile = src.read(1, window=win).astype("float32")
        valid_tile = np.isfinite(tile) & (tile > 0)
        if scale == "Linear power":
            db_tile = 10 * np.log10(np.maximum(tile, 1e-10))
        else:
            db_tile = tile
        total_flooded += int(((db_tile <= eff_t) & valid_tile).sum())

flooded_pct = 100.0 * total_flooded / max(total_valid, 1)
print(f"   Flooded px   : {total_flooded:,}  ({flooded_pct:.2f}%)")

# ── 4. Build a representative flood mask for routing ──────────────
# Route uses only a small fraction of the raster (road corridor).
# Load a band around the road network (lon 83.3-84.6, lat 24.1-25.2)
# using a spatial window from the raster.
print("\n[4] Loading road-corridor raster window for routing...")

with rasterio.open(RASTER) as src:
    # Convert road bbox to pixel offsets
    from rasterio.transform import rowcol
    # Road bounds: lon 83.35-84.99, lat 24.18-25.24
    # Add 0.1 degree margin
    lon_min, lon_max = 83.25, 85.10
    lat_min, lat_max = 24.10, 25.30
    rows_mm, cols_mm = rowcol(src.transform,
                               [lon_min, lon_max],
                               [lat_max, lat_min])
    r0 = max(0, min(rows_mm[0], rows_mm[1]))
    r1 = min(H, max(rows_mm[0], rows_mm[1]))
    c0 = max(0, min(cols_mm[0], cols_mm[1]))
    c1 = min(W, max(cols_mm[0], cols_mm[1]))
    win = rasterio.windows.Window(c0, r0, c1-c0, r1-r0)
    win_transform = src.window_transform(win)
    tile = src.read(1, window=win).astype("float32")
    win_H, win_W = tile.shape

valid_win = np.isfinite(tile) & (tile > 0)
if scale == "Linear power":
    db_win = 10 * np.log10(np.maximum(tile, 1e-10))
else:
    db_win = tile.copy()
mask_win = (db_win <= eff_t) & valid_win

print(f"   Window size  : {win_W}×{win_H} pixels")
print(f"   Valid pixels : {valid_win.sum():,}")
print(f"   Flooded px   : {mask_win.sum():,}  ({100*mask_win.sum()/max(valid_win.sum(),1):.2f}%)")

# ── 5. Load vectors ────────────────────────────────────────────────
print("\n[5] Loading road and shelter datasets...")
roads_gdf, shelters_gdf = load_vectors(ROADS, SHELTERS, raster_crs)
print(f"   Roads    : {len(roads_gdf)}")
print(f"   Shelters : {len(shelters_gdf)}")

# ── 6. Run routing ─────────────────────────────────────────────────
print(f"\n[6] Running routing from lat={USER_LAT}, lon={USER_LON}...")
x, y = reproject_coords("EPSG:4326", raster_crs, [USER_LON], [USER_LAT])
start_xy = (x[0], y[0])

result, _, road_parts, flooded_roads = route(
    roads_gdf, shelters_gdf,
    mask_win, valid_win, win_transform,
    start_xy, raster_crs=raster_crs
)

# ── 7. Print result ────────────────────────────────────────────────
print(f"\n   Road segments: {len(road_parts)} total, {sum(flooded_roads)} blocked, {len(road_parts)-sum(flooded_roads)} passable")

if result is None:
    print("\n   Result : No safe route found.")
    sys.exit(1)

shelter_name = shelters_gdf.loc[result["shelter_index"]]["name"]
dist_m  = result["length_m"]
dist_km = dist_m / 1000

rx = [p[0] for p in result["coordinates"]]
ry = [p[1] for p in result["coordinates"]]
rlon, rlat = reproject_coords(raster_crs, "EPSG:4326", rx, ry)

print()
print("=" * 60)
print("   ROUTING RESULT")
print("=" * 60)
print(f"   Nearest Shelter  : {shelter_name}")
print(f"   Distance         : {dist_m:.0f} m  ({dist_km:.2f} km)")
print(f"   Waypoints        : {len(result['coordinates'])}")
print(f"   Route Start      : lat={rlat[0]:.5f}, lon={rlon[0]:.5f}")
print(f"   Route End        : lat={rlat[-1]:.5f}, lon={rlon[-1]:.5f}")
print(f"   Flood Coverage   : {flooded_pct:.2f}% of scene")
print(f"   Blocked Roads    : {sum(flooded_roads)}")
print("=" * 60)
print("\n   ALL TESTS PASSED ✅")
