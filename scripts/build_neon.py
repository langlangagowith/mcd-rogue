#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把真实营养数据与食物立绘注入 web/neon-template.html，产出**单文件** docs/neon.html。

麦门幸存者（McSurvivor）的敌人不是虚构的：每种餐品的血量/体型/速度
都由官方营养数据（kcal）派生 —— 热量越高越肉、越大、越慢；
**每种敌人还带一张对应食物的真实立绘**（与出餐口共用 assets/sprites 与 slug 口径，
餐品名 → 立绘的映射函数直接复用 build_arcade.slug_for，避免两套判据漂移）。

产物零外部依赖（无 fetch / 无字体，图片全部 base64 内联），双击即可离线游玩。

用法：
    python build_neon.py
"""

from __future__ import annotations

import base64
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "web", "neon-template.html")
POOL = os.path.join(ROOT, "data", "cardpool.json")
OUT = os.path.join(ROOT, "docs", "neon.html")
PLACEHOLDER = "/*__NEON_DATA__*/"

SPRITES_DIR = os.path.join(ROOT, "assets", "sprites")

# 复用出餐口的立绘清单与「餐品名 → 立绘」映射：同一批素材、同一套判据
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_arcade import SLUGS as SPRITE_SLUGS, slug_for  # noqa: E402


def foods_from_cardpool(pool: dict) -> list[dict]:
    """三餐菜单去重 → 紧凑的敌人原料表 {n:名称, p:价格, k:热量, c:品类, s:立绘 slug}。"""
    seen: dict[str, dict] = {}
    for round_cards in (pool.get("rounds") or {}).values():
        for card in round_cards or []:
            name = (card.get("name") or "").strip()
            if not name or name in seen:
                continue
            kcal = card.get("kcal")
            if not isinstance(kcal, (int, float)) or kcal <= 0:
                continue
            cat = card.get("cat") or ""
            seen[name] = {
                "n": name,
                "p": card.get("price", 0),
                "k": int(round(kcal)),
                "c": cat,
                "s": slug_for(name, cat),
            }
    # 按热量升序，让"小食先来、大件后到"的观感稳定
    return sorted(seen.values(), key=lambda x: (x["k"], x["n"]))


def sprites_payload() -> dict[str, str]:
    """12 张食物立绘（256px webp）→ {slug: dataURL}。构建期一次性内联。"""
    out: dict[str, str] = {}
    for slug in SPRITE_SLUGS:
        p = os.path.join(SPRITES_DIR, slug + ".webp")
        if not os.path.exists(p):
            print(f"⚠ 缺立绘 {p}（该 slug 的敌人将回退为色块）")
            continue
        with open(p, "rb") as f:
            out[slug] = "data:image/webp;base64," + base64.b64encode(f.read()).decode("ascii")
    return out


def main() -> int:
    tpl = open(TPL, encoding="utf-8").read()
    if PLACEHOLDER not in tpl:
        print(f"❌ 模板里找不到占位符 {PLACEHOLDER}")
        return 1

    pool = json.load(open(POOL, encoding="utf-8"))
    foods = foods_from_cardpool(pool)
    if len(foods) < 8:
        print(f"❌ 可用餐品过少（{len(foods)}），营养数据可能没拉到，先跑 fetch_snapshot / build_cardpool")
        return 1

    sprites = sprites_payload()
    # 门：每个餐品都必须映射到一张存在的立绘——宁可构建失败，也不要线上出现"无名色块怪"
    missing = sorted({f["s"] for f in foods if f["s"] not in sprites})
    if missing:
        print(f"❌ 有餐品映射到不存在的立绘：{missing}（检查 slug_for 或 assets/sprites）")
        return 1

    payload = {
        "foods": foods,
        "sprites": sprites,
        "meta": {
            "source": "麦当劳 MCP · list-nutrition-foods / query-meals",
            "count": len(foods),
            "note": "敌人属性由官方 kcal 派生 · 立绘与出餐口共用 assets/sprites",
        },
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    # 与 build_web.py 同款：转义 < ，避免提前闭合 script 标签
    data = data.replace("<", "\\u003c")

    html = tpl.replace(PLACEHOLDER, data)
    if not html.endswith("\n"):
        html += "\n"
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    kb = os.path.getsize(OUT) / 1024
    kmin = min(f["k"] for f in foods)
    kmax = max(f["k"] for f in foods)
    from collections import Counter
    dist = Counter(f["s"] for f in foods)
    print(f"✅ 已写出 {OUT}  ({kb:.1f} KB)")
    print(f"   注入餐品 {len(foods)} 种 · 立绘 {len(sprites)} 张 · 热量区间 {kmin}~{kmax} kcal")
    print("   立绘覆盖：" + " / ".join(f"{s}×{dist[s]}" for s in SPRITE_SLUGS if dist.get(s)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
