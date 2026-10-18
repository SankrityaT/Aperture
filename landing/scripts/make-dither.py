"""Placeholder dither fields (ordered Bayer dither over smooth noise).
Swap for the real Midjourney images: same filenames, same aspect (about 16:9)."""
import numpy as np
from PIL import Image

W, H, CELL = 2400, 1400, 3          # output size; each dither pixel is CELL px
w, h = W // CELL, H // CELL
rng = np.random.default_rng(7)

def noise(seed_cells, octaves=4):
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = seed_cells * (2 ** o)
        g = rng.random((max(2, int(n * h / w)), n)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * np.asarray(im, dtype=np.float64) / 255.0
        total += amp; amp *= 0.5
    return out / total

B8 = np.array([[0,32,8,40,2,34,10,42],[48,16,56,24,50,18,58,26],[12,44,4,36,14,46,6,38],
               [60,28,52,20,62,30,54,22],[3,35,11,43,1,33,9,41],[51,19,59,27,49,17,57,25],
               [15,47,7,39,13,45,5,37],[63,31,55,23,61,29,53,21]]) / 64.0
bayer = np.tile(B8, (h // 8 + 1, w // 8 + 1))[:h, :w]

yy, xx = np.mgrid[0:h, 0:w]
u, v = xx / w, yy / h

def save(name, field, bg, fg):
    mask = field > bayer
    img = np.zeros((h, w, 3), np.uint8); img[:] = bg
    img[mask] = fg
    Image.fromarray(img).resize((W, H), Image.NEAREST).save(f"public/dither/{name}.png", optimize=True)

n = noise(3)
# Field: flat blue behind the text column; dither only in the side and bottom margins, low contrast.
side = np.clip((np.abs(u - 0.5) - 0.30) * 3.2, 0, 1)
top_clear = np.clip((v - 0.16) * 3.0, 0, 1)
fc = np.clip((n - 0.2) * 1.5, 0, 1) * side * top_clear
save("field", fc, (20, 38, 230), (88, 108, 255))
print("ok")

# Footer: dither that thickens toward the bottom edge, behind the oversized wordmark.
W2, H2 = 2400, 700
w2, h2 = W2 // CELL, H2 // CELL
yy2, xx2 = np.mgrid[0:h2, 0:w2]
v2 = yy2 / h2
bay2 = np.tile(B8, (h2 // 8 + 1, w2 // 8 + 1))[:h2, :w2]
g = np.zeros((h2, w2)); amp = 1.0; tot = 0.0
for o in range(4):
    n_ = 4 * (2 ** o)
    cells = rng.random((max(2, int(n_ * h2 / w2)), n_)).astype(np.float32)
    g += amp * np.asarray(Image.fromarray((cells * 255).astype(np.uint8)).resize((w2, h2), Image.BICUBIC), dtype=np.float64) / 255.0
    tot += amp; amp *= 0.5
g /= tot
f2 = np.clip((g - 0.25) * 1.8, 0, 1) * np.clip((v2 - 0.25) * 1.5, 0, 1) ** 1.2
mask2 = f2 > bay2
img2 = np.zeros((h2, w2, 3), np.uint8); img2[:] = (20, 38, 230); img2[mask2] = (96, 116, 255)
Image.fromarray(img2).resize((W2, H2), Image.NEAREST).save("public/dither/footer.png", optimize=True)
print("footer ok")
