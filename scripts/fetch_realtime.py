#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉取「真实感层」素材：官方券图 + 当日活动海报（一次性的网络管线，不进主构建）。

产出：
  data/realtime.json       券清单（券名 + 本地文件名）与当日活动（日期/标题/摘要 + 本地文件名）
  assets/coupons/raw/*.png 券图原图
  assets/poster/raw/poster.jpg  当日活动海报原图

为什么离线快照而不是运行时外链：
  - COS 券图 URL 带签名（q-sign-time ≈ 两周），线上放久了会 403；
  - 单文件游戏承诺「离线可玩 / 零依赖」，外链会破坏它并再次引入弱网白屏风险。
  ⇒ 这里只做「拉一次 → 压缩 → 内联」，运行时不碰网络。

用法：
    python scripts/fetch_realtime.py            # 拉券 + 当日活动
    python scripts/fetch_realtime.py --max 4    # 只要前 4 张券
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcp_client import MCPClient, _load_token  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
RAW_COUPONS = os.path.join(ROOT, "assets", "coupons", "raw")
RAW_POSTER = os.path.join(ROOT, "assets", "poster", "raw")
REALTIME = os.path.join(DATA, "realtime.json")
SNAPSHOT = os.path.join(DATA, "snapshot.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 McRogue/1.0"


def slugify(i: int) -> str:
    """券图本地文件名：coupon-1 … coupon-N（编号稳定，券名另存 JSON）。"""
    return f"coupon-{i}"


def download(url: str, dest: str) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        blob = r.read()
    with open(dest, "wb") as f:
        f.write(blob)
    return len(blob)


def fetch_coupons(max_n: int) -> list[dict]:
    cli = MCPClient(_load_token())
    cli.initialize()
    res = cli.call_tool("available-coupons", {})
    data = (res.get("structuredContent") or {}).get("data") or []
    seen: dict[str, str] = {}
    for c in data:
        n = (c.get("couponName") or "").strip()
        u = (c.get("couponImage") or "").strip()
        if n and u and n not in seen:
            seen[n] = u
    out = []
    for i, (name, url) in enumerate(list(seen.items())[:max_n], start=1):
        dest = os.path.join(RAW_COUPONS, slugify(i) + ".png")
        try:
            size = download(url, dest)
        except Exception as e:  # noqa: BLE001
            print(f"⚠ 券图下载失败，跳过「{name}」：{e}")
            continue
        out.append({"n": name, "f": slugify(i), "bytes": size})
        print(f"  券 {i} {name}  {size/1024:.0f} KB")
    return out


def fetch_poster() -> dict | None:
    """从已落盘的 snapshot 里挑「今日」活动（含海报图）→ 下载。"""
    if not os.path.isfile(SNAPSHOT):
        print("⚠ 没有 data/snapshot.json，跳过海报（先跑 fetch_snapshot.py）")
        return None
    snap = json.load(open(SNAPSHOT, encoding="utf-8"))
    for c in snap.get("campaigns") or []:
        if "今日" not in (c.get("date") or ""):
            continue
        m = re.search(r'<img[^>]+src="([^"]+)"', c.get("content") or "")
        if not m:
            continue
        dest = os.path.join(RAW_POSTER, "poster.jpg")
        try:
            size = download(m.group(1), dest)
        except Exception as e:  # noqa: BLE001
            print(f"⚠ 海报下载失败：{e}")
            return None
        text = re.sub(r"<[^>]+>", " ", c.get("content") or "")
        text = re.sub(r"\*\*|活动内容介绍|活动图片介绍", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        print(f"  海报 {c['title'][:28]}  {size/1024:.0f} KB")
        return {
            "date": (c.get("date") or "").replace(" 今日", "").strip(),
            "title": c.get("title") or "",
            "text": text[:120],
            "f": "poster",
            "bytes": size,
        }
    print("⚠ snapshot 里没有带图的「今日」活动")
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=5, help="最多内联几张券图")
    args = ap.parse_args()

    os.makedirs(RAW_COUPONS, exist_ok=True)
    os.makedirs(RAW_POSTER, exist_ok=True)

    print("→ 拉真实优惠券 …")
    coupons = fetch_coupons(args.max)
    if not coupons:
        print("❌ 一张券都没拉到")
        return 1
    print("→ 拉当日活动海报 …")
    poster = fetch_poster()

    payload = {
        "generatedAt": __import__("time").strftime("%Y-%m-%d %H:%M:%S"),
        "source": "麦当劳中国 MCP：available-coupons + query-campaigns",
        "coupons": coupons,
        "poster": poster,
    }
    with open(REALTIME, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"✅ 已写出 {REALTIME}（券 {len(coupons)} 张 · 海报 {'有' if poster else '无'}）")
    print("   下一步：python scripts/prepare_realtime.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
