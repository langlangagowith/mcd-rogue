#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把真实营养数据与 12 张食物立绘注入 web/arcade-template.html，产出单文件 docs/arcade.html。

麦门开饭 · 出餐口大作战：出料口倒真实菜单、玩家跑去吃、吃撑结束。
- 食物清单与热量/价格：麦当劳官方 MCP（data/cardpool.json）。
- 立绘：assets/raw（商汤出图）→ scripts/prepare_sprites.py 抠底归一化 → assets/sprites。
  素材加工链依赖 Pillow/numpy（一次性）；**本脚本是每次构建都跑的主链，零第三方依赖**：
  只把成品 PNG 字节直接 base64 内联，不解码像素。

用法：
    python build_arcade.py
"""

from __future__ import annotations

import base64
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "web", "arcade-template.html")
POOL = os.path.join(ROOT, "data", "cardpool.json")
SPRITES_DIR = os.path.join(ROOT, "assets", "sprites")
OUT = os.path.join(ROOT, "docs", "arcade.html")

SLUGS = [
    "burger-double", "burger-chicken", "burger-angus", "fries",
    "nuggets", "wings", "cola", "coffee", "sundae", "cone", "pie", "muffin",
]

# 品类兜底（与模板 CAT_SLUG 保持一致）
CAT_SLUG = {
    "主食": "burger-double", "小食": "fries", "甜品": "cone",
    "饮品": "cola", "饮料": "cola", "咖啡": "coffee",
    "套餐": "burger-double", "其他": "nuggets",
}


def slug_for(name: str, cat: str) -> str:
    """餐品名 → 立绘 slug。原则：明确词优先（越具体越靠前）→ 品类兜底。

    ⚠ 顺序即语义，别随手调整：例如「营养卷」必须在「香肠」前、
    「炒双蛋堡」在「板烧」前，否则早餐卷/堡会被折进正餐汉堡的判据里。
    """
    if "麦满分" in name: return "muffin"
    if "营养卷" in name: return "muffin"
    if "炒双蛋堡" in name: return "muffin"
    if "安格斯" in name: return "burger-angus"
    if "巨无霸" in name: return "burger-double"
    if "麦辣鸡翅" in name: return "wings"
    if "V翅" in name: return "wings"
    if "脆汁鸡" in name: return "wings"
    if "鸡排" in name: return "wings"
    if "麦乐鸡" in name: return "nuggets"
    if "香肠" in name: return "nuggets"
    if "麦辣鸡腿" in name: return "burger-chicken"
    if "板烧鸡腿" in name: return "burger-chicken"
    if "麦香鸡" in name: return "burger-chicken"
    if "麦香鱼" in name: return "burger-chicken"
    if "吉士" in name or "牛堡" in name or "鳕鱼堡" in name: return "burger-double"
    if "油条" in name: return "fries"
    if "薯条" in name or "薯饼" in name: return "fries"
    if "派" in name: return "pie"
    if "圆筒" in name: return "cone"
    if "新地" in name or "麦旋风" in name: return "sundae"
    if "可乐" in name or "雪碧" in name: return "cola"
    if "美汁源" in name or "橙橙" in name: return "cola"
    if "咖啡" in name or "奶铁" in name or "卡布奇诺" in name: return "coffee"
    if "牛奶" in name: return "coffee"
    if "红茶" in name: return "coffee"
    return CAT_SLUG.get(cat, "nuggets")


def foods_from_cardpool(pool: dict) -> list[dict]:
    """三餐菜单去重 → 紧凑的食物表 {n,p,k,c,s}（s = 立绘 slug）。"""
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
    return sorted(seen.values(), key=lambda x: (x["k"], x["n"]))


def main() -> int:
    tpl = open(TPL, encoding="utf-8").read()
    for ph in ("/*__FOODS__*/", "/*__SPRITES__*/"):
        if ph not in tpl:
            print(f"❌ 模板里找不到占位符 {ph}")
            return 1

    pool = json.load(open(POOL, encoding="utf-8"))
    foods = foods_from_cardpool(pool)
    if len(foods) < 8:
        print(f"❌ 可用餐品过少（{len(foods)}），营养数据可能没拉到，先跑 fetch_snapshot / build_cardpool")
        return 1

    # 覆盖校验：每张立绘都要有归属、每个餐品都要有 slug
    used = {f["s"] for f in foods}
    missing = [s for s in SLUGS if s not in used]
    if missing:
        print(f"❌ 有立绘没被任何餐品用上：{missing}")
        return 1
    for f in foods:
        if f["s"] not in SLUGS:
            print(f"❌ 餐品「{f['n']}」映射到不存在的 slug：{f['s']}")
            return 1

    sprites: dict[str, str] = {}
    for slug in SLUGS:
        p = os.path.join(SPRITES_DIR, slug + ".png")
        if not os.path.exists(p):
            print(f"❌ 缺少立绘 {p}（先跑 prepare_sprites.py）")
            return 1
        b64 = base64.b64encode(open(p, "rb").read()).decode("ascii")
        sprites[slug] = "data:image/png;base64," + b64

    foods_json = json.dumps(foods, ensure_ascii=False, separators=(",", ":"))
    sprites_json = json.dumps(sprites, separators=(",", ":"))
    # 与 build_web / build_neon 同款：转义 <，避免提前闭合 script 标签
    foods_json = foods_json.replace("<", "\\u003c")
    sprites_json = sprites_json.replace("<", "\\u003c")

    html = tpl.replace("/*__FOODS__*/", foods_json).replace("/*__SPRITES__*/", sprites_json)
    if not html.endswith("\n"):
        html += "\n"
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    # 映射分布（目检用）
    from collections import Counter
    dist = Counter(f["s"] for f in foods)
    kb = os.path.getsize(OUT) / 1024
    print(f"✅ 已写出 {OUT}  ({kb:.1f} KB)")
    print(f"   注入餐品 {len(foods)} 种 · 立绘 {len(SLUGS)} 张")
    print("   立绘用量：" + " / ".join(f"{s}×{dist[s]}" for s in SLUGS))
    kmin = min(f["k"] for f in foods)
    kmax = max(f["k"] for f in foods)
    print(f"   热量区间 {kmin}~{kmax} kcal")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
