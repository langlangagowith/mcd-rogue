#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 cardpool.json + 真实套餐拆件 + 立绘 + 真券注入 web/template.html，产出**单文件** docs/index.html。

产出物不依赖任何外部请求，双击即可离线游玩。

摇餐机（首屏轻玩法）需要的数据：
  - combos   真实套餐拆件（复用 build_arcade 的派生与「套餐价 ≤ 单点合计」价格证伪）
  - sprites  套餐用到的立绘（只内联用得到的 slug，控体积）
  - coupons  今日真券（available-coupons 快照，assets/coupons）
  - qr       仓库二维码（分享卡用）

用法：
    python build_web.py
"""

from __future__ import annotations

import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_arcade import combos_from_snapshot, foods_from_cardpool  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "web", "template.html")
POOL = os.path.join(ROOT, "data", "cardpool.json")
SNAP = os.path.join(ROOT, "data", "snapshot.json")
SPRITES_DIR = os.path.join(ROOT, "assets", "sprites")
COUPON_DIR = os.path.join(ROOT, "assets", "coupons")
REALTIME = os.path.join(ROOT, "data", "realtime.json")
QR_REPO = os.path.join(ROOT, "assets", "qr", "repo.png")
# 产物放在 docs/ —— GitHub Pages 只允许从仓库根目录或 /docs 发布
OUT = os.path.join(ROOT, "docs", "index.html")
SHARE_BASE = "https://langlangagowith.github.io/mcd-rogue/"
PLACEHOLDER = "/*__DATA__*/"


def b64(path: str) -> str:
    return base64.b64encode(open(path, "rb").read()).decode("ascii")


def shake_payload(pool: dict) -> dict:
    """摇餐机数据：真实套餐（含立绘 slug）、只内联用得到的立绘、今日真券、二维码。"""
    combos: list[dict] = []
    if os.path.isfile(SNAP):
        foods = foods_from_cardpool(pool)
        combos = combos_from_snapshot(json.load(open(SNAP, encoding="utf-8")), foods)
    else:
        print(f"⚠ 没有 {SNAP} ⇒ 摇餐机无套餐（先跑 fetch_snapshot.py）")

    slugs = sorted({it["s"] for c in combos for it in c["items"] if it.get("s")})
    sprites: dict[str, str] = {}
    for slug in slugs:
        p = os.path.join(SPRITES_DIR, slug + ".webp")
        if os.path.isfile(p):
            sprites[slug] = "data:image/webp;base64," + b64(p)
        else:
            print(f"⚠ 缺立绘 {p} ⇒ 该食材将退化为色块")

    coupons: list[dict] = []
    if os.path.isfile(REALTIME):
        rt = json.load(open(REALTIME, encoding="utf-8"))
        for c in rt.get("coupons") or []:
            p = os.path.join(COUPON_DIR, c["f"] + ".webp")
            if os.path.isfile(p):
                coupons.append({"n": c["n"], "img": "data:image/webp;base64," + b64(p)})
    else:
        print(f"⚠ 没有 {REALTIME} ⇒ 摇餐机结果卡不显示真券")

    qr = ""
    if os.path.isfile(QR_REPO):
        qr = "data:image/png;base64," + b64(QR_REPO)
    else:
        print(f"⚠ 缺 {QR_REPO} ⇒ 分享卡不画二维码")

    return {"combos": combos, "sprites": sprites, "coupons": coupons, "qr": qr,
            "shareBase": SHARE_BASE}


def payload(pool: dict, shake: dict) -> dict:
    """只注入网页需要的字段，并对 < 做转义，避免提前闭合 script 标签。"""
    data = {
        "meta": pool.get("meta", {}),
        "rounds": pool.get("rounds", {}),
        "events": (pool.get("events") or [])[:20],
    }
    data.update(shake)
    return data


def main() -> int:
    tpl = open(TPL, encoding="utf-8").read()
    if PLACEHOLDER not in tpl:
        print(f"❌ 模板里找不到占位符 {PLACEHOLDER}")
        return 1

    pool = json.load(open(POOL, encoding="utf-8"))
    shake = shake_payload(pool)
    data = json.dumps(payload(pool, shake), ensure_ascii=False, separators=(",", ":"))
    data = data.replace("<", "\\u003c")

    html = tpl.replace(PLACEHOLDER, data)
    if not html.endswith("\n"):
        html += "\n"
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    kb = os.path.getsize(OUT) / 1024
    counts = {k: len(v) for k, v in pool.get("rounds", {}).items()}
    print(f"✅ 已写出 {OUT}  ({kb:.1f} KB)")
    print(f"   注入卡池: {counts} · 事件 {len(pool.get('events') or [])} 条")
    print(f"   摇餐机: 套餐 {len(shake['combos'])} 份 · 立绘 {len(shake['sprites'])} 张"
          f" · 真券 {len(shake['coupons'])} 张 · 二维码 {'有' if shake['qr'] else '无'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
