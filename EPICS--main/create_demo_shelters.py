
import geopandas as gpd
from pathlib import Path
from shapely.geometry import Point

root = Path(__file__).resolve().parents[1] / "datasets"
roads_path = root / "roads" / "patna_roads.geojson"
output_path = root / "shelters" / "patna_demo_shelters.geojson"

roads = gpd.read_file(roads_path).to_crs("EPSG:32645")
roads = roads[roads.geometry.notna() & ~roads.geometry.is_empty].copy()
roads = roads[roads.geometry.geom_type.isin(["LineString", "MultiLineString"])]

if roads.empty:
    raise SystemExit("No usable road geometries found.")

# Generate candidate points at road-segment midpoints.
candidates = []
for geom in roads.geometry:
    if geom.length >= 100:
        p = geom.interpolate(0.5, normalized=True)
        candidates.append((p, geom.length))

# Prefer longer segments, then spread points apart.
candidates.sort(key=lambda item: item[1], reverse=True)
chosen = []
minimum_spacing_m = 2000

for point, length in candidates:
    if all(point.distance(existing[0]) >= minimum_spacing_m for existing in chosen):
        chosen.append((point, length))
    if len(chosen) == 3:
        break

if len(chosen) < 3:
    raise SystemExit("Could not find three separated road points.")

records = []
for i, (point, _) in enumerate(chosen, start=1):
    records.append({
        "name": f"DEMO Destination {i} - Unverified",
        "type": "Synthetic test destination",
        "capacity": 0,
        "status": "DEMO_ONLY_NOT_A_REAL_SHELTER",
        "geometry": point
    })

gdf = gpd.GeoDataFrame(records, crs="EPSG:32645").to_crs("EPSG:4326")
output_path.parent.mkdir(parents=True, exist_ok=True)
gdf.to_file(output_path, driver="GeoJSON")

print("Created:", output_path)
print(gdf[["name", "type", "status"]].to_string(index=False))
print("Coordinates (longitude, latitude):")
for point in gdf.geometry:
    print(round(point.x, 6), round(point.y, 6))
