#!/usr/bin/env python3
"""Faithful 4x super-resolution with Swin2SR (caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr, Apache-2.0),
tiled so memory stays bounded, on Apple MPS when available. Then a Lanczos resize to the target size.

usage: upscale.py IN OUT [--long-edge N | --size WxH] [--tile 192] [--overlap 24]
"""
import argparse
import os
import sys
import time

# After the first download, run offline: the Hub client keeps a background thread that stops Python exiting.
os.environ.setdefault("HF_HUB_OFFLINE", "1" if os.path.isdir(os.path.expanduser("~/.cache/huggingface/hub/models--caidas--swin2SR-realworld-sr-x4-64-bsrgan-psnr")) else "0")

import numpy as np
import torch
from PIL import Image
from transformers import Swin2SRForImageSuperResolution

MODEL = "caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr"
SCALE = 4
WINDOW = 8  # Swin2SR pads inputs to a multiple of its window size


def run_tile(model, tile, device):
    x = torch.from_numpy(tile).permute(2, 0, 1).unsqueeze(0).to(device)
    h, w = x.shape[-2:]
    ph, pw = (WINDOW - h % WINDOW) % WINDOW, (WINDOW - w % WINDOW) % WINDOW
    if ph or pw:
        x = torch.nn.functional.pad(x, (0, pw, 0, ph), mode="reflect")
    with torch.no_grad():
        y = model(pixel_values=x).reconstruction
    y = y[..., : h * SCALE, : w * SCALE]
    return y.squeeze(0).clamp(0, 1).permute(1, 2, 0).float().cpu().numpy()


def upscale(img, model, device, tile=192, overlap=24):
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    H, W, _ = arr.shape
    out = np.zeros((H * SCALE, W * SCALE, 3), dtype=np.float32)
    weight = np.zeros((H * SCALE, W * SCALE, 1), dtype=np.float32)
    step = tile - overlap
    ys = list(range(0, max(H - overlap, 1), step))
    xs = list(range(0, max(W - overlap, 1), step))
    # feathered blend weights: linear ramps over the overlap, so seams vanish
    for y0 in ys:
        for x0 in xs:
            y1, x1 = min(y0 + tile, H), min(x0 + tile, W)
            y0c, x0c = max(0, y1 - tile), max(0, x1 - tile)
            sr = run_tile(model, arr[y0c:y1, x0c:x1], device)
            th, tw = sr.shape[:2]
            wy = np.ones(th, dtype=np.float32)
            wx = np.ones(tw, dtype=np.float32)
            ramp = overlap * SCALE
            if y0c > 0:
                wy[:ramp] = np.linspace(0, 1, ramp, dtype=np.float32)
            if y1 < H:
                wy[-ramp:] = np.linspace(1, 0, ramp, dtype=np.float32)
            if x0c > 0:
                wx[:ramp] = np.linspace(0, 1, ramp, dtype=np.float32)
            if x1 < W:
                wx[-ramp:] = np.linspace(1, 0, ramp, dtype=np.float32)
            w2 = (wy[:, None] * wx[None, :])[..., None] + 1e-6
            oy, ox = y0c * SCALE, x0c * SCALE
            out[oy : oy + th, ox : ox + tw] += sr * w2
            weight[oy : oy + th, ox : ox + tw] += w2
    out /= weight
    return Image.fromarray((out * 255.0 + 0.5).clip(0, 255).astype(np.uint8))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("inp")
    p.add_argument("out")
    p.add_argument("--long-edge", type=int)
    p.add_argument("--size")
    p.add_argument("--tile", type=int, default=192)
    p.add_argument("--overlap", type=int, default=24)
    a = p.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    t0 = time.time()
    model = Swin2SRForImageSuperResolution.from_pretrained(MODEL).to(device).eval()
    img = Image.open(a.inp)
    sr = upscale(img, model, device, a.tile, a.overlap)
    if a.size:
        w, h = (int(v) for v in a.size.lower().split("x"))
        sr = sr.resize((w, h), Image.LANCZOS)
    elif a.long_edge:
        s = a.long_edge / max(sr.size)
        sr = sr.resize((round(sr.size[0] * s), round(sr.size[1] * s)), Image.LANCZOS)
    sr.save(a.out)
    print(f"{a.inp} {img.size} -> {a.out} {sr.size} on {device} in {time.time() - t0:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
    sys.stderr.flush()
    os._exit(0)  # skip interpreter teardown (MPS and Hub threads can hang it)
