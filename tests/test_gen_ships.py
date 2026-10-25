"""gen_ships.py 的单元测试（标准库 unittest，无第三方依赖）。

python3 -m unittest -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from gen_ships import build, cells, clean_name, max_cells  # noqa: E402


class CellsTest(unittest.TestCase):
    def test_rounds_metres_to_cells(self) -> None:
        self.assertEqual(cells(1.25), 1)
        self.assertEqual(cells(2.5), 2)
        self.assertEqual(cells(3.75), 3)
        self.assertEqual(cells(6.25), 5)

    def test_invalid_values_are_zero(self) -> None:
        for value in (None, "", "abc", 0, -4):
            self.assertEqual(cells(value), 0)


class MaxCellsTest(unittest.TestCase):
    def test_sentinels_mean_unlimited(self) -> None:
        # 1.25³ 与 0×0×0 都是「未设置」
        self.assertIsNone(max_cells({"X": 1.25, "Y": 1.25, "Z": 1.25}))
        self.assertIsNone(max_cells({"X": 0, "Y": 0, "Z": 0}))
        self.assertIsNone(max_cells(None))

    def test_real_limit_is_kept(self) -> None:
        self.assertEqual(max_cells({"X": 2.5, "Y": 2.5, "Z": 10}), [2, 2, 8])


class CleanNameTest(unittest.TestCase):
    def test_strips_ship_prefix(self) -> None:
        self.assertEqual(clean_name("RSI_Zeus_CL", "RSI_Zeus_CargoGrid_Cargo_Main"), "Cargo_Main")

    def test_strips_hardpoint_prefix(self) -> None:
        self.assertEqual(clean_name("X", "hardpoint_cargogrid_side"), "side")

    def test_falls_back_to_raw(self) -> None:
        self.assertEqual(clean_name("X", "Weird_Grid"), "Weird_Grid")


class BuildTest(unittest.TestCase):
    def ship(self) -> dict[str, Any]:
        return {
            "ClassName": "TEST_Ship",
            "Name": "Test Ship",
            "Manufacturer": {"Code": "TEST"},
            "Cargo": 128,
            "Size": 3,
            "Role": "Freight",
            "CargoGrids": [
                {
                    "Class": "TEST_Ship_CargoGrid_Main",
                    "X": 6.25,
                    "Y": 10.0,
                    "Z": 3.75,
                    "SCU": 120,
                    "MaxSize": {"X": 2.5, "Y": 2.5, "Z": 10},
                },
                {
                    "Class": "TEST_Ship_CargoGrid_Main",
                    "X": 2.5,
                    "Y": 1.25,
                    "Z": 2.5,
                    "SCU": 4,
                    "MaxSize": {"X": 1.25, "Y": 1.25, "Z": 1.25},
                },
            ],
        }

    def test_builds_grids(self) -> None:
        ships = build([self.ship()])
        self.assertEqual(len(ships), 1)
        ship = ships[0]
        self.assertEqual(ship["cls"], "TEST_Ship")
        self.assertEqual(ship["mfr"], "TEST")
        self.assertEqual(len(ship["grids"]), 2)
        self.assertEqual(ship["grids"][0]["dims"], [5, 8, 3])
        self.assertEqual(ship["grids"][0]["max"], [2, 2, 8])
        # 同名网格自动编号
        self.assertEqual(ship["grids"][1]["name"], "Main #2")
        # 哨兵值折成 None
        self.assertIsNone(ship["grids"][1]["max"])

    def test_skips_ships_without_grids(self) -> None:
        raw = self.ship()
        raw["CargoGrids"] = []
        self.assertEqual(build([raw]), [])

    def test_skips_placeholder_and_broken_grids(self) -> None:
        raw = self.ship()
        raw["CargoGrids"] = [
            {"Class": "TEST_Ship_CargoGrid_Template", "X": 43.75, "Y": 43.75, "Z": 43.75},
            {"Class": "TEST_Ship_CargoGrid_Zero", "X": 0, "Y": 0, "Z": 0},
        ]
        self.assertEqual(build([raw]), [])


if __name__ == "__main__":
    unittest.main()
