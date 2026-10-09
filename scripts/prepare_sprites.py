#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""素材管线：raw（商汤出图，RGB 奶黄底）→ 透明立绘 sprites（RGBA PNG）。

本脚本是**一次性素材加工**，不属于每次构建的主链（主链 build_arcade.py 零第三方依赖）。
依赖 Pillow + numpy（本机 default venv 已装）：

    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe prepare_sprites.py

处理流程（每张独立，完全确定性）：
  1. 四角 32×32 色块取**中位数**估背景底色（抗噪点）。
  2. 最外 RING=3 圈强制为背景：商汤出图最外 1~2px 常有深色渲染边，
     种子若取最外圈会让泛洪第一层就卡死（现象是"只在画布外围留一圈矩形残边"），
     故种子取距边 RING 的矩形环。
  3. 链式泛洪判定背景，邻居需**同时**满足：
       · 与当前像素色距 < TOL_STEP（跟随极轻微渐变，防一刀切）
       · 与全局底色色距 < TOL_FAR（防跑飞进主体）
  4. alpha **二值**：背景 0、其余 255。软边不在原图做 —— 由第 6 步降采样产生。
  5. 归一化居中：取 alpha 包围盒 → 缩放使最长边 = FILL×画布 → 居中。
     FILL=0.72 与模板里绘制系数 2.8 配套：视觉半径 = 0.72×2.8/2 ≈ 1.008×碰撞半径，
     即"看起来碰到就吃到"（两处改一处必须同步，冒烟测试有断言钉住这组耦合）。
  6. LANCZOS 降采样到 OUT_SIZE，**导出 256px webp（q90）** 落盘 assets/sprites/<slug>.webp。
     ⚠ 2026-10-09 晚改：PNG → webp —— 扁平插画在 webp 下有损 q90 肉眼无损，
     12 张从 474KB 压到 112KB（产物 684KB → ~200KB，弱网打开从 11s 降到 ~3s，
     这正是手机端"进去只有背景"（大文件半加载）的药）。

用法：
    python prepare_sprites.py             # 处理全部 12 张并打印质检表
    python prepare_sprites.py --contact   # 额外拼一张棋盘格对照图（assets/_contact.png）
"""

from __future__ import annotations

import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "assets", "raw")
OUT_DIR = os.path.join(ROOT, "assets", "sprites")

SLUGS = [
    "burger-double", "burger-chicken", "burger-angus", "fries",
    "nuggets", "wings", "cola", "coffee", "sundae", "cone", "pie", "muffin",
]

FILL = 0.72          # 主体最长边占最终画布比例（与模板 2.8 配套，勿单改）
OUT_SIZE = 256       # 最终画布边长
TOL_STEP = 26.0      # 与当前像素的色距门（链式跟随）
TOL_FAR = 120.0      # 与全局底色的色距门（防跑飞）
RING = 3             # 最外强制背景圈宽

# 质检门（跑完逐张报数；不合格点名的张以非零退出）
SEMI_MIN, SEMI_MAX = 0.003, 0.08   # 半透明占比（软边来自降采样）
EDGE_DIST_MIN = 42.0               # 半透明边缘均色离底色的最小色距（防"米白晕"）
SRC_MARGIN_MIN = 6                 # 源图前景 bbox 距源图边缘的最小像素
RESID_MAX = 0.08                   # 轮廓线上底色残留占比上限


def estimate_base(arr: np.ndarray) -> np.ndarray:
    """四角 32×32 色块（避开最外 3px 渲染边）分通道中位数。"""
    s = 32
    o = RING + 5
    corners = [
        arr[o:o + s, o:o + s], arr[o:o + s, -o - s:-o],
        arr[-o - s:-o, o:o + s], arr[-o - s:-o, -o - s:-o],
    ]
    px = np.concatenate([c.reshape(-1, 3) for c in corners], axis=0)
    return np.median(px, axis=0)


def flood_background(arr: np.ndarray, base: np.ndarray) -> np.ndarray:
    """从距边 RING 的环形种子做 4 邻链式泛洪，返回背景 mask（bool，H×W）。"""
    h, w = arr.shape[:2]
    diff = arr.astype(np.float64) - base
    far = np.sqrt((diff * diff).sum(axis=2)) < TOL_FAR      # 全程必须满足
    step2 = TOL_STEP * TOL_STEP

    bg = np.zeros((h, w), dtype=bool)
    # 最外 RING 圈强制背景（渲染边不进泛洪，直接划掉）
    bg[:RING, :] = True; bg[-RING:, :] = True
    bg[:, :RING] = True; bg[:, -RING:] = True

    q: deque[tuple[int, int]] = deque()
    # 种子环：距边 RING 那一条矩形线上、且满足 far 的像素
    for x in range(RING, w - RING):
        for y in (RING, h - 1 - RING):
            if not bg[y, x] and far[y, x]:
                bg[y, x] = True; q.append((x, y))
    for y in range(RING + 1, h - 1 - RING):
        for x in (RING, w - 1 - RING):
            if not bg[y, x] and far[y, x]:
                bg[y, x] = True; q.append((x, y))

    while q:
        x, y = q.popleft()
        c = arr[y, x]
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if bg[ny, nx] or not far[ny, nx]:
                continue
            n = arr[ny, nx]
            dr = int(n[0]) - int(c[0]); dg = int(n[1]) - int(c[1]); db = int(n[2]) - int(c[2])
            if dr * dr + dg * dg + db * db < step2:
                bg[ny, nx] = True
                q.append((nx, ny))
    return bg


def filter_small_components(fg: np.ndarray, min_ratio: float = 0.002) -> tuple[np.ndarray, int, int]:
    """去掉面积占比过小的孤立噪点；保留全部显著连通域。

    ⚠ 不能用"只保留最大连通域"：麦乐鸡本体就是 4 块分离的（会被吃掉 3 块）。
    返回 (新前景, 连通域总数, 保留数)。
    """
    h, w = fg.shape
    min_area = max(48, int(fg.size * min_ratio))
    seen = np.zeros((h, w), dtype=bool)
    keep = np.zeros((h, w), dtype=bool)
    n_total = n_kept = 0
    for y0 in range(h):
        for x0 in range(w):
            if not fg[y0, x0] or seen[y0, x0]:
                continue
            n_total += 1
            comp: list[tuple[int, int]] = []
            q = deque([(x0, y0)]); seen[y0, x0] = True
            while q:
                x, y = q.popleft(); comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and fg[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((nx, ny))
            if len(comp) >= min_area:
                n_kept += 1
                for x, y in comp:
                    keep[y, x] = True
    return keep, n_total, n_kept


def process(slug: str) -> dict:
    raw_path = os.path.join(RAW_DIR, slug + ".png")
    im = Image.open(raw_path).convert("RGB")
    arr = np.asarray(im, dtype=np.int32)
    h, w = arr.shape[:2]

    base = estimate_base(arr)
    bg = flood_background(arr, base)
    fg, n_total, n_kept = filter_small_components(~bg)

    # 源图主体不贴边（归一化前的机械判据）
    ys, xs = np.where(fg)
    src_margin = int(min(xs.min(), ys.min(), w - 1 - xs.max(), h - 1 - ys.max()))

    # 二值 alpha → 裁包围盒 → 等比缩放到 FILL 占比 → 居中贴到画布
    alpha = np.where(fg, 255, 0).astype(np.uint8)
    rgba = np.dstack([arr, alpha]).astype(np.uint8)
    crop = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    ch, cw = crop.shape[:2]
    scale = (FILL * OUT_SIZE) / max(ch, cw)
    nw, nh = max(1, round(cw * scale)), max(1, round(ch * scale))
    small = Image.fromarray(crop, "RGBA").resize((nw, nh), Image.LANCZOS)
    out = Image.new("RGBA", (OUT_SIZE, OUT_SIZE), (0, 0, 0, 0))
    out.paste(small, ((OUT_SIZE - nw) // 2, (OUT_SIZE - nh) // 2), small)

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, slug + ".webp")
    out.save(out_path, "WEBP", quality=90, method=6)

    # ---------------- 质检（量最终产物 + 源图） ----------------
    a = np.asarray(out)[:, :, 3]
    total = a.size
    semi_mask = (a > 0) & (a < 255)
    semi = semi_mask.sum() / total

    rgb = np.asarray(out)[:, :, :3].astype(np.float64)
    if semi_mask.any():
        d = np.sqrt(((rgb[semi_mask] - base) ** 2).sum(axis=1))
        edge_dist = float(d.mean())
    else:
        edge_dist = 0.0

    # 轮廓线 = 前景中「四邻域里有背景」的像素；数其中离底色 <42 的占比
    fg2 = a > 0
    er = fg2 & np.roll(fg2, 1, 0) & np.roll(fg2, -1, 0) & np.roll(fg2, 1, 1) & np.roll(fg2, -1, 1)
    edge_px = fg2 & ~er
    if edge_px.any():
        de = np.sqrt(((rgb[edge_px] - base) ** 2).sum(axis=1))
        resid = float((de < 42).mean())
    else:
        resid = -1.0

    outer_ok = bool(a[0, :].max() == 0 and a[-1, :].max() == 0
                    and a[:, 0].max() == 0 and a[:, -1].max() == 0)

    checks = {
        "semi": (SEMI_MIN <= semi <= SEMI_MAX, f"{semi * 100:.2f}%"),
        "edge": (edge_dist >= EDGE_DIST_MIN, f"{edge_dist:.1f}"),
        "srcm": (src_margin >= SRC_MARGIN_MIN, f"{src_margin}px"),
        "res": (resid >= 0 and resid <= RESID_MAX, f"{resid * 100:.1f}%"),
        "outr": (outer_ok, "OK" if outer_ok else "BAD"),
    }
    return {"slug": slug, "checks": checks, "out": out_path, "base": base, "ncomp": (n_total, n_kept)}


def contact_sheet(rows: list[dict]) -> str:
    """棋盘格底拼 12 张对照图（4 列 × 3 行），给目检用。"""
    cell, cols = 200, 4
    rows_n = (len(rows) + cols - 1) // cols
    sheet = Image.new("RGBA", (cell * cols, cell * rows_n), (24, 24, 32, 255))
    for i, r in enumerate(rows):
        im = Image.open(r["out"]).resize((cell, cell), Image.LANCZOS)
        x, y = (i % cols) * cell, (i // cols) * cell
        for gy in range(0, cell, 20):           # 棋盘格
            for gx in range(0, cell, 20):
                if (gx // 20 + gy // 20) % 2 == 0:
                    sheet.paste((60, 60, 72, 255), (x + gx, y + gy, x + min(gx + 20, cell), y + min(gy + 20, cell)))
        sheet.paste(im, (x, y), im)
    p = os.path.join(ROOT, "assets", "_contact.png")
    sheet.convert("RGB").save(p, "PNG")
    return p


def main() -> int:
    rows = []
    bad = 0
    print(f"{'slug':<16} {'semi%':>7} {'edgeDist':>8} {'srcMargin':>9} {'resid%':>7} {'outer':>5}  判定")
    for slug in SLUGS:
        r = process(slug)
        c = r["checks"]
        allok = all(v[0] for v in c.values())
        if not allok:
            bad += 1
        rows.append(r)
        print(f"{slug:<16} {c['semi'][1]:>7} {c['edge'][1]:>8} {c['srcm'][1]:>9} "
              f"{c['res'][1]:>7} {c['outr'][1]:>5}  {'OK' if allok else 'FAIL'}")
    print(f"\n输出目录：{OUT_DIR}")
    print(f"不合格：{bad} / {len(SLUGS)}")
    if "--contact" in sys.argv:
        print("对照图：" + contact_sheet(rows))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
