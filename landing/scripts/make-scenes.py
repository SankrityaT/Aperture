"""Recolors the Midjourney tiles in scripts/src into the site's palette.
A gradient map on luminance: the flat sky level becomes the page blue exactly,
shadows go to a deeper navy, highlights to near-white. Swap scripts/src/*.png for
the full-resolution exports and rerun; nothing else changes."""
import numpy as np
from PIL import Image

PAGE = np.array([20, 38, 230], float)      # #1426e6
NAVY = np.array([6, 14, 150], float)
WHITE = np.array([244, 243, 255], float)

def recolor(src, dst, scale=1):
    im = Image.open(src).convert("RGB")
    a = np.asarray(im, float)
    L = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255
    top = L[: max(8, L.shape[0] // 14), L.shape[1] // 3 : 2 * L.shape[1] // 3]
    sky = float(np.median(top))               # the flat sky level
    xs = [0.0, sky, 1.0]
    out = np.stack([np.interp(L, xs, [NAVY[c], PAGE[c], WHITE[c]]) for c in range(3)], -1)
    img = Image.fromarray(out.astype(np.uint8)).resize((im.width * scale, im.height * scale), Image.NEAREST)
    img = img.quantize(colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) if scale == 1 else img
    img.save(dst, optimize=True)
    print(dst, img.size, "sky L=%.3f" % sky)

recolor("scripts/src/cove.png", "public/scenes/cove.png")
