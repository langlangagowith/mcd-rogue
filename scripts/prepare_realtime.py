#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""「真实感层」素材压缩：券图 / 活动海报 → 小体积 webp（一次性加工，依赖 Pillow）。

券图在游戏里当掉落道具（画 ~48px）与战报缩略（画 ~110px），256px 源足够；
海报只在开始页弹窗里显示（~360px 宽），480px 源足够。

体积预算（弱网口径 60KB/s，arcade 产物目标 <350KB）：
  券 ≤14 KB/张 · 海报 ≤60 KB    —— 超了会打印 ⚠ 提示调质量。

用法（Pillow 在 default venv 里，系统 python 没有）：
    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe scripts/prepare_realtime.py
    ... --coupon-size 256 --coupon-q 82 --poster-w 480 --poster-q 68
"""

from __future__ import annotations

import argparse
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REALTIME = os.path.join(ROOT, "data", "realtime.json")
RAW_C = os.path.join(ROOT, "assets", "coupons", "raw")
RAW_P = os.path.join(ROOT, "assets", "poster", "raw")
OUT_C = os.path.join(ROOT, "assets", "coupons")
OUT_P = os.path.join(ROOT, "assets", "poster")

COUPON_BUDGET = 14 * 1024
POSTER_BUDGET = 60 * 1024


def conv(src: str, dst: str, size: int | None, width: int | None, q: int) -> int:
    im = Image.open(src)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    if width:
        w, h = im.size
        im = im.resize((width, max(1, round(h * width / w))), Image.LANCZOS)
    else:
        im.thumbnail((size, size), Image.LANCZOS)
    im.save(dst, "WEBP", quality=q, method=6)
    return os.path.getsize(dst)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--coupon-size", type=int, default=256)
    ap.add_argument("--coupon-q", type=int, default=82)
    ap.add_argument("--poster-w", type=int, default=480)
    ap.add_argument("--poster-q", type=int, default=68)
    args = ap.parse_args()

    rt = json.load(open(REALTIME, encoding="utf-8"))
    os.makedirs(OUT_C, exist_ok=True)
    os.makedirs(OUT_P, exist_ok=True)

    total = 0
    print("券图：")
    for c in rt.get("coupons") or []:
        src = os.path.join(RAW_C, c["f"] + ".png")
        dst = os.path.join(OUT_C, c["f"] + ".webp")
        n = conv(src, dst, args.coupon_size, None, args.coupon_q)
        total += n
        flag = "⚠超预算" if n > COUPON_BUDGET else "ok"
        print(f"  {c['f']:<10} {c['n'][:20]:<22} {n/1024:6.1f} KB  {flag}")
    print(f"  小计 {total/1024:.1f} KB（内联后 ×1.37 ≈ {total*1.37/1024:.1f} KB）")

    p = rt.get("poster")
    if p:
        src = os.path.join(RAW_P, p["f"] + ".jpg")
        dst = os.path.join(OUT_P, p["f"] + ".webp")
        n = conv(src, dst, None, args.poster_w, args.poster_q)
        flag = "⚠超预算" if n > POSTER_BUDGET else "ok"
        print(f"海报：{p['title'][:24]}  {n/1024:.1f} KB  {flag}"
              f"（内联后 ≈ {n*1.37/1024:.1f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
