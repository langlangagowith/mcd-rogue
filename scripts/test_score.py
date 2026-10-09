#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""score.py 的单元测试。运行： python -m unittest test_score （在 scripts/ 目录下）"""

import unittest

from score import (
    Coupon,
    Item,
    baseline_total,
    final_score,
    rank_title,
    score_round,
)


class TestBaseline(unittest.TestCase):
    def test_sum(self):
        items = [Item("a", "A", 10.0, 100), Item("b", "B", 12.5, 200)]
        self.assertEqual(baseline_total(items), 22.5)


class TestScoreRound(unittest.TestCase):
    def test_save_rate(self):
        items = [Item("a", "A", 40.0, 500)]
        r = score_round(items, quotas_kcal=600, paid_total=20.0)
        self.assertAlmostEqual(r.save_rate, 0.5, places=4)

    def test_paid_above_base_is_zero_not_negative(self):
        items = [Item("a", "A", 10.0, 100)]
        r = score_round(items, quotas_kcal=100, paid_total=15.0)
        self.assertEqual(r.save_rate, 0.0)

    def test_calorie_hit(self):
        items = [Item("a", "A", 10.0, 300)]
        r = score_round(items, quotas_kcal=600, paid_total=8.0)
        self.assertAlmostEqual(r.calorie_hit, 0.5, places=4)

    def test_coupon_use_no_expiring_is_full(self):
        items = [Item("a", "A", 10.0, 300)]
        r = score_round(items, quotas_kcal=300, paid_total=10.0, coupons=[])
        self.assertEqual(r.coupon_use, 1.0)

    def test_coupon_use_partial(self):
        items = [Item("a", "A", 10.0, 300)]
        c1 = Coupon("c1", "券1", 2.0, expiring=True)
        c2 = Coupon("c2", "券2", 0.0, expiring=True)   # 未生效
        r = score_round(items, quotas_kcal=300, paid_total=8.0, coupons=[c1, c2])
        self.assertAlmostEqual(r.coupon_use, 0.5, places=4)

    def test_empty_items_raises(self):
        with self.assertRaises(ValueError):
            score_round([], quotas_kcal=500, paid_total=0.0)

    def test_bad_quota_raises(self):
        with self.assertRaises(ValueError):
            score_round([Item("a", "A", 1.0, 1)], quotas_kcal=0, paid_total=1.0)


class TestRange(unittest.TestCase):
    def test_total_within_0_100(self):
        items = [Item("a", "A", 10.0, 300)]
        for paid in (0.0, 5.0, 10.0, 20.0):
            for quota in (100, 300, 900):
                r = score_round(items, quotas_kcal=quota, paid_total=paid)
                self.assertGreaterEqual(r.total, 0.0)
                self.assertLessEqual(r.total, 100.0)

    def test_rank_title_boundaries(self):
        self.assertEqual(rank_title(95), "麦门之神")
        self.assertEqual(rank_title(80), "麦门门徒")
        self.assertEqual(rank_title(65), "麦门常客")
        self.assertEqual(rank_title(45), "麦门路人")
        self.assertEqual(rank_title(10), "路过麦门")

    def test_final_score_average(self):
        items = [Item("a", "A", 10.0, 300)]
        r1 = score_round(items, quotas_kcal=300, paid_total=5.0)
        r2 = score_round(items, quotas_kcal=300, paid_total=10.0)
        total, title = final_score([r1, r2])
        self.assertAlmostEqual(total, round((r1.total + r2.total) / 2, 1), places=1)
        self.assertIn(title, {"麦门之神", "麦门门徒", "麦门常客", "麦门路人", "路过麦门"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
