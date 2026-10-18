"""Margin patterns for the page's side gutters. Black on transparent: the page
uses them as CSS masks, so one file serves the blue and the white sections."""
import math

def write(name, w, h, body):
    open(f"public/pattern/{name}.svg", "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" shape-rendering="crispEdges">{body}</svg>')

# 1. scan: ruled lines whose lengths follow a slow wave, every fifth one full width
W, H, STEP = 32, 240, 6
rows = []
for i, y in enumerate(range(0, H, STEP)):
    t = y / H * 2 * math.pi
    L = W * (0.28 + 0.72 * abs(math.sin(3 * t) * 0.7 + math.sin(7 * t + 1) * 0.3))
    L = W if i % 5 == 0 else max(5, round(L))
    rows.append(f'<rect x="0" y="{y}" width="{L}" height="{1 if i % 5 else 2}"/>')
write("scan", W, H, "".join(rows))

# 2. gates: a gate drawn in dots, door ajar, a dotted path running out of it, repeated down the column
W, H = 60, 128
def dots(pts, r=0.75, gap=2.8):
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / gap))
        out += [f'<circle cx="{x0 + (x1 - x0) * k / n:.1f}" cy="{y0 + (y1 - y0) * k / n:.1f}" r="{r}"/>' for k in range(n + 1)]
    return out
g = []
g += dots([(4, 100), (4, 34), (22, 34), (22, 100)])            # left pier
g += dots([(38, 100), (38, 34), (56, 34), (56, 100)])          # right pier
g += dots([(2, 34), (2, 20), (58, 20), (58, 34)])              # beam
g += dots([(22, 34), (22, 100)], r=0.75, gap=2.8)              # hinge edge
g += dots([(22, 36), (33, 40), (33, 96), (22, 100)], gap=3.2)  # door, ajar
g += dots([(0, 102), (60, 102)], r=0.6, gap=3.6)               # floor
for k, y in enumerate(range(106, 128, 5)):                      # the path
    g.append(f'<circle cx="30" cy="{y}" r="{0.7 + 0.35 * k:.2f}"/>')
write("gates", W, H, "".join(g))

# 3. cloud: a dot grid thresholded by a bayer matrix against a soft noise, so it drifts in blotches
W, H, S = 32, 480, 5
B = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]
c = []
for y in range(0, H, S):
    for x in range(0, W, S):
        u = y / H * 2 * math.pi
        f = (math.sin(2 * u + x * 0.21) + math.sin(5 * u - x * 0.37) + math.sin(3 * u + 1.3) + 3) / 6
        f = f ** 1.4
        if B[(y // S) % 4][(x // S) % 4] / 16 < f * 0.9:
            c.append(f'<circle cx="{x + 2}" cy="{y + 2}" r="1"/>')
write("cloud", W, H, "".join(c))
print("ok")
