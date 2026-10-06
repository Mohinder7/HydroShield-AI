"""Flood-aware graph routing from user-provided roads and shelter data."""
import math
import networkx as nx
import numpy as np
import geopandas as gpd
from pyproj import CRS
from shapely.geometry import GeometryCollection, LineString, MultiLineString, Point, Polygon


def load_vectors(roads_path, shelters_path, raster_crs):
    roads = gpd.read_file(roads_path)
    shelters = gpd.read_file(shelters_path)
    if roads.crs is None or shelters.crs is None:
        raise ValueError("Road and shelter datasets must each declare a CRS.")
    return roads.to_crs(raster_crs), shelters.to_crs(raster_crs)


def _xy_key(point):
    return (round(point[0], 8), round(point[1], 8))


def _lines(geometry):
    if isinstance(geometry, LineString):
        return [geometry]
    if isinstance(geometry, MultiLineString):
        return list(geometry.geoms)
    if isinstance(geometry, GeometryCollection):
        return [line for part in geometry.geoms for line in _lines(part)]
    return []


def _raster_cell(transform, shape, xy):
    col, row = (~transform) * xy
    height, width = shape
    tolerance = 1e-9
    if col < -tolerance or row < -tolerance or col > width + tolerance or row > height + tolerance:
        return None
    return min(max(math.floor(row), 0), height - 1), min(max(math.floor(col), 0), width - 1)


def route(roads, shelters, flood_mask, valid_mask, transform, start_xy, flood_fraction_limit=0.40, raster_crs=None):
    """Route through covered road segments, excluding flooded or nodata samples."""
    graph = nx.Graph()
    road_parts, flooded = [], []
    height, width = flood_mask.shape
    raster_footprint = Polygon([
        transform * (0, 0),
        transform * (width, 0),
        transform * (width, height),
        transform * (0, height),
    ])
    start_cell = _raster_cell(transform, flood_mask.shape, start_xy)
    # If start is flooded or outside raster, we still try to route —
    # the graph will simply exclude flooded road segments.
    # Only hard-fail if start is outside the raster by a large margin.
    if start_cell is None:
        # Check if start is within 20% of raster extent outside the bounds
        col, row = (~transform) * start_xy
        height, width = flood_mask.shape
        margin_col = width * 0.20
        margin_row = height * 0.20
        if col < -margin_col or row < -margin_row or col > width + margin_col or row > height + margin_row:
            return None, None, road_parts, flooded
    column_size = math.hypot(transform.a, transform.d)
    row_size = math.hypot(transform.b, transform.e)
    crs = CRS.from_user_input(raster_crs) if raster_crs is not None else None
    geod = crs.get_geod() if crs is not None and crs.is_geographic else None
    unit_scale = (
        crs.axis_info[0].unit_conversion_factor or 1.0
        if crs is not None and crs.is_projected and crs.axis_info
        else 1.0
    )
    # For geographic CRS (degrees), sub-pixel spacing produces millions of
    # samples per road. Cap at 0.001° (~100 m) to keep sampling tractable.
    # For projected CRS (metres), cap at 100 m.
    min_spacing = 0.001 if (crs is None or not crs.is_projected) else 100.0
    sample_spacing = max(min(column_size, row_size) / 2, min_spacing)

    def distance_m(a, b):
        if geod is not None:
            return geod.inv(a[0], a[1], b[0], b[1])[2]
        return Point(a).distance(Point(b)) * unit_scale

    for _, row in roads.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        for line in _lines(geom.intersection(raster_footprint)):
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
                cell = _raster_cell(transform, flood_mask.shape, (point.x, point.y))
                if cell is None:
                    coverage_ok = False
                    continue
                if not valid_mask[cell]:
                    coverage_ok = False
                samples.append(bool(flood_mask[cell]))
            # Roads outside raster coverage or crossing nodata are excluded as unknown.
            affected = (not coverage_ok) or (not samples) or np.mean(samples) > flood_fraction_limit
            road_parts.append(line)
            flooded.append(affected)
            if affected:
                continue
            for a, b in zip(coords[:-1], coords[1:]):
                u, v = _xy_key(a), _xy_key(b)
                length = distance_m(a, b)
                if length == 0:
                    continue
                if graph.has_edge(u, v):
                    graph[u][v]["weight"] = min(length, graph[u][v]["weight"])
                else:
                    graph.add_edge(u, v, weight=length)
    if not graph:
        return None, None, road_parts, flooded

    def nearest_node(xy):
        return min(graph.nodes, key=lambda node: distance_m(node, xy))

    source = nearest_node(start_xy)
    choices = []
    for ix, row in shelters.iterrows():
        p = row.geometry
        if p is None or p.is_empty or not isinstance(p, Point):
            continue
        # Only skip a shelter if it is explicitly inside the raster AND flooded.
        # Shelters outside the raster footprint are assumed to be on dry land
        # (they were not covered by the SAR pass) and are still valid destinations.
        shelter_cell = _raster_cell(transform, flood_mask.shape, (p.x, p.y))
        if shelter_cell is not None:
            # Inside raster: skip only if the shelter pixel itself is flooded
            if flood_mask[shelter_cell]:
                continue
            # nodata pixels: shelter is considered reachable (benefit of the doubt)
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
