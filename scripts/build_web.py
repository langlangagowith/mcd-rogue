#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 cardpool.json 注入 web/template.html，产出**单文件** web/index.html。

产出物不依赖任何外部请求，双击即可离线游玩。

用法：
    python build_web.py
"""

from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "web", "template.html")
POOL = os.path.join(ROOT, "data", "cardpool.json")
OUT = os.path.join(ROOT, "web", "index.html")
PLACEHOLDER = "/*__DATA__*/"


def payload(pool: dict) -> dict:
    """只注入网页需要的字段，并对 < 做转义，避免提前闭合 script 标签。"""
    return {
        "meta": pool.get("meta", {}),
        "rounds": pool.get("rounds", {}),
        "events": (pool.get("events") or [])[:20],
    }


def main() -> int:
    tpl = open(TPL, encoding="utf-8").read()
    if PLACEHOLDER not in tpl:
        print(f"❌ 模板里找不到占位符 {PLACEHOLDER}")
        return 1

    pool = json.load(open(POOL, encoding="utf-8"))
    data = json.dumps(payload(pool), ensure_ascii=False, separators=(",", ":"))
    data = data.replace("<", "\\u003c")

    html = tpl.replace(PLACEHOLDER, data)
    if not html.endswith("\n"):
        html += "\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)

    kb = os.path.getsize(OUT) / 1024
    counts = {k: len(v) for k, v in pool.get("rounds", {}).items()}
    print(f"✅ 已写出 {OUT}  ({kb:.1f} KB)")
    print(f"   注入卡池: {counts} · 事件 {len(pool.get('events') or [])} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
