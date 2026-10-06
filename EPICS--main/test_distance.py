"""
Quick console test — prints routing distance output.
Uses a 512x512 window so it runs in ~5 seconds.
"""
import sys
sys.path.insert(0, r'd:\HydroShield-AI\EPICS--main')

import numpy as np
import rasterio
from rasterio.warp import transform as reproject_coords
from rasterio.transform import xy as rxy

from src.pipeline import (
    db_features, auto_detect_scale, threshold_mask, otsu_threshold
)
from src.routing import load_vectors, route

RASTER   = r'd:\HydroShield-AI\datasets\sar\subset_0_of_S1A_IW_GRDH_1SDV_20191005T002026_Cal_TF_NR_TC_2.tif'
ROADS    = r'd:\HydroShield-AI\datasets\roads\patna_roads.geojson'
SHELTERS = r'd:\HydroShield-AI\datasets\shelters\patna_shelters.geojson'

print("\n--- HydroShield Routing Distance Test ---\n")

# Load a 512x512 window from centre of raster (fast)
with rasterio.open(RASTER) as src:
    H, W = src.height, src.width
    win  = rasterio.windows.Window(W//2 - 256, H//2 - 256, 512, 512)
    tile = src.read(1, window=win).astype("float32")
    win_transform = src.window_transform(win)
    crs = src.crs

# Build stack, valid, profile
features  = tile[:, :, np.newaxis]
valid     = (np.isfinite(tile) & (tile > 0))
profile   = {"crs": crs, "transform": win_transform, "width": 512, "height": 512}

# Auto-detect scale + threshold
raw_flat  = features[valid, 0]
scale     = auto_detect_scale(raw_flat)
db_vals   = db_features(features, scale)
flat_db   = db_vals[valid, 0]
n17       = int((flat_db <= -17.0).sum())
eff_t     = -17.0 if n17 > 0 else float(np.percentile(flat_db, 20))
mask, _   = threshold_mask(features, valid, eff_t, scale)

flooded_pct = 100.0 * mask.sum() / max(valid.sum(), 1)
print(f"Scale detected : {scale}")
print(f"Threshold used : {eff_t:.2f} dB")
print(f"Flood coverage : {flooded_pct:.2f}%")

# Load vectors + route
roads_gdf, shelters_gdf = load_vectors(ROADS, SHELTERS, crs)

# Start at window centre (convert to projected CRS)
# Window centre in pixel space → lon/lat
row_c, col_c = 256, 256
lat_c, lon_c = rxy(win_transform, row_c, col_c, offset="center")
x, y = reproject_coords("EPSG:4326", crs, [lon_c], [lat_c])
start_xy = (x[0], y[0])

print(f"\nStart location : lat={lat_c:.5f}, lon={lon_c:.5f}")
print("Running routing...")

result, _, road_parts, flooded_roads = route(
    roads_gdf, shelters_gdf, mask, valid,
    win_transform, start_xy, raster_crs=crs
)

print(f"\nRoad segments  : {len(road_parts)} total, {sum(flooded_roads)} flooded/blocked, {len(road_parts)-sum(flooded_roads)} passable")

if result is None:
    print("\nResult         : No safe route found from this window.")
    print("  (The 512x512 window may not overlap the road network.)")
    print("\n  Run the full raster test for a guaranteed route:")
    print("  python d:\\HydroShield-AI\\EPICS--main\\e2e_routing_test.py")
else:
    shelter_name = shelters_gdf.loc[result["shelter_index"]]["name"]
    dist_m  = result["length_m"]
    dist_km = dist_m / 1000

    # Convert route coords back to lat/lon
    rx = [p[0] for p in result["coordinates"]]
    ry = [p[1] for p in result["coordinates"]]
    rlon, rlat = reproject_coords(crs, "EPSG:4326", rx, ry)

    print("\n========== ROUTING RESULT ==========")
    print(f"  Shelter        : {shelter_name}")
    print(f"  Distance       : {dist_m:.0f} m  ({dist_km:.2f} km)")
    print(f"  Waypoints      : {len(result['coordinates'])}")
    print(f"  Route start    : lat={rlat[0]:.5f}, lon={rlon[0]:.5f}")
    print(f"  Route end      : lat={rlat[-1]:.5f}, lon={rlon[-1]:.5f}")
    print("====================================\n")
