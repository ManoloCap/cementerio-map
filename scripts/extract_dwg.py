"""Extract real survey geometry (contours, parcels, roads, walls, benchmarks)
from the cemetery's AutoCAD DWG file into static JSON for the web app.

Usage:
    python scripts/extract_dwg.py [--dwg PATH] [--out-dir DIR]

Requires the `aspose-cad` package (already installed in this environment).
Reads the DWG's entity object model directly -- no DWG->DXF conversion needed.
Trial-license limits on aspose-cad only affect image export/rendering, not
reading entity geometry, which is all this script does.
"""
import argparse
import json
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

import aspose.pycore as pycore
from aspose.cad import Image
from aspose.cad.fileformats.cad import CadImage
from aspose.cad.fileformats.cad.cadobjects import (
    CadCircle,
    CadInsertObject,
    CadLine,
    CadLwPolyline,
    CadMText,
    CadText,
)

DEFAULT_DWG = "public/map_images/ARCHIVO PARA FOTO (1).dwg"
DEFAULT_OUT_DIR = "public/data/dwg"

CONTOUR_LAYERS = {"C-TOPO-MAJR", "C-TOPO-MINR"}
MOJON_CIRCLE_LAYER = "MOJONES"
PARCEL_LAYERS = {
    "lotes cementerio",
    "A1 LOTES",
    "A2 LOTES",
    "B1 LOTES",
    "B2 LOTES",
    "C1 LOTES",
    "C2 LOTES",
}
ROAD_LAYERS = {"C-ROAD-STAN-MAJR", "C-ROAD-STAN-MINR", "C-ROAD-CNTR-N"}
WALL_LAYERS = {"PAREDES", "MUROS", "pared", "BANQUETA"}
DRAINAGE_LAYERS = {"CUNETAS", "CAJAS DE CUNETA"}
SITE_FEATURE_LAYERS = {"PARQUEOS", "GAVION", "TALUD PARQUEO ABAJO"}
SITE_BOUNDARY_LAYER = "ASTORIA POLIGONO"
NORTH_LAYER = "north"
TEXT_LABEL_LAYERS = {"textos", "TEXTO", "TEXTO LOTES"}
# Single/double-letter fragments and noise from spelled-out title-block text
# (e.g. a "MODIFICACIONES" banner stored as one TEXT entity per letter).
MIN_LABEL_LENGTH = 3
SECTOR_NAME_KEYWORDS = [
    "BUGANVILIAS",
    "BUGAMBILIAS",
    "HORTENCIAS",
    "EUCALIPTO",
    "CAPILLA",
    "CIPRES",
    "ENCINO",
]


COORD_PRECISION = 3  # millimeter precision is far finer than needed at this map scale


def r(value):
    return round(value, COORD_PRECISION)


def rpt(pt):
    return [r(pt[0]), r(pt[1])]


def _perp_dist(pt, a, b):
    if a == b:
        return ((pt[0] - a[0]) ** 2 + (pt[1] - a[1]) ** 2) ** 0.5
    x, y = pt
    x1, y1 = a
    x2, y2 = b
    num = abs((x2 - x1) * (y - y1) - (x - x1) * (y2 - y1))
    den = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    return num / den


def simplify_polyline(points, tolerance):
    """Douglas-Peucker simplification. CAD-flattened curves (contours, etc.)
    carry far denser vertex sampling than this map's scale needs."""
    if len(points) <= 2:
        return points

    def rdp(pts):
        if len(pts) <= 2:
            return pts
        a, b = pts[0], pts[-1]
        max_dist, idx = -1, -1
        for i in range(1, len(pts) - 1):
            d = _perp_dist(pts[i], a, b)
            if d > max_dist:
                max_dist, idx = d, i
        if max_dist <= tolerance:
            return [a, b]
        left = rdp(pts[: idx + 1])
        right = rdp(pts[idx:])
        return left[:-1] + right

    return rdp(points)


def load_model_space_entities(dwg_path: str):
    img = pycore.cast(CadImage, Image.load(dwg_path))
    blocks = list(img.block_entities.values_typed)
    model_block = next(b for b in blocks if getattr(b, "name", None) == "*Model_Space")
    return list(model_block.entities)


def filter_by_layer(entities, layer_names):
    return [e for e in entities if getattr(e, "layer_name", None) in layer_names]


def strip_mtext_formatting(raw):
    """AutoCAD MTEXT rich-text codes look like '{\\fArial|b0|i0|c0|p34;7}'.
    The real content is after the last ';' before the trailing '}'.
    """
    if raw is None:
        return ""
    match = re.search(r";([^;{}]+)\}?\s*$", raw)
    if match:
        return match.group(1).strip()
    return re.sub(r"\{[^}]*\}", "", raw).strip()


def extract_text_labels(entities):
    """Plain readable labels from the drawing (sector names, chapel names,
    road/feature callouts) -- not used for rendering geometry, but the most
    direct way to identify which real-world feature is where, both for the
    --dry-run preview and for area/sector name matching.
    """
    out = []
    for e in filter_by_layer(entities, TEXT_LABEL_LAYERS):
        if e.type_name.name == "MTEXT":
            t = pycore.cast(CadMText, e)
            text = strip_mtext_formatting(t.text)
            pt = t.insertion_point
        elif e.type_name.name == "TEXT":
            t = pycore.cast(CadText, e)
            text = (t.default_value or "").strip()
            pt = t.second_alignment_point
        else:
            continue
        text = " ".join(text.split())  # collapse "C A L L E" spacing noise later if needed, keep as-is otherwise
        if len(text) < MIN_LABEL_LENGTH:
            continue
        out.append({"id": f"text_{len(out):04d}", "layer": e.layer_name, "text": text, "utm": rpt([pt.x, pt.y])})
    return out


def extract_contours(entities):
    out = []
    i = 0
    for e in filter_by_layer(entities, CONTOUR_LAYERS):
        if e.type_name.name != "LWPOLYLINE":
            continue
        poly = pycore.cast(CadLwPolyline, e)
        coords = [rpt([c.x, c.y]) for c in poly.coordinates]
        coords = simplify_polyline(coords, tolerance=0.35)
        if len(coords) < 2:
            continue
        out.append(
            {
                "id": f"contour_{i:04d}",
                "layer": e.layer_name,
                "elevation_m": round(poly.elevation, 2),
                "is_major": e.layer_name == "C-TOPO-MAJR",
                "points_utm": coords,
            }
        )
        i += 1
    return out


def extract_mojones(entities):
    """Real surveyed benchmark monument positions (CIRCLE entities on layer
    MOJONES). Note: the MOJONES NUMERACION text labels turn out to live in a
    coordinate-table block far from their corresponding circles (checked: the
    nearest label-to-circle distance across all 23 labels is 58-190m, ruling
    out both proximity-matching and insertion-order-matching) and the INFO
    MOJONES layer has zero entities -- so there is no reliable way to attach
    a benchmark number to each point. Emitted unlabeled; this is only used as
    an optional debug/QA overlay, not for point placement.
    """
    out = []
    for e in filter_by_layer(entities, {MOJON_CIRCLE_LAYER}):
        if e.type_name.name != "CIRCLE":
            continue
        c = pycore.cast(CadCircle, e)
        out.append({"id": f"mojon_{len(out):03d}", "utm": rpt([c.center_point.x, c.center_point.y])})
    return out


def polyline_or_line_points(e):
    tn = e.type_name.name
    if tn == "LWPOLYLINE":
        poly = pycore.cast(CadLwPolyline, e)
        return [rpt([c.x, c.y]) for c in poly.coordinates]
    if tn == "LINE":
        line = pycore.cast(CadLine, e)
        return [rpt([line.first_point.x, line.first_point.y]), rpt([line.second_point.x, line.second_point.y])]
    return None


def extract_polylines_by_layer(entities, layer_name, id_prefix):
    out = []
    i = 0
    for e in filter_by_layer(entities, {layer_name}):
        pts = polyline_or_line_points(e)
        if not pts or len(pts) < 2:
            continue
        pts = simplify_polyline(pts, tolerance=0.1)
        closed = pts[0] == pts[-1]
        out.append(
            {
                "id": f"{id_prefix}_{i:04d}",
                "layer": layer_name,
                "closed": closed,
                "points_utm": pts,
            }
        )
        i += 1
    return out


def renumber_ids(records, prefix):
    """extract_polylines_by_layer restarts its counter per layer, so calling
    it once per layer (as extract_parcels/extract_by_layer_set do) produces
    duplicate ids across layers (e.g. two different 'wall_0060' records).
    Renumber once the layers are concatenated so every id is unique."""
    for i, rec in enumerate(records):
        rec["id"] = f"{prefix}_{i:04d}"
    return records


def extract_parcels(entities):
    out = []
    for layer in sorted(PARCEL_LAYERS):
        for rec in extract_polylines_by_layer(entities, layer, "parcel"):
            rec["sector"] = layer
            out.append(rec)
    return renumber_ids(out, "parcel")


def extract_by_layer_set(entities, layers, id_prefix):
    out = []
    for layer in sorted(layers):
        out.extend(extract_polylines_by_layer(entities, layer, id_prefix))
    return renumber_ids(out, id_prefix)


def extract_sector_labels(entities):
    out = []
    for e in entities:
        if e.type_name.name != "INSERT":
            continue
        ins = pycore.cast(CadInsertObject, e)
        name = ins.name or ""
        if any(kw in name.upper() for kw in SECTOR_NAME_KEYWORDS):
            pt = ins.insertion_point
            out.append(
                {
                    "id": f"sector_label_{len(out):03d}",
                    "block_name": name,
                    "layer": e.layer_name,
                    "utm": rpt([pt.x, pt.y]),
                }
            )
    return out


def extract_site_boundary(entities, fallback_layers_data):
    boundary = extract_polylines_by_layer(entities, SITE_BOUNDARY_LAYER, "boundary")
    if boundary:
        return boundary, "astoria_poligono"

    # Fallback: convex hull of all known site-feature points.
    all_pts = []
    for group in fallback_layers_data:
        for rec in group:
            all_pts.extend(rec["points_utm"])
    if not all_pts:
        return [], "none"

    hull = convex_hull(all_pts)
    return (
        [{"id": "boundary_hull_0000", "layer": "computed", "closed": True, "points_utm": hull}],
        "convex_hull_fallback",
    )


def convex_hull(points):
    pts = sorted(set(map(tuple, points)))
    if len(pts) <= 2:
        return [list(p) for p in pts]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return [list(p) for p in lower[:-1] + upper[:-1]]


def extract_north_arrow(entities):
    layer_entities = filter_by_layer(entities, {NORTH_LAYER})
    pts = []
    for e in layer_entities:
        p = polyline_or_line_points(e)
        if p:
            pts.extend(p)

    if len(pts) >= 2:
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        dx, dy = x2 - x1, y2 - y1
        import math

        angle = math.degrees(math.atan2(dx, dy))
        return {
            "angle_deg_from_utm_north": angle,
            "raw_vector_utm": [[x1, y1], [x2, y2]],
            "source": "north_layer",
        }

    return {
        "angle_deg_from_utm_north": 0.0,
        "raw_vector_utm": None,
        "source": "default_utm_grid_north",
        "note": "the 'north' layer has no geometry in model space; UTM grid north "
        "is used as-is (negligible convergence-angle error at this latitude/zone)",
    }


def trim_outliers(values, k=3.0):
    if len(values) < 4:
        return values
    q1 = statistics.quantiles(values, n=4)[0]
    q3 = statistics.quantiles(values, n=4)[2]
    iqr = q3 - q1
    lo, hi = q1 - k * iqr, q3 + k * iqr
    return [v for v in values if lo <= v <= hi]


def build_trusted_bounds(contours, margin=300.0):
    """contours.json never carries outliers (verified), so use its bbox,
    padded, as a sanity envelope for every other layer. Real CAD files like
    this one have stray entities at wildly wrong coordinates (one was found
    at X=1.5M/Y=3.2M, ~3000km from the real site) -- drop any record that
    strays outside this envelope rather than let it corrupt bounding boxes
    or convex hulls downstream."""
    xs = [x for c in contours for x, _ in c["points_utm"]]
    ys = [y for c in contours for _, y in c["points_utm"]]
    return (min(xs) - margin, max(xs) + margin, min(ys) - margin, max(ys) + margin)


def filter_records_within_bounds(records, bounds):
    min_x, max_x, min_y, max_y = bounds
    kept = []
    dropped = 0
    for rec in records:
        if all(min_x <= x <= max_x and min_y <= y <= max_y for x, y in rec["points_utm"]):
            kept.append(rec)
        else:
            dropped += 1
    return kept, dropped


def filter_points_within_bounds(records, bounds):
    min_x, max_x, min_y, max_y = bounds
    return [r for r in records if min_x <= r["utm"][0] <= max_x and min_y <= r["utm"][1] <= max_y]


def compute_site_extent(*point_groups):
    xs, ys = [], []
    for group in point_groups:
        for rec in group:
            for x, y in rec["points_utm"]:
                xs.append(x)
                ys.append(y)
    xs = trim_outliers(xs)
    ys = trim_outliers(ys)
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return {
        "min_utm": [min_x, min_y],
        "max_utm": [max_x, max_y],
        "center_utm": [(min_x + max_x) / 2, (min_y + max_y) / 2],
        "width_m": max_x - min_x,
        "height_m": max_y - min_y,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dwg", default=DEFAULT_DWG)
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading DWG: {args.dwg}")
    entities = load_model_space_entities(args.dwg)
    print(f"Model space entities: {len(entities)}")

    contours = extract_contours(entities)
    mojones = extract_mojones(entities)
    parcels = extract_parcels(entities)
    sector_labels = extract_sector_labels(entities)
    roads = extract_by_layer_set(entities, ROAD_LAYERS, "road")
    walls = extract_by_layer_set(entities, WALL_LAYERS, "wall")
    drainage = extract_by_layer_set(entities, DRAINAGE_LAYERS, "drainage")
    site_features = extract_by_layer_set(entities, SITE_FEATURE_LAYERS, "feature")
    text_labels = extract_text_labels(entities)

    # contours.json is verified outlier-free; use it to sanity-bound every
    # other layer before computing boundaries/extents from them (real CAD
    # files like this one carry stray junk entities at wildly wrong coords).
    bounds = build_trusted_bounds(contours)
    parcels, n_dropped = filter_records_within_bounds(parcels, bounds)
    if n_dropped:
        print(f"Dropped {n_dropped} out-of-bounds parcel record(s)")
    roads, n_dropped = filter_records_within_bounds(roads, bounds)
    if n_dropped:
        print(f"Dropped {n_dropped} out-of-bounds road record(s)")
    walls, n_dropped = filter_records_within_bounds(walls, bounds)
    if n_dropped:
        print(f"Dropped {n_dropped} out-of-bounds wall record(s)")
    drainage, n_dropped = filter_records_within_bounds(drainage, bounds)
    if n_dropped:
        print(f"Dropped {n_dropped} out-of-bounds drainage record(s)")
    site_features, n_dropped = filter_records_within_bounds(site_features, bounds)
    if n_dropped:
        print(f"Dropped {n_dropped} out-of-bounds site_feature record(s)")

    mojones = filter_points_within_bounds(mojones, bounds)
    sector_labels = filter_points_within_bounds(sector_labels, bounds)
    text_labels = filter_points_within_bounds(text_labels, bounds)

    site_boundary, boundary_source = extract_site_boundary(
        entities, [parcels, roads, walls]
    )
    north_arrow = extract_north_arrow(entities)
    site_extent = compute_site_extent(parcels, roads, walls, contours)

    layer_counts = {}
    for e in entities:
        name = getattr(e, "layer_name", None)
        if name:
            layer_counts[name] = layer_counts.get(name, 0) + 1

    extraction_meta = {
        "source_dwg": args.dwg,
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "aspose_cad_version": "26.3",
        "site_boundary_source": boundary_source,
        "entity_counts_by_layer": layer_counts,
    }

    outputs = {
        "contours.json": contours,
        "mojones.json": mojones,
        "parcels.json": parcels,
        "sector_labels.json": sector_labels,
        "text_labels.json": text_labels,
        "roads.json": roads,
        "walls.json": walls,
        "drainage.json": drainage,
        "site_features.json": site_features,
        "site_boundary.json": site_boundary,
        "north_arrow.json": north_arrow,
        "site_extent.json": site_extent,
        "extraction_meta.json": extraction_meta,
    }

    print()
    print("Summary:")
    for filename, data in outputs.items():
        path = out_dir / filename
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        count = len(data) if isinstance(data, list) else 1
        size_kb = path.stat().st_size / 1024
        print(f"  {filename:24s} {count:6d} records  {size_kb:9.1f} KB")

    print()
    print(f"Site extent: {site_extent['width_m']:.1f}m x {site_extent['height_m']:.1f}m")
    print(f"North arrow: {north_arrow['source']} ({north_arrow['angle_deg_from_utm_north']:.2f} deg)")
    print(f"Site boundary source: {boundary_source}")


if __name__ == "__main__":
    main()
