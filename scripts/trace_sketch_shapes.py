"""
trace_sketch_shapes.py
Extracts section polygon outlines from docs/image.png using per-scanline edge tracing.

For each section, the script finds the left/right pixel boundary at each y-scanline
within the section's spatial mask, then builds a polygon from those edges.
This produces smooth curves that match the actual sketch much better than convex hull.

Output: ready-to-paste polygon arrays for sections.js
SVG coordinate space: x 0-160, y 0-100 (viewBox="0 0 160 100" preserveAspectRatio="none")

Run from the project root:
  python scripts/trace_sketch_shapes.py
"""

import sys
import math
import numpy as np
from PIL import Image, ImageFilter

IMG_PATH = "docs/image.png"

img = Image.open(IMG_PATH).convert("RGB")
blurred = img.filter(ImageFilter.GaussianBlur(radius=5))
arr = np.array(blurred)
W, H = img.size  # 1600 x 1338

def to_svg_x(px): return round(px / W * 160, 1)
def to_svg_y(py): return round(py / H * 100, 1)

import sys
import math
import numpy as np
from PIL import Image, ImageFilter

IMG_PATH = "docs/image.png"

img = Image.open(IMG_PATH).convert("RGB")
blurred = img.filter(ImageFilter.GaussianBlur(radius=5))
arr = np.array(blurred)
W, H = img.size  # 1600 x 1338

def to_svg_x(px): return round(px / W * 160, 1)
def to_svg_y(py): return round(py / H * 100, 1)

r_ch = arr[:,:,0].astype(int)
g_ch = arr[:,:,1].astype(int)
b_ch = arr[:,:,2].astype(int)
mx   = np.max(arr, axis=2).astype(int)
mn   = np.min(arr, axis=2).astype(int)
sat  = mx - mn

is_any   = (sat > 18) & (mx > 50) & (mx < 248)
is_blue  = is_any & (b_ch > r_ch + 18) & (b_ch > g_ch + 3) & (b_ch > 75) & ~(g_ch > r_ch + 8)  # prevent blue/teal overlap
is_pink  = is_any & (r_ch > b_ch + 18) & (r_ch > 100) & (r_ch > g_ch - 35)
is_green = is_any & (g_ch > r_ch + 18) & (g_ch > b_ch + 8)
is_teal  = is_any & (g_ch > r_ch + 8) & (b_ch > r_ch + 8) & ~is_green
is_olive = is_any & (r_ch > g_ch - 20) & (g_ch > b_ch + 20) & (r_ch > 100)  # Olive/gold for 1A (Cipreses)


def px_range(svg_x1, svg_y1, svg_x2, svg_y2):
    """Convert SVG bbox to pixel bbox."""
    return (
        int(svg_x1 / 160 * W), int(svg_y1 / 100 * H),
        int(svg_x2 / 160 * W), int(svg_y2 / 100 * H),
    )


def trace_edges(color_mask, svg_x1, svg_y1, svg_x2, svg_y2,
                y_step=6, min_px=2, eps=0.5):
    """
    At each y-scanline (in steps of y_step pixels), find the leftmost and rightmost
    colored pixel within the horizontal range [svg_x1, svg_x2].
    Returns a closed polygon (left edge down + right edge up) in SVG coords.
    """
    px1, py1, px2, py2 = px_range(svg_x1, svg_y1, svg_x2, svg_y2)

    right_edge = []  # (svg_x, svg_y) going top→bottom
    left_edge  = []  # (svg_x, svg_y) going top→bottom

    for py in range(py1, py2, y_step):
        row = color_mask[py, px1:px2]
        xs  = np.where(row)[0] + px1
        if len(xs) < min_px:
            continue
        left_edge.append((to_svg_x(xs.min()), to_svg_y(py)))
        right_edge.append((to_svg_x(xs.max()), to_svg_y(py)))

    if len(left_edge) < 2:
        return []

    # Polygon = right edge going DOWN + reversed left edge going UP
    poly = right_edge + list(reversed(left_edge))
    return douglas_peucker(poly, eps)


def douglas_peucker(pts, eps):
    if len(pts) < 3:
        return pts
    def perp(pt, a, b):
        ax,ay=a; bx,by=b; px,py=pt
        dx,dy=bx-ax,by-ay
        if dx==0 and dy==0: return math.hypot(px-ax,py-ay)
        t=max(0.,min(1.,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)))
        return math.hypot(px-(ax+t*dx),py-(ay+t*dy))
    dmax,idx=0.,0
    for i in range(1,len(pts)-1):
        d=perp(pts[i],pts[0],pts[-1])
        if d>dmax: dmax,idx=d,i
    if dmax>eps:
        return douglas_peucker(pts[:idx+1],eps)[:-1]+douglas_peucker(pts[idx:],eps)
    return [pts[0],pts[-1]]


def fmt(poly, name):
    if not poly:
        print(f"  // {name}: NO PIXELS -- keep existing polygon")
        return
    coords = ",".join(f"[{x},{y}]" for x,y in poly)
    print(f"  // {name}: {len(poly)} vertices")
    print(f"  polygon: [{coords}],")


print("Extracting section polygons...\n")
print("// -- PASTE THESE INTO sections.js --\n")

# ── cipreses 1A (olive, left strip) ─────────────────────────────────────────
# Gold/olive strip at left going diagonally
print("// cipreses (1A) -- gold/olive diagonal strip at left")
poly_1a = trace_edges(is_olive, svg_x1=18, svg_y1=20, svg_x2=45, svg_y2=65, y_step=4, min_px=2, eps=0.4)
fmt(poly_1a, "cipreses")
print()

# ── bugambilias 1B (pink, larger curved strip above/right of 1A) ────────────
print("// bugambilias (1B) -- pink curved strip")
poly_1b = trace_edges(is_pink, svg_x1=15, svg_y1=10, svg_x2=65, svg_y2=62, y_step=4, min_px=2, eps=0.4)
fmt(poly_1b, "bugambilias")
print()

# ── comoding_1 (green, top arc) ─────────────────────────────────────────────
print("// comoding_1 -- green arc at top")
poly_c1 = trace_edges(is_green, svg_x1=35, svg_y1=8, svg_x2=72, svg_y2=48, y_step=4, min_px=2, eps=0.4)
fmt(poly_c1, "comoding_1")
print()

# ── encinos 3A+2A (pink, large diagonal central section) ────────────────────
# Exclude 1B region (x < 45 AND y < 55) and 5A (y > 68)
encinos_mask = is_pink.copy()
# Mask out 1B (upper-left pink area)
py_thresh_1b = int(55/100*H)
px_thresh_1b = int(45/160*W)
for py in range(0, py_thresh_1b):
    for px in range(0, px_thresh_1b):
        encinos_mask[py, px] = False
# More precisely: mask the entire 1B spatial box
py1_1b = int(10/100*H); py2_1b = int(62/100*H)
px1_1b = int(15/160*W); px2_1b = int(45/160*W)
encinos_mask[py1_1b:py2_1b, px1_1b:px2_1b] = False

print("// encinos (3A+2A) -- large diagonal pink section")
poly_en = trace_edges(encinos_mask, svg_x1=35, svg_y1=45, svg_x2=120, svg_y2=88, y_step=6, min_px=2, eps=0.4)
fmt(poly_en, "encinos")
print()

# ── paseo_cipreses 5A (blue, horizontal lower strip) ────────────────────────
print("// paseo_cipreses (5A) -- blue horizontal strip, lower area")
poly_5a = trace_edges(is_blue, svg_x1=12, svg_y1=45, svg_x2=75, svg_y2=70, y_step=4, min_px=2, eps=0.4)
fmt(poly_5a, "paseo_cipreses")
print()

# ── comoding_2 (teal, thin vertical strip center-right) ─────────────────────
print("// comoding_2 -- teal thin vertical strip")
poly_c2 = trace_edges(is_teal, svg_x1=100, svg_y1=28, svg_x2=122, svg_y2=60, y_step=4, min_px=2, eps=0.3)
fmt(poly_c2, "comoding_2")
print()

# ── 7A zones (green, right cluster split into 3 vertical slices) ─────────────
# Find the x range of the green cluster to split it into thirds
ys7, xs7 = np.where(is_green & (arr[:,:,0] < 200))  # filter very yellow-green
px7_lo = int(118/160*W)
px7_hi = int(142/160*W)
green_right = is_green.copy()
green_right[:, :px7_lo] = False
green_right[:, px7_hi:] = False
ys7r, xs7r = np.where(green_right)

if len(xs7r):
    x_min7 = xs7r.min()
    x_max7 = xs7r.max()
    sw = (x_max7 - x_min7) // 3

    print("// area7_z1 -- left third of right green cluster")
    z1_mask = green_right.copy()
    z1_mask[:, x_min7+sw:] = False
    poly_z1 = trace_edges(z1_mask, svg_x1=118, svg_y1=38, svg_x2=142, svg_y2=90, y_step=4, min_px=2, eps=0.3)
    fmt(poly_z1, "area7_z1")
    print()

    print("// area7_z2 -- middle third")
    z2_mask = green_right.copy()
    z2_mask[:, :x_min7+sw] = False
    z2_mask[:, x_min7+2*sw:] = False
    poly_z2 = trace_edges(z2_mask, svg_x1=118, svg_y1=38, svg_x2=142, svg_y2=90, y_step=4, min_px=2, eps=0.3)
    fmt(poly_z2, "area7_z2")
    print()

    print("// area7_z3 -- right third")
    z3_mask = green_right.copy()
    z3_mask[:, :x_min7+2*sw] = False
    poly_z3 = trace_edges(z3_mask, svg_x1=118, svg_y1=38, svg_x2=142, svg_y2=90, y_step=4, min_px=2, eps=0.3)
    fmt(poly_z3, "area7_z3")
    print()
else:
    print("// area7: NO PIXELS FOUND")
    poly_z1 = poly_z2 = poly_z3 = []
    print()

# ── hortensias (bottom strip, mixed pink + green) ────────────────────────────
print("// hortensias -- bottom horizontal strip")
hortensia_mask = (is_pink | is_green).copy()
# Only bottom region
hortensia_mask[:int(72/100*H), :] = False
poly_hor = trace_edges(hortensia_mask, svg_x1=15, svg_y1=72, svg_x2=145, svg_y2=92, y_step=4, min_px=2, eps=0.4)
fmt(poly_hor, "hortensias")
print()

print("// -- SUMMARY --")
for name, poly in [("1A",poly_1a),("1B",poly_1b),("C1",poly_c1),("EN",poly_en),
                   ("5A",poly_5a),("C2",poly_c2),("Z1",poly_z1),("Z2",poly_z2),
                   ("Z3",poly_z3),("HO",poly_hor)]:
    status = f"{len(poly)} pts" if poly else "MISSING"
    print(f"  {name}: {status}")
