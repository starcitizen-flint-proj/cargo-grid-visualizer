#!/usr/bin/env python3
"""从 SDE 的 ships.json 提取货舱网格，生成应用用的 ships.js。

数据来源是 ``playground/scrape-lab/data/sde/ships.json``（已按默认装配解析过
``CargoGrids``），不需要解包数据或 starbreaker。

用法::

    python3 tools/gen_ships.py
    python3 tools/gen_ships.py --src ../../playground/scrape-lab/data/sde/ships.json
    python3 tools/gen_ships.py --out /tmp/ships.js
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

CELL_M = 1.25

# 开发占位模板是 35×35×35 格；真实货舱单轴实测最大 32（货运电梯）。
# 阈值取 34 只挡模板，不会误伤真实网格。
_MAX_REAL_AXIS = 34

# 轴序在不同容器上不一致，这些前缀只是为了让名字短一点
_STRIP_PREFIXES = (
    "hardpoint_cargogrid_",
    "cargogrid_",
    "cargoinventory_",
    "cargo_grid_",
)


def cells(value: Any) -> int:
    """米 → 格。非法的值一律当 0。"""
    try:
        metres = float(value) if value is not None else 0.0
    except TypeError, ValueError:
        return 0
    if metres <= 0:
        return 0
    return max(0, round(metres / CELL_M))


def max_cells(raw: dict[str, Any] | None) -> list[int] | None:
    """``maxPermittedItemSize``。0×0×0 与 1.25³ 都是「未设置」哨兵值。"""
    if not raw:
        return None
    dims = [cells(raw.get(k)) for k in ("X", "Y", "Z")]
    ordered = sorted(dims)
    if ordered[0] <= 0 or ordered == [1, 1, 1]:
        return None
    return dims


def clean_name(cls: str, raw: str) -> str:
    """``RSI_Zeus_CargoGrid_Cargo_Main`` → ``Cargo_Main``。

    网格实体名没有统一前缀（有的带船名、有的带 ``hardpoint_``），所以按已知的
    标记词切：切在最后一个能匹配上的标记之后，剩下的就是玩家看得懂的部分。
    """
    name = raw or ""
    lowered = name.lower()
    cut = 0
    for marker in _STRIP_PREFIXES:
        idx = lowered.find(marker)
        if idx >= 0:
            cut = max(cut, idx + len(marker))
    if cut:
        name = name[cut:]
    elif name.startswith(cls + "_"):
        name = name[len(cls) + 1 :]
    return name or raw or cls


def build(ships: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ship in ships:
        cls = ship.get("ClassName") or ""
        grids: list[dict[str, Any]] = []
        seen: dict[str, int] = {}
        for raw in ship.get("CargoGrids") or []:
            dims = [cells(raw.get(k)) for k in ("X", "Y", "Z")]
            if not all(dims):
                continue
            if max(dims) > _MAX_REAL_AXIS:
                continue
            name = clean_name(cls, raw.get("Class") or "")
            seen[name] = seen.get(name, 0) + 1
            if seen[name] > 1:
                name = f"{name} #{seen[name]}"
            grids.append(
                {
                    "name": name,
                    "dims": dims,
                    "max": max_cells(raw.get("MaxSize")),
                    "scu": int(raw.get("SCU") or dims[0] * dims[1] * dims[2]),
                }
            )
        if not grids:
            continue
        mfr = ship.get("Manufacturer") or {}
        out.append(
            {
                "cls": cls,
                "name": ship.get("Name") or cls,
                "mfr": mfr.get("Code") or "",
                "cargo": int(ship.get("Cargo") or 0),
                "size": ship.get("Size"),
                "role": ship.get("Role") or "",
                "grids": grids,
            }
        )
    out.sort(key=lambda s: (s["name"], s["cls"]))
    return out


def dump_js(ships: list[dict[str, Any]]) -> str:
    header = "/* 由 tools/gen_ships.py 从 SDE ships.json 生成，不要手改。 */\n"
    lines = [json.dumps(s, ensure_ascii=False, separators=(",", ":")) for s in ships]
    return header + "window.SC_SHIPS = [\n" + ",\n".join(lines) + "\n];\n"


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="生成 ships.js")
    ap.add_argument(
        "--src",
        default=str(here.parent.parent / "playground/scrape-lab/data/sde/ships.json"),
        help="SDE ships.json 路径",
    )
    ap.add_argument("--out", default=str(here.parent / "ships.js"), help="输出文件")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        raise SystemExit(f"找不到 {src}，先用 --src 指定")
    with src.open(encoding="utf-8") as fh:
        raw = json.load(fh)

    ships = build(raw)
    grids = sum(len(s["grids"]) for s in ships)
    text = dump_js(ships)
    Path(args.out).write_text(text, encoding="utf-8")

    biggest = sorted(
        ((g["dims"], s["name"], g["name"]) for s in ships for g in s["grids"]),
        key=lambda t: t[0][0] * t[0][1] * t[0][2],
        reverse=True,
    )[:5]
    print(f"船 {len(ships)} 艘（共 {len(raw)} 条），网格 {grids} 个")
    print(f"写出 {args.out}（{len(text) / 1024:.0f} KB）")
    print("最大的几个网格：")
    for dims, ship, name in biggest:
        vol = dims[0] * dims[1] * dims[2]
        print(f"  {dims[0]}×{dims[1]}×{dims[2]} = {vol:5d} SCU  {ship} / {name}")


if __name__ == "__main__":
    main()
