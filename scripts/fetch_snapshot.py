#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从麦当劳 MCP 导出**公开数据**快照，供离线网页版使用。

只导出公开数据：菜单、营养、活动日历、门店级公开优惠券。
**绝不导出**：个人账户、积分、卡包券、订单、地址。

用法：
    python fetch_snapshot.py --city 杭州 --keyword 杭州 --store 3330521
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcp_client import MCPClient, MCPError, _load_token  # noqa: E402

# 营养表字段顺序（来自 MCP 返回的表头）
NUTRI_FIELDS = [
    "productName", "nutritionDescription", "energyKj", "energyKcal",
    "protein", "fat", "carbohydrate", "sodium", "calcium",
]


def _num(s: str):
    s = (s or "").strip()
    if s in ("", "null", "None", "-", "--"):
        return None
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None


def parse_nutrition(text: str) -> list[dict]:
    """解析 list-nutrition-foods 的文本表。

    格式：
        [160]{productName,...,calcium}:
          猪柳麦满分,null,1288,308,16,16,24,781,213
    """
    out: list[dict] = []
    started = False
    for raw in text.splitlines():
        line = raw.strip()
        if not started:
            if line.startswith("[") and "{productName" in line:
                started = True
            continue
        if not line or line.startswith("["):
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < len(NUTRI_FIELDS):
            continue
        tail = parts[-7:]                      # 7 个数值列
        name = parts[0]
        desc = ",".join(parts[1:len(parts) - 7])
        rec = {"name": name, "desc": desc or None}
        rec["kj"] = _num(tail[0])
        rec["kcal"] = _num(tail[1])
        rec["protein"] = _num(tail[2])
        rec["fat"] = _num(tail[3])
        rec["carb"] = _num(tail[4])
        rec["sodium"] = _num(tail[5])
        rec["calcium"] = _num(tail[6])
        out.append(rec)
    return out


def parse_campaigns(structured: dict, text: str) -> list[dict]:
    """优先用结构化数据，退化时解析文本。"""
    data = structured.get("data")
    items: list[dict] = []
    if isinstance(data, list):
        for d in data:
            if isinstance(d, dict):
                items.append({
                    "date": str(d.get("date") or d.get("startDate") or ""),
                    "title": str(d.get("title") or d.get("name") or ""),
                    "content": str(d.get("content") or d.get("desc") or "")[:600],
                })
        if items:
            return items

    # 文本退化解析
    cur_date = ""
    cur_title = None
    buf: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r"^####\s*(.+?)\s*$", s)
        if m:
            if cur_title:
                items.append({"date": cur_date, "title": cur_title, "content": "\n".join(buf).strip()[:600]})
            cur_date = m.group(1)
            cur_title, buf = None, []
            continue
        m = re.match(r"^\-\s*\*\*活动标题\*\*：\s*(.+)$", s)
        if m:
            if cur_title:
                items.append({"date": cur_date, "title": cur_title, "content": "\n".join(buf).strip()[:600]})
            cur_title, buf = m.group(1).strip(), []
            continue
        if cur_title is not None and s:
            buf.append(s)
    if cur_title:
        items.append({"date": cur_date, "title": cur_title, "content": "\n".join(buf).strip()[:600]})
    return items


def parse_menu(structured: dict) -> dict:
    data = structured.get("data") or {}
    cats = []
    for c in data.get("categories", []) or []:
        cats.append({
            "name": c.get("name"),
            "codes": [m.get("code") for m in (c.get("meals") or []) if m.get("code")],
        })
    meals = {}
    for code, m in (data.get("meals") or {}).items():
        meals[code] = {
            "name": m.get("name"),
            "image": m.get("image"),
            "price": _num(m.get("currentPrice")),
            "originalPrice": _num(m.get("originalPrice")),
        }
    return {"categories": cats, "meals": meals}


def parse_store_coupons(structured: dict) -> list[dict]:
    data = structured.get("data")
    out = []
    if not isinstance(data, list):
        return out
    for c in data:
        if not isinstance(c, dict):
            continue
        window = str(c.get("tradeDateTime") or "")
        out.append({
            "title": c.get("title"),
            "products": [p.get("productName") for p in (c.get("products") or [])],
            "window": window,
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="杭州")
    ap.add_argument("--keyword", default="杭州")
    ap.add_argument("--store", default="")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "data", "snapshot.json"))
    args = ap.parse_args()

    cli = MCPClient(_load_token())
    cli.initialize()

    def call(name, a=None):
        return cli.call_tool(name, a or {}).get("structuredContent", {})

    def text_of(name, a=None):
        r = cli.call_tool(name, a or {})
        parts = [c.get("text", "") for c in r.get("content", []) if isinstance(c, dict)]
        return "\n".join(parts)

    # 1) 门店
    stores = []
    sc = call("query-nearby-stores",
              {"beType": 1, "searchType": 2, "city": args.city, "keyword": args.keyword})
    if isinstance(sc.get("data"), list):
        for s in sc["data"]:
            stores.append({
                "storeCode": s.get("storeCode"), "name": s.get("storeName"),
                "address": s.get("address"), "distance": s.get("distance"),
                "open": f"{s.get('businessStartTime')}-{s.get('businessEndTime')}",
            })
    store_code = args.store or (stores[0]["storeCode"] if stores else "")

    # 2) 三餐菜单
    # 关键：query-meals 传 reservationDate 可拉到"未来某时刻"的菜单 ——
    # 由此拿到早餐菜单（不传预约只能拿到当前时段菜单）。
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    menus = {}
    if store_code:
        for key, hhmm in (("breakfast", "08:00"), ("lunch", "12:30"), ("dinner", "18:30")):
            menus[key] = parse_menu(call("query-meals", {
                "storeCode": store_code, "orderType": 1, "beType": 1,
                "reservationDate": f"{tomorrow} {hhmm}",
            }))
    else:
        menus = {"breakfast": {"categories": [], "meals": {}},
                 "lunch": {"categories": [], "meals": {}},
                 "dinner": {"categories": [], "meals": {}}}

    # 3) 营养
    # 注意：营养表位于 structuredContent.data（含真实换行）；
    # content 文本块里是 JSON 转义过的 \n，不能直接按行切。
    nu_sc = call("list-nutrition-foods")
    raw_nu = nu_sc.get("data")
    if not isinstance(raw_nu, str) or "{productName" not in raw_nu:
        raw_nu = text_of("list-nutrition-foods").replace("\\n", "\n")
    nutrition = parse_nutrition(raw_nu)

    # 4) 活动
    campaigns = parse_campaigns(call("campaign-calendar"), text_of("campaign-calendar"))

    # 5) 门店级公开券
    coupons = []
    if store_code:
        coupons = parse_store_coupons(call("query-store-coupons",
                                           {"storeCode": store_code, "orderType": 1, "beType": 1}))

    snap = {
        "meta": {
            "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": "麦当劳中国 MCP (mcp.mcd.cn)",
            "scope": "仅公开数据：菜单 / 营养 / 活动日历 / 门店级公开优惠券",
            "note": "不含任何个人账户、积分、卡包券、订单或地址信息",
            "city": args.city,
            "storeCode": store_code,
        },
        "stores": stores[:8],
        "menus": menus,
        "nutrition": nutrition,
        "campaigns": campaigns,
        "storeCoupons": coupons,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print(f"✅ 已写出 {args.out}")
    print(f"   门店 {len(stores)} · 营养 {len(nutrition)} · 活动 {len(campaigns)} "
          f"· 公开券 {len(coupons)}  (storeCode={store_code})")
    for k, v in menus.items():
        print(f"   菜单[{k}] {len(v['meals'])} 项 · 分类 {len(v['categories'])}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MCPError as e:
        print(f"❌ {e}")
        raise SystemExit(1)
