#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把真实营养数据注入 web/neon-template.html，产出**单文件** docs/neon.html。

麦门幸存者（McSurvivor）的敌人不是虚构的：每种餐品的血量/体型/速度
都由官方营养数据（kcal）派生 —— 热量越高越肉、越大、越慢。

产物零外部依赖（无 fetch / 无图片 / 无字体），双击即可离线游玩。

用法：
    python build_neon.py
"""

from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "web", "neon-template.html")
POOL = os.path.join(ROOT, "data", "cardpool.json")
OUT = os.path.join(ROOT, "docs", "neon.html")
PLACEHOLDER = "/*__NEON_DATA__*/"


def foods_from_cardpool(pool: dict) -> list[dict]:
    """三餐菜单去重 → 紧凑的敌人原料表 {n:名称, p:价格, k:热量, c:品类}。"""
    seen: dict[str, dict] = {}
    for round_cards in (pool.get("rounds") or {}).values():
        for card in round_cards or []:
            name = (card.get("name") or "").strip()
            if not name or name in seen:
                continue
            kcal = card.get("kcal")
            if not isinstance(kcal, (int, float)) or kcal <= 0:
                continue
            seen[name] = {
                "n": name,
                "p": card.get("price", 0),
                "k": int(round(kcal)),
                "c": card.get("cat") or "",
            }
    # 按热量升序，让"小食先来、大件后到"的观感稳定
    return sorted(seen.values(), key=lambda x: (x["k"], x["n"]))


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

    payload = {
        "foods": foods,
        "meta": {
            "source": "麦当劳 MCP · list-nutrition-foods / query-meals",
            "count": len(foods),
            "note": "敌人属性由官方 kcal 派生",
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
    print(f"✅ 已写出 {OUT}  ({kb:.1f} KB)")
    print(f"   注入餐品 {len(foods)} 种 · 热量区间 {kmin}~{kmax} kcal")
    print(f"   样例: " + " / ".join(f"{f['n']}({f['k']}kcal)" for f in foods[:5]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
