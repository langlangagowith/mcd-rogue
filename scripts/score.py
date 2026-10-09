#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""麦门开饭 · McRogue 确定性结算引擎。

设计原则：**取数交给 MCP，算术交给代码，表达交给 Agent。**
本模块只做纯函数计算，不发起任何网络请求、不读写任何用户数据，
因此可以被 Agent 直接调用，也可以被网页版打包复用。

三项比分：
  省钱率   save_rate   = (base_total - paid_total) / base_total
  热量达成 calorie_hit = intake / quota      （1.0 为满分，越界扣分）
  券利用   coupon_use  = used_expiring / expiring_before

用法：
    python score.py --demo
    python -m unittest test_score        # 在 scripts/ 目录下运行
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence


# --------------------------------------------------------------------------
# 数据模型
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Item:
    """一份餐品/套餐。价格与热量必须来自 MCP，不允许估算。"""
    code: str
    name: str
    price: float          # 单点价（元），来自 query-meals / calculate-price
    kcal: float           # 热量（kcal），来自 list-nutrition-foods


@dataclass(frozen=True)
class Coupon:
    """一张优惠券。expiring=True 表示属于"临期券"。"""
    code: str
    name: str
    discount: float       # 该券带来的优惠金额（元）
    expiring: bool = False


@dataclass
class RoundScore:
    save_rate: float
    calorie_hit: float
    coupon_use: float

    @property
    def total(self) -> float:
        """回合总分（0~100）。权重：省钱 0.5 / 热量 0.3 / 券 0.2。"""
        # 热量达成按"偏离 1.0 的距离"折算：完全命中 1.0 得 100，偏离 50% 得 0
        calorie_score = max(0.0, 1.0 - abs(self.calorie_hit - 1.0) / 0.5)
        return round(
            100.0
            * (
                0.5 * max(0.0, min(1.0, self.save_rate))
                + 0.3 * calorie_score
                + 0.2 * max(0.0, min(1.0, self.coupon_use))
            ),
            1,
        )


# --------------------------------------------------------------------------
# 结算
# --------------------------------------------------------------------------

def baseline_total(items: Sequence[Item]) -> float:
    """同组合的"单点价"合计，作为省钱率的分母。"""
    return round(sum(i.price for i in items), 2)


def score_round(
    items: Sequence[Item],
    quotas_kcal: float,
    paid_total: float,
    coupons: Iterable[Coupon] = (),
) -> RoundScore:
    """结算一个回合。

    Args:
        items:        本回合选中的餐品（来自 MCP）
        quotas_kcal:  本回合热量额度
        paid_total:   用券后的实付总额（来自 MCP calculate-price）
        coupons:      本回合实际生效的券
    """
    if not items:
        raise ValueError("items 不能为空：每回合至少要选一件餐品")
    if quotas_kcal <= 0:
        raise ValueError("quotas_kcal 必须大于 0")

    base = baseline_total(items)
    if base <= 0:
        raise ValueError("单点价合计必须大于 0，请检查 MCP 返回的价格")

    coupons = list(coupons)
    if paid_total < 0:
        raise ValueError("paid_total 不能为负")

    save_rate = (base - paid_total) / base
    # 实付高于单点价说明券没生效或选错了组合，判 0 分而不是负分
    save_rate = max(0.0, save_rate)

    kcal = sum(i.kcal for i in items)
    calorie_hit = kcal / quotas_kcal

    expiring_before = [c for c in coupons if c.expiring]
    # 券利用率以"该回合可用临期券"为分母；没有临期券时按满分计（不惩罚）
    used_expiring = sum(1 for c in coupons if c.expiring and c.discount > 0)
    if not expiring_before:
        coupon_use = 1.0
    else:
        coupon_use = min(1.0, used_expiring / len(expiring_before))

    return RoundScore(
        save_rate=round(save_rate, 4),
        calorie_hit=round(calorie_hit, 4),
        coupon_use=round(coupon_use, 4),
    )


def rank_title(total: float) -> str:
    """把总分映射为段位。"""
    if total >= 90:
        return "麦门之神"
    if total >= 75:
        return "麦门门徒"
    if total >= 60:
        return "麦门常客"
    if total >= 40:
        return "麦门路人"
    return "路过麦门"


def final_score(rounds: Sequence[RoundScore]) -> tuple[float, str]:
    """三回合总评。"""
    if not rounds:
        raise ValueError("至少需要一回合")
    total = round(sum(r.total for r in rounds) / len(rounds), 1)
    return total, rank_title(total)


# --------------------------------------------------------------------------
# 自测
# --------------------------------------------------------------------------

def _demo() -> None:
    bigmac = Item("1001", "巨无霸", 24.0, 550)
    fries = Item("2001", "中薯条", 13.0, 340)
    coke = Item("3001", "中可乐", 10.0, 150)
    items = [bigmac, fries, coke]

    print("单点价合计:", baseline_total(items))

    # 场景：用「1+1 随心配」类券把实付压到 21.9
    coupon = Coupon("C1", "随心配券", discount=25.1, expiring=True)
    r = score_round(items, quotas_kcal=900, paid_total=21.9, coupons=[coupon])
    print(f"省钱率={r.save_rate:.1%} 热量达成={r.calorie_hit:.2f} 券利用={r.coupon_use:.0%} 回合分={r.total}")
    print("段位:", rank_title(r.total))


if __name__ == "__main__":
    import sys

    if "--demo" in sys.argv:
        _demo()
    else:
        print(__doc__)
