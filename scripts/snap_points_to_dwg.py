"""Match each cemetery_points.json area to its real DWG geometry, then snap
that area's photo-sequence points onto the matched path/polygon and
interpolate elevation from the nearest contour lines.

Two-phase, with a mandatory human checkpoint in between:

    python scripts/snap_points_to_dwg.py --dry-run
        -> writes scripts/output/match_candidates.json (best-effort fuzzy
           name matches) and scripts/output/match_preview.svg (a real-shaped
           render of all parcels/roads/walls/mojones, labeled by id, for a
           human to visually cross-reference against the cemetery's actual
           layout) and a starter scripts/output/area_geometry_map.json.
        Review/edit that last file, then copy it to
        src/data/dwg/area_geometry_map.json (the authoritative, committed
        version) before running --apply.

    python scripts/snap_points_to_dwg.py --apply
        -> reads src/data/dwg/area_geometry_map.json, snaps each mapped
           area's points by arc-length along the matched geometry,
           interpolates elevation from contours.json, and writes a new
           nested "geo" field into each point in cemetery_points.json.
"""
import argparse
import json
import math
from pathlib import Path

DWG_DATA_DIR = Path("public/data/dwg")
POINTS_PATH = Path("src/components/cemetery_points.json")
AREA_GEOMETRY_MAP_PATH = Path("src/data/dwg/area_geometry_map.json")
OUTPUT_DIR = Path("scripts/output")

# AREAS keys from TerrainMap.jsx, with keyword hints for fuzzy matching
# against DWG text/sector labels. Full phrases (not bare "CIPRES") so
# "cipreses" and "paseo_cipreses" -- confirmed by the user to be two
# distinct physical areas -- don't cross-match each other's labels.
# "demo" is deliberately excluded -- it's synthetic placeholder data, never
# snapped to real geo.
AREA_KEYWORDS = {
    "cipreses": ["JARDIN CIPRESES"],
    "bugambilias": ["JARDIN BUGANVILIAS", "JARDIN BUGAMBILIAS"],
    "encinos": ["JARDIN ENCINOS"],
    "unknown_section_1": [],
    "unknown_section_2": [],
    "comoding_1": [],
    "paseo_cipreses": ["PASEO CIPRESES"],
    "comoding_2": [],
    "area7": [],
}


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_dwg_layer(name):
    return load_json(DWG_DATA_DIR / name)


def fuzzy_match_candidates(area_id, keywords, sector_labels, parcels, text_labels):
    candidates = []
    for label in sector_labels:
        name = label["block_name"].upper()
        if any(kw in name for kw in keywords):
            candidates.append(
                {"geometry_source": "sector_labels", "id": label["id"], "block_name": label["block_name"]}
            )
    for parcel in parcels:
        sector = parcel["sector"].upper()
        if any(kw in sector for kw in keywords):
            candidates.append({"geometry_source": "parcels", "id": parcel["id"], "sector": parcel["sector"]})
    for label in text_labels:
        text = label["text"].upper()
        if any(kw in text for kw in keywords):
            candidates.append(
                {
                    "geometry_source": "text_labels",
                    "id": label["id"],
                    "text": label["text"],
                    "utm": label["utm"],
                    "note": "an anchor point, not a path/polygon -- use to manually pick the nearest real "
                    "wall/road/parcel id, or place this area's points by hand near this coordinate",
                }
            )
    return candidates


def _point_to_segment_distance(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _distance_to_record(anchor, record):
    pts = record["points_utm"]
    return min(_point_to_segment_distance(anchor, pts[i - 1], pts[i]) for i in range(1, len(pts)))


def _record_length(record):
    pts = record["points_utm"]
    return sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, len(pts)))


def find_nearest_geometry(anchor_utm, parcels, roads, walls, max_distance=80.0, min_length=20.0):
    """A text-label anchor is a single point, not the path/polygon the
    snapping pass needs. Resolve it to the nearest real geometry record long
    enough to meaningfully spread a sequence of points along (most
    individual wall/parcel records here are single short edges a few meters
    long -- not usable paths, even when they happen to be the closest thing
    to the anchor), so the starter map is directly usable, while surfacing
    the distance for human sanity-checking.
    """
    best = None
    for source, records in (("roads", roads), ("walls", walls), ("parcels", parcels)):
        for rec in records:
            if _record_length(rec) < min_length:
                continue
            d = _distance_to_record(anchor_utm, rec)
            if best is None or d < best[0]:
                best = (d, source, rec["id"])
    if best is None or best[0] > max_distance:
        return None
    distance, source, rec_id = best
    return {"geometry_source": source, "id": rec_id, "distance_m": round(distance, 1)}


def run_dry_run():
    points = load_json(POINTS_PATH)
    sector_labels = load_dwg_layer("sector_labels.json")
    parcels = load_dwg_layer("parcels.json")
    roads = load_dwg_layer("roads.json")
    walls = load_dwg_layer("walls.json")
    site_boundary = load_dwg_layer("site_boundary.json")
    mojones = load_dwg_layer("mojones.json")
    text_labels = load_dwg_layer("text_labels.json")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    candidates_out = {}
    starter_map = {}
    for area_id, area_points in points.items():
        if area_id == "demo":
            starter_map[area_id] = {"geometry_source": None, "id": None, "note": "demo area, keep synthetic position"}
            continue
        keywords = AREA_KEYWORDS.get(area_id, [])
        matches = fuzzy_match_candidates(area_id, keywords, sector_labels, parcels, text_labels)
        # Only a parcels/sector_labels/roads/walls match carries usable path
        # geometry for --apply; a text_labels hit is just an anchor coordinate.
        usable = [m for m in matches if m["geometry_source"] != "text_labels"]
        resolved = None
        text_matches = [m for m in matches if m["geometry_source"] == "text_labels"]
        if not usable and text_matches:
            # Have named anchor(s) (e.g. all 3 "JARDIN BUGANVILIAS N" labels)
            # but no direct path/polygon match -- average them into one
            # centroid anchor and resolve to the nearest real geometry, so
            # the starter map is directly usable, not just a coordinate.
            cx = sum(m["utm"][0] for m in text_matches) / len(text_matches)
            cy = sum(m["utm"][1] for m in text_matches) / len(text_matches)
            resolved = find_nearest_geometry([cx, cy], parcels, roads, walls)

        confidence = "high" if usable else ("anchor_resolved" if resolved else ("anchor_only" if matches else "none"))
        candidates_out[area_id] = {
            "point_count": len(area_points),
            "candidate_layer_ids": matches,
            "confidence": confidence,
        }

        if usable:
            note = "auto-matched by name keyword; verify against match_preview.svg before trusting"
            geometry_source, geometry_id = usable[0]["geometry_source"], usable[0]["id"]
        elif resolved:
            labels = ", ".join(repr(m["text"]) for m in text_matches)
            note = (
                f"anchored by label(s) {labels}; resolved to nearest "
                f"{resolved['geometry_source']} {resolved['id']} ({resolved['distance_m']}m away) -- verify"
            )
            geometry_source, geometry_id = resolved["geometry_source"], resolved["id"]
        elif matches:
            note = (
                f"only a text-label anchor found ({matches[0]['text']!r} near {matches[0]['utm']}); "
                "pick the nearest real parcel/road/wall id from match_preview.svg by hand"
            )
            geometry_source, geometry_id = None, None
        else:
            note = "REVIEW: fill in by cross-referencing match_preview.svg with the cemetery's real layout"
            geometry_source, geometry_id = None, None

        starter_map[area_id] = {"geometry_source": geometry_source, "id": geometry_id, "note": note}

    (OUTPUT_DIR / "match_candidates.json").write_text(json.dumps(candidates_out, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "area_geometry_map.json").write_text(json.dumps(starter_map, indent=2), encoding="utf-8")

    render_preview_svg(
        parcels, roads, walls, site_boundary, mojones, sector_labels, text_labels, OUTPUT_DIR / "match_preview.svg"
    )

    print(f"Wrote {OUTPUT_DIR / 'match_candidates.json'}")
    print(f"Wrote {OUTPUT_DIR / 'area_geometry_map.json'} (starter -- review and edit)")
    print(f"Wrote {OUTPUT_DIR / 'match_preview.svg'} (open in a browser to inspect real layout)")
    print()
    print("Next: review the candidates + preview, edit area_geometry_map.json as needed,")
    print(f"then copy your reviewed version to {AREA_GEOMETRY_MAP_PATH} and run --apply.")


def render_preview_svg(parcels, roads, walls, site_boundary, mojones, sector_labels, text_labels, out_path):
    all_pts = []
    for group in (parcels, roads, walls, site_boundary):
        for rec in group:
            all_pts.extend(rec["points_utm"])
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    width_m, height_m = max_x - min_x, max_y - min_y
    pad = 40
    scale = (1400 - pad * 2) / max(width_m, height_m)
    vb_w = pad * 2 + width_m * scale
    vb_h = pad * 2 + height_m * scale

    def to_svg(x, y):
        return pad + (x - min_x) * scale, pad + (max_y - y) * scale

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb_w:.0f} {vb_h:.0f}" '
             f'font-family="sans-serif">']
    parts.append(f'<rect width="{vb_w:.0f}" height="{vb_h:.0f}" fill="#f4f3ef"/>')

    for rec in walls:
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (to_svg(*p) for p in rec["points_utm"]))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="#bbb" stroke-width="0.5"/>')

    for rec in roads:
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (to_svg(*p) for p in rec["points_utm"]))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="#888" stroke-width="1"/>')

    for rec in site_boundary:
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (to_svg(*p) for p in rec["points_utm"]))
        parts.append(f'<polygon points="{pts}" fill="none" stroke="#222" stroke-width="2"/>')

    colors = ["#e74c3c", "#3498db", "#f39c12", "#9b59b6", "#16a085", "#d35400", "#27ae60", "#8e44ad"]
    for i, rec in enumerate(parcels):
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (to_svg(*p) for p in rec["points_utm"]))
        color = colors[i % len(colors)]
        cx = sum(p[0] for p in rec["points_utm"]) / len(rec["points_utm"])
        cy = sum(p[1] for p in rec["points_utm"]) / len(rec["points_utm"])
        lx, ly = to_svg(cx, cy)
        parts.append(f'<polygon points="{pts}" fill="{color}33" stroke="{color}" stroke-width="0.8"/>')
        parts.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-size="7" fill="#333">{rec["id"]}</text>')

    for rec in sector_labels:
        x, y = to_svg(*rec["utm"])
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="#000"/>')
        parts.append(f'<text x="{x+5:.1f}" y="{y:.1f}" font-size="8" fill="#000" font-weight="bold">{rec["block_name"]}</text>')

    for rec in mojones:
        x, y = to_svg(*rec["utm"])
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.5" fill="#999"/>')

    def esc(s):
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    for rec in text_labels:
        x, y = to_svg(*rec["utm"])
        parts.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="5" fill="#2266aa">{esc(rec["text"])}</text>')

    parts.append("</svg>")
    out_path.write_text("\n".join(parts), encoding="utf-8")


# --- snapping (--apply) -----------------------------------------------

def cumulative_arc_length(points):
    lengths = [0.0]
    for i in range(1, len(points)):
        x1, y1 = points[i - 1]
        x2, y2 = points[i]
        lengths.append(lengths[-1] + math.hypot(x2 - x1, y2 - y1))
    return lengths


def point_at_t(points, lengths, t):
    """t in [0,1], normalized position along cumulative arc length."""
    total = lengths[-1]
    if total == 0:
        return points[0]
    target = t * total
    for i in range(1, len(lengths)):
        if lengths[i] >= target:
            seg_len = lengths[i] - lengths[i - 1]
            local_t = 0.0 if seg_len == 0 else (target - lengths[i - 1]) / seg_len
            x1, y1 = points[i - 1]
            x2, y2 = points[i]
            return [x1 + (x2 - x1) * local_t, y1 + (y2 - y1) * local_t]
    return points[-1]


def point_to_segment_distance(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def distance_to_polyline(p, points):
    return min(point_to_segment_distance(p, points[i - 1], points[i]) for i in range(1, len(points)))


def interpolate_elevation(point_utm, contours, search_radius=40.0):
    nearby = []
    for c in contours:
        d = distance_to_polyline(point_utm, c["points_utm"])
        if d <= search_radius:
            nearby.append((d, c["elevation_m"]))
    if not nearby:
        # widen search if nothing found nearby (e.g. point near map edge)
        for c in contours:
            d = distance_to_polyline(point_utm, c["points_utm"])
            nearby.append((d, c["elevation_m"]))
    nearby.sort(key=lambda x: x[0])

    d1, e1 = nearby[0]
    for d2, e2 in nearby[1:]:
        if e2 != e1:
            if d1 + d2 == 0:
                return e1
            return (e1 * d2 + e2 * d1) / (d1 + d2)
    return e1


def resolve_geometry(mapping, parcels, roads, walls, sector_labels):
    source = mapping.get("geometry_source")
    gid = mapping.get("id")
    if not source or not gid:
        return None
    table = {"parcels": parcels, "roads": roads, "walls": walls, "sector_labels": sector_labels}.get(source)
    if not table:
        return None
    for rec in table:
        if rec["id"] == gid:
            return rec
    return None


def run_apply():
    if not AREA_GEOMETRY_MAP_PATH.exists():
        raise SystemExit(
            f"{AREA_GEOMETRY_MAP_PATH} not found. Run --dry-run first, review "
            f"scripts/output/area_geometry_map.json, then copy your reviewed "
            f"version to {AREA_GEOMETRY_MAP_PATH}."
        )

    points = load_json(POINTS_PATH)
    area_geometry_map = load_json(AREA_GEOMETRY_MAP_PATH)
    parcels = load_dwg_layer("parcels.json")
    roads = load_dwg_layer("roads.json")
    walls = load_dwg_layer("walls.json")
    sector_labels = load_dwg_layer("sector_labels.json")
    contours = load_dwg_layer("contours.json")

    snapped_count = 0
    skipped_areas = []

    for area_id, area_points in points.items():
        mapping = area_geometry_map.get(area_id, {"geometry_source": None, "id": None})
        geometry = resolve_geometry(mapping, parcels, roads, walls, sector_labels)
        if not geometry or "points_utm" not in geometry:
            skipped_areas.append(area_id)
            continue

        path_points = geometry["points_utm"]
        lengths = cumulative_arc_length(path_points)
        n = len(area_points)

        for k, point in enumerate(area_points):
            t = 0.0 if n <= 1 else k / (n - 1)
            utm_point = point_at_t(path_points, lengths, t)
            elevation_m = interpolate_elevation(utm_point, contours)
            lat, lng = utm_to_wgs84(utm_point[0], utm_point[1])
            point["geo"] = {
                "utmX": round(utm_point[0], 3),
                "utmY": round(utm_point[1], 3),
                "lat": round(lat, 7),
                "lng": round(lng, 7),
                "elevationM": round(elevation_m, 2),
                "source": "dwg_snap",
                "pathT": round(t, 4),
            }
            snapped_count += 1

    POINTS_PATH.write_text(json.dumps(points, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Snapped {snapped_count} points across {len(points) - len(skipped_areas)} areas.")
    if skipped_areas:
        print(f"Skipped (no geometry mapping): {', '.join(skipped_areas)}")


# Canonical formula lives in src/utils/geo.js; duplicated here so the Python
# snapping pass can enrich points with lat/lng without a JS round-trip. Keep
# both in sync if the projection parameters ever change.
def utm_to_wgs84(easting, northing, zone=15):
    k0 = 0.9996
    a = 6378137.0
    e = 0.00669438
    e2, e3 = e * e, e * e * e
    e_p2 = e / (1 - e)

    sqrt_e = math.sqrt(1 - e)
    _e = (1 - sqrt_e) / (1 + sqrt_e)
    _e2, _e3, _e4, _e5 = _e**2, _e**3, _e**4, _e**5

    m1 = 1 - e / 4 - 3 * e2 / 64 - 5 * e3 / 256
    p2 = 3 / 2 * _e - 27 / 32 * _e3 + 269 / 512 * _e5
    p3 = 21 / 16 * _e2 - 55 / 32 * _e4
    p4 = 151 / 96 * _e3 - 417 / 128 * _e5
    p5 = 1097 / 512 * _e4

    x = easting - 500000
    y = northing
    m = y / k0
    mu = m / (a * m1)

    p_rad = mu + p2 * math.sin(2 * mu) + p3 * math.sin(4 * mu) + p4 * math.sin(6 * mu) + p5 * math.sin(8 * mu)
    p_sin = math.sin(p_rad)
    p_sin2 = p_sin * p_sin
    p_cos = math.cos(p_rad)
    p_tan = p_sin / p_cos
    p_tan2 = p_tan * p_tan
    p_tan4 = p_tan2 * p_tan2

    ep_sin = 1 - e * p_sin2
    ep_sin_sqrt = math.sqrt(1 - e * p_sin2)

    n = a / ep_sin_sqrt
    r = (1 - e) / ep_sin

    c = e_p2 * p_cos * p_cos
    c2 = c * c

    d = x / (n * k0)
    d2, d3, d4, d5, d6 = d**2, d**3, d**4, d**5, d**6

    latitude = (
        p_rad
        - (p_tan / r) * (d2 / 2 - d4 / 24 * (5 + 3 * p_tan2 + 10 * c - 4 * c2 - 9 * e_p2))
        + d6 / 720 * (61 + 90 * p_tan2 + 298 * c + 45 * p_tan4 - 252 * e_p2 - 3 * c2)
    )
    longitude = (
        d - d3 / 6 * (1 + 2 * p_tan2 + c) + d5 / 120 * (5 - 2 * c + 28 * p_tan2 - 3 * c2 + 8 * e_p2 + 24 * p_tan4)
    ) / p_cos

    lon_origin_rad = math.radians(zone * 6 - 183)
    return math.degrees(latitude), math.degrees(longitude + lon_origin_rad)


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        run_dry_run()
    else:
        run_apply()


if __name__ == "__main__":
    main()
