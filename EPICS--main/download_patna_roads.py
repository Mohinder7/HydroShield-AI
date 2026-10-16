import osmnx as ox
import geopandas as gpd
from pathlib import Path

out = Path(__file__).resolve().parents[1] / "datasets" / "roads"
out.mkdir(parents=True, exist_ok=True)

# Bounds of the actual Sentinel-1 prediction raster
north, south = 25.6542, 25.4458
east, west = 85.3329, 84.9966

print("Downloading road network for the raster footprint...")
G = ox.graph_from_bbox(
    (west, south, east, north),
    network_type="drive",
    simplify=True
)

nodes, edges = ox.graph_to_gdfs(G)
edges = edges.to_crs("EPSG:4326")

path = out / "patna_roads.geojson"
edges.to_file(path, driver="GeoJSON")

print("Saved:", path)
print("Road segments:", len(edges))
print("Road types:")
print(edges["highway"].value_counts().head(10))
