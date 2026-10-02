"""Flood-aware graph routing from user-provided roads and shelter data."""
import math
import networkx as nx
import numpy as np
import geopandas as gpd
from shapely.geometry import LineString, MultiLineString, Point


def load_vectors(roads_path, shelters_path, raster_crs):
    roads = gpd.read_file(roads_path)
    shelters = gpd.read_file(shelters_path)
    if roads.crs is None or shelters.crs is None:
        raise ValueError("Road and shelter datasets must each declare a CRS.")
    return roads.to_crs(raster_crs), shelters.to_crs(raster_crs)


def _xy_key(point):
    return (round(point[0], 2), round(point[1], 2))


def _lines(geometry):
    if isinstance(geometry, LineString):
        return [geometry]
    if isinstance(geometry, MultiLineString):
        return list(geometry.geoms)
    return []


def route(roads, shelters, flood_mask, valid_mask, transform, start_xy, flood_fraction_limit=0.05):
    """Build endpoint graph, exclude roads with sampled flooded-pixel share above limit."""
    graph = nx.Graph()
    road_parts, flooded = [], []
    start_col, start_row = (~transform) * start_xy
    start_r, start_c = int(math.floor(start_row)), int(math.floor(start_col))
    if (start_r < 0 or start_c < 0 or start_r >= flood_mask.shape[0] or start_c >= flood_mask.shape[1]
            or not valid_mask[start_r, start_c] or flood_mask[start_r, start_c]):
        return None, None, road_parts, flooded
    sample_spacing = max(min(abs(transform.a), abs(transform.e)) / 2, 0.01)
    for idx, row in roads.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        for line in _lines(geom):
            coords = list(line.coords)
            if len(coords) < 2:
                continue
            # Sample along the full segment at sub-pixel spacing, not just at source vertices.
            samples = []
            coverage_ok = True
            sample_count = max(2, int(math.ceil(line.length / sample_spacing)))
            sample_points = [line.interpolate(i / (sample_count - 1), normalized=True)
                             for i in range(sample_count)]
            for point in sample_points:
                x, y = point.x, point.y
                try:
                    col, rr = (~transform) * (x, y)
                    r, c = int(math.floor(rr)), int(math.floor(col))
                    if 0 <= r < flood_mask.shape[0] and 0 <= c < flood_mask.shape[1]:
                        if not valid_mask[r, c]:
                            coverage_ok = False
                        samples.append(bool(flood_mask[r, c]))
                    else:
                        coverage_ok = False
                except Exception:
                    pass
            # Roads outside raster coverage or crossing nodata are excluded as unknown.
            affected = (not coverage_ok) or (not samples) or np.mean(samples) > flood_fraction_limit
            road_parts.append(line)
            flooded.append(affected)
            if affected:
                continue
            for a, b in zip(coords[:-1], coords[1:]):
                u, v = _xy_key(a), _xy_key(b)
                length = Point(a).distance(Point(b))
                if length == 0:
                    continue
                if graph.has_edge(u, v):
                    graph[u][v]["weight"] = min(length, graph[u][v]["weight"])
                else:
                    graph.add_edge(u, v, weight=length)
    if not graph:
        return None, None, road_parts, flooded

    def nearest_node(xy):
        return min(graph.nodes, key=lambda n: (n[0]-xy[0])**2 + (n[1]-xy[1])**2)

    source = nearest_node(start_xy)
    choices = []
    for ix, row in shelters.iterrows():
        p = row.geometry
        if p is None or p.is_empty or not isinstance(p, Point):
            continue
        shelter_col, shelter_row = (~transform) * (p.x, p.y)
        shelter_r, shelter_c = int(math.floor(shelter_row)), int(math.floor(shelter_col))
        if (shelter_r < 0 or shelter_c < 0 or shelter_r >= flood_mask.shape[0] or shelter_c >= flood_mask.shape[1]
                or not valid_mask[shelter_r, shelter_c] or flood_mask[shelter_r, shelter_c]):
            continue
        dest = nearest_node((p.x, p.y))
        try:
            path = nx.shortest_path(graph, source, dest, weight="weight")
            cost = nx.path_weight(graph, path, weight="weight")
            choices.append((cost, ix, path, p))
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            continue
    if not choices:
        return None, None, road_parts, flooded
    cost, shelter_index, path, point = min(choices, key=lambda item: item[0])
    return {"coordinates": path, "shelter_index": shelter_index, "shelter": point,
            "length_m": cost}, source, road_parts, flooded
