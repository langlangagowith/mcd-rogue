#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 snapshot.json 里的「三餐菜单」与「官方营养库」合并成游戏卡池。

菜单只给价格、营养库只给热量 —— 两边靠**餐品名**对齐。
因为是同名不同写法（"薯条" vs "中薯条"），这里显式维护一张别名字典，
不做模糊猜测，保证每张卡的价格与热量都能追溯到官方数据。

用法：
    python build_cardpool.py                 # 读 ../data/snapshot.json
    python build_cardpool.py --report        # 只打印匹配覆盖率
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 菜单名 -> 营养库名。只收录能明确对应的，宁缺毋滥。
ALIAS: dict[str, str] = {
    # 薯条 / 小食
    "薯条": "中薯条",
    "脆薯条": "中薯条",
    "麦乐鸡": "麦乐鸡5块",
    "麦辣鸡翅": "麦辣鸡翅-2块",
    "那么大鸡排（椒盐风味）": "那么大鸡排",
    "麦麦脆汁鸡1块": "麦麦脆汁鸡-琵琶腿",
    "玉米杯": "小杯玉米杯",
    "派": "香芋派",
    "新地": "朱古力新地",
    "经典麦旋风": "奥利奥麦旋风",
    # 饮品
    "可乐": "可乐中杯",
    "雪碧": "雪碧中杯",
    "牛奶": "纯牛奶（盒装）",
    "鲜萃咖啡": "小杯鲜萃咖啡",
    "麦咖啡™美式": "热美式中杯",
    "麦咖啡™奶铁": "热奶铁中杯",
    "卡布奇诺": "卡布奇诺中杯",
    "燕麦奶铁": "热燕麦奶铁中杯",
    "灰焰圆筒": "圆筒冰淇淋",
}

# 品类归类（用于游戏的"多样性"与手牌抽卡）
CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("主食", ("堡", "麦满分", "卷", "粥", "油条", "松饼", "鸡排", "脆汁鸡", "鸡块", "鸡翅", "鸡球", "香肠", "叠叠卷", "米饭", "意面")),
    ("小食", ("薯条", "薯饼", "苹果片", "玉米杯", "派", "鸡块", "鸡翅", "鸡排", "肉", "笋")),
    ("甜品", ("新地", "麦旋风", "圆筒", "阿芙佳朵", "拉明顿", "奶冻")),
    ("饮品", ("可乐", "雪碧", "咖啡", "茶", "牛奶", "豆浆", "橙", "柠檬", "怡泉", "纯悦", "汁", "奶铁", "美式", "卡布奇诺", "玛奇朵", "黑巧", "雪冰", "抹茶")),
]


def norm(s: str) -> str:
    return re.sub(r"[\s【】“”\"'()（）·™—-]", "", s or "")


def classify(name: str) -> str:
    for cat, keys in CATEGORY_RULES:
        if any(k in name for k in keys):
            return cat
    return "其他"


def build(snap: dict) -> dict:
    nut = {n["name"]: n for n in snap.get("nutrition", [])}
    nut_norm = {norm(k): v for k, v in nut.items()}
    alias_norm = {norm(k): v for k, v in ALIAS.items()}

    def resolve(menu_name: str) -> dict | None:
        if menu_name in nut:
            return nut[menu_name]
        if menu_name in ALIAS and ALIAS[menu_name] in nut:
            return nut[ALIAS[menu_name]]
        n = norm(menu_name)
        if n in nut_norm:
            return nut_norm[n]
        if n in alias_norm and alias_norm[n] in nut:
            return nut[alias_norm[n]]
        return None

    rounds: dict[str, list[dict]] = {}
    stats: dict[str, tuple[int, int]] = {}
    for rnd, menu in (snap.get("menus") or {}).items():
        meals = menu.get("meals") or {}
        cat_of: dict[str, str] = {}
        for c in menu.get("categories", []):
            for code in c.get("codes", []):
                cat_of.setdefault(code, (c.get("name") or "").replace("\n", "").strip())
        cards: list[dict] = []
        for code, m in meals.items():
            n = resolve(m.get("name") or "")
            if not n or not m.get("price"):
                continue
            cards.append({
                "code": code,
                "name": m.get("name"),
                "price": m.get("price"),
                "kcal": n.get("kcal"),
                "protein": n.get("protein"),
                "fat": n.get("fat"),
                "carb": n.get("carb"),
                "sodium": n.get("sodium"),
                "cat": classify(n.get("name") or m.get("name") or ""),
                "menuCat": cat_of.get(code, ""),
                "image": m.get("image"),
                "nutriName": n.get("name"),
            })
        cards.sort(key=lambda x: x["price"] or 0)
        rounds[rnd] = cards
        stats[rnd] = (len(cards), len(meals))

    # 活动事件（标题 + 清洗后的描述），供"今日事件"用
    def clean_campaign_text(raw: str) -> str:
        """MCP 活动 content 混着字段名与 HTML（**活动内容介绍**：… **活动图片介绍**：<img …>）。
        网页端是直接当文案显示的 ⇒ 必须洗成纯文本：去标签、去 **xxx**：字段名、折叠空白。"""
        s = raw or ""
        s = re.sub(r"<[^>]*>", " ", s)               # 去 HTML 标签（含 <img …>）
        s = re.sub(r"\*\*[^*]{0,20}\*\*\s*[:：]?", " ", s)  # 去 **活动内容介绍**：等加粗字段名
        s = re.sub(r"\s+", " ", s).strip()
        return s[:160]

    events = []
    for c in snap.get("campaigns", []):
        title = (c.get("title") or "").strip()
        if not title:
            continue
        events.append({
            "date": c.get("date", ""),
            "title": title,
            "text": clean_campaign_text(c.get("content")),
        })

    return {
        "meta": {
            "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": snap.get("meta", {}).get("source"),
            "note": "价格来自门店菜单，热量/蛋白/脂肪/碳水/钠来自官方营养库；"
                    "两表按餐品名对齐（含别名字典），未匹配到营养的餐品已剔除。",
        },
        "stats": {k: {"usable": v[0], "total": v[1]} for k, v in stats.items()},
        "rounds": rounds,
        "events": events,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=os.path.join(ROOT, "data", "snapshot.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "cardpool.json"))
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    snap = json.load(open(args.snapshot, encoding="utf-8"))
    pool = build(snap)
    if not args.report:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(pool, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"✅ 已写出 {args.out}")

    for rnd, s in pool["stats"].items():
        pct = 100.0 * s["usable"] / max(1, s["total"])
        print(f"   {rnd:<10} 可用 {s['usable']:>3} / {s['total']:>3}  ({pct:.0f}%)")
    for rnd, cards in pool["rounds"].items():
        cats: dict[str, int] = {}
        for c in cards:
            cats[c["cat"]] = cats.get(c["cat"], 0) + 1
        print(f"   {rnd:<10} 品类: {cats}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
