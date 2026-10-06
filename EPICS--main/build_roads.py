"""
Build a connected road network GeoJSON where roads share exact coordinates
at intersections so the graph becomes fully connected.

Strategy: define a grid of nodes first, then build roads as sequences of
those exact node coordinates. This guarantees shared endpoints.

Raster: lon 83.27..84.53, lat 24.15..25.14
"""
import json

# ── Define intersection nodes (lon, lat) ──────────────────────────────────────
# These are the "junction" points that roads will pass through.
# Roads connecting different junctions will share these exact coordinates.
NODES = {
    # Western grid
    "W1": (83.40, 24.40),
    "W2": (83.40, 24.65),
    "W3": (83.40, 24.90),
    "W4": (83.40, 25.05),
    # Central-west grid
    "CW1": (83.70, 24.35),
    "CW2": (83.70, 24.65),
    "CW3": (83.70, 24.90),
    "CW4": (83.70, 25.10),
    # Central grid
    "C1": (84.00, 24.40),
    "C2": (84.00, 24.65),
    "C3": (84.00, 24.90),
    "C4": (84.00, 25.10),
    # Central-east grid
    "CE1": (84.25, 24.45),
    "CE2": (84.25, 24.70),
    "CE3": (84.25, 24.95),
    "CE4": (84.25, 25.10),
    # Eastern grid
    "E1": (84.50, 24.50),
    "E2": (84.50, 24.75),
    "E3": (84.50, 25.00),
    # Shelter-adjacent nodes (near each shelter)
    "S_AUR": (84.37, 24.75),   # near Aurangabad shelter
    "S_RAF": (84.65, 24.82),   # near Rafiganj shelter
    "S_SHG": (84.81, 24.56),   # near Sherghati shelter
    "S_BWG": (84.50, 24.70),   # near Bodh Gaya shelter
    "S_ARW": (84.68, 25.24),   # near Arwal shelter
    "S_JEH": (84.50, 25.00),   # near Jehanabad shelter (near E3)
}

features = []

def road(node_list, name, highway="primary"):
    """Create a road feature using named node coordinates."""
    coords = [NODES[n] for n in node_list]
    features.append({
        "type": "Feature",
        "properties": {"name": name, "highway": highway},
        "geometry": {"type": "LineString", "coordinates": coords}
    })

def road_coords(coords, name, highway="secondary"):
    """Create a road from explicit coordinates."""
    features.append({
        "type": "Feature",
        "properties": {"name": name, "highway": highway},
        "geometry": {"type": "LineString", "coordinates": coords}
    })

# ── East-West spine roads ──────────────────────────────────────────────────────
road(["W2", "CW2", "C2", "CE2", "E2"], "NH-2 Grand Trunk Road East-West", "primary")
road(["W3", "CW3", "C3", "CE3", "E3"], "NH-83 North Spine", "primary")
road(["W1", "CW1", "C1", "CE1", "E1"], "Bihar South Highway", "primary")
road(["W4", "CW4", "C4", "CE4"],       "Bihar North Road", "secondary")

# ── North-South spine roads ────────────────────────────────────────────────────
road(["W1", "W2", "W3", "W4"], "West Bihar NS Road", "secondary")
road(["CW1", "CW2", "CW3", "CW4"], "Central-West Bihar NS", "secondary")
road(["C1", "C2", "C3", "C4"], "Bihar Central Highway NS", "secondary")
road(["CE1", "CE2", "CE3", "CE4"], "East-Central Bihar NS", "secondary")
road(["E1", "E2", "E3"], "East Bihar NS Road", "secondary")

# ── Diagonal / shelter connector roads ────────────────────────────────────────
# Connect Aurangabad shelter to main grid
road_coords([NODES["S_AUR"], NODES["C1"], NODES["CW2"]], "Aurangabad-Gaya Road", "tertiary")
road_coords([NODES["S_AUR"], NODES["CE1"], NODES["E1"]], "Aurangabad-Bodh Gaya Road", "tertiary")

# Connect Rafiganj shelter
road_coords([NODES["S_RAF"], NODES["CE2"], NODES["C2"]], "Rafiganj-Gaya Road", "tertiary")
road_coords([NODES["S_RAF"], NODES["E2"], NODES["S_BWG"]], "Rafiganj-Bodh Gaya Road", "tertiary")

# Connect Sherghati shelter
road_coords([NODES["S_SHG"], NODES["CE1"], NODES["E1"]], "Sherghati-Bodh Gaya Road", "tertiary")
road_coords([NODES["S_SHG"], NODES["S_BWG"], NODES["E2"]], "Sherghati District Road", "tertiary")

# Connect Bodh Gaya (near shelter)
road_coords([NODES["S_BWG"], NODES["E2"], NODES["E3"]], "Bodh Gaya-Jehanabad Road", "tertiary")

# Connect Arwal and Jehanabad
road_coords([NODES["S_ARW"], NODES["CE4"], NODES["C4"]], "Arwal-Jehanabad Link", "tertiary")
road_coords([NODES["S_JEH"], NODES["E3"], NODES["CE3"]], "Jehanabad District Road", "tertiary")

# Extra cross-connectors to ensure full connectivity
road(["CW1", "C2", "CE3"],  "Bihar Diagonal Road 1", "unclassified")
road(["W3", "CW2", "C1"],   "Bihar Diagonal Road 2", "unclassified")
road(["C3", "CE2", "E1"],   "Bihar Diagonal Road 3", "unclassified")
road_coords([NODES["S_AUR"], NODES["CW2"], NODES["W3"]], "West Connector Road", "unclassified")

# ── Write GeoJSON ──────────────────────────────────────────────────────────────
geojson = {
    "type": "FeatureCollection",
    "name": "Bihar Road Network (connected)",
    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
    "features": features
}

out = r"d:\HydroShield-AI\datasets\roads\patna_roads.geojson"
with open(out, "w") as f:
    json.dump(geojson, f, indent=2)

print(f"Written {len(features)} road features")
# Spot-check intersection sharing
from collections import Counter
all_coords = []
for feat in features:
    for coord in feat["geometry"]["coordinates"]:
        all_coords.append(tuple(coord))
shared = [c for c, cnt in Counter(all_coords).items() if cnt > 1]
print(f"Shared intersection nodes: {len(shared)}")
print("Sample shared nodes:", shared[:5])
