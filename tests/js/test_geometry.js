/* 前端几何与规则的自测（不依赖浏览器 / 第三方库）。
 *
 *     node tests/js/test_geometry.js
 *
 * 覆盖两件容易回归的事：
 *   1. 画布坐标 → 网格坐标的换算（曾把 devicePixelRatio 乘进鼠标位置，
 *      高 DPI 屏上预览整体偏向右下，严重时直接飞出网格）；
 *   2. 货箱摆放规则（越界、重叠、旋转、移动回滚）。
 */

"use strict";

const path = require("path");
const base = path.resolve(__dirname, "../..");

globalThis.window = globalThis;
require(path.join(base, "js/theme.js"));
require(path.join(base, "js/model.js"));
require(path.join(base, "js/render.js"));

const M = globalThis.CGV;
const R = globalThis.CGV_RENDER;

let failed = 0;
function ok(cond, name, extra) {
  if (cond) {
    console.log("ok  : " + name);
  } else {
    failed++;
    console.log("FAIL: " + name + (extra ? "  " + extra : ""));
  }
}
function eq(got, want, name) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(g === w, name, "got=" + g + " want=" + w);
}

// ---------------------------------------------------------------- 坐标换算

const grid = new M.GridModel({ name: "t", dims: [4, 4, 2], max: null });
const sheet = R.editorSheet(grid, {
  width: 804,
  height: 623,
  layer: 0,
  hover: null,
  ghost: null,
  selectedId: null,
});
const view = sheet.view;

function cellAt(scale, gx, gy) {
  const q = R.cellAtPoint(view, 804 * scale, 623 * scale, gx * scale, gy * scale);
  if (!q) return null;
  const x = Math.floor(q.fx);
  const y = Math.floor(q.fy);
  if (x < 0 || y < 0 || x >= 4 || y >= 4) return null;
  return [x, y];
}

eq(cellAt(1, view.x0 + 1, view.y0 + 1), [0, 0], "左上角格");
eq(cellAt(1, view.x0 + 2.5 * view.cell, view.y0 + 3.5 * view.cell), [2, 3], "格 (2,3) 中心");
eq(cellAt(1, 5, 5), null, "网格外返回 null");

// 关键回归：设备像素比只影响画布内部像素数，不改变落点
[1, 1.25, 1.5, 2].forEach(function (scale) {
  eq(
    cellAt(scale, view.x0 + 2.5 * view.cell, view.y0 + 3.5 * view.cell),
    [2, 3],
    "缩放 " + scale + "× 时落点不变"
  );
  eq(
    cellAt(scale, view.x0 + 0.5 * view.cell, view.y0 + 0.5 * view.cell),
    [0, 0],
    "缩放 " + scale + "× 时左上角不变"
  );
});

eq(
  cellAt(1, view.x0 + view.cell + 0.5, view.y0 + 0.5),
  [1, 0],
  "跨过分界线进入下一格"
);

// ---------------------------------------------------------------- 摆放规则

const g = new M.GridModel({ name: "zeus", dims: [5, 8, 3], max: [2, 2, 8] });
ok(g.allowed.indexOf(32) >= 0, "5×8×3 且上限 2×2×8 时允许 32 SCU");
ok(g.allowed.indexOf(24) >= 0, "允许 24 SCU");
ok(new M.GridModel({ dims: [5, 8, 3], max: [2, 2, 4] }).allowed.indexOf(32) < 0, "上限 2×2×4 时禁止 32 SCU");
ok(M.normalizeMax([1, 1, 1]) === null, "1×1×1 是「未设置」哨兵值");
ok(M.normalizeMax([0, 3, 3]) === null, "含 0 也是「未设置」");

ok(g.canPlace(32, 0, 0, 0, 0, 0).ok, "32 SCU 放得下");
ok(!g.canPlace(32, 0, 1, 0, 0, 0).ok, "出界被拦");
g.add(32, 0, 0, 0, 0);
ok(!g.add(32, 0, 0, 0, 0).ok, "重叠被拦");
ok(!g.canPlace(8, 0, 0, 1, 0, 0).ok, "2 格高箱子的第二层也被占用");
ok(g.filled() === 32, "占用格数正确");

const id = g.crates[0].id;
ok(!g.rotate(id).ok, "5 宽的网格里 32 SCU 转不开");
ok(g.byId[id].yaw === 0, "旋转失败不改状态");
ok(g.moveTo(id, 3, 0, 0).ok, "可以移动");
ok(!g.moveTo(id, 4, 0, 0).ok, "越界移动被拒绝");
ok(g.findAt(3, 3, 1) !== null, "越界移动后位置回滚");

const wide = new M.GridModel({ name: "w", dims: [10, 10, 2], max: null });
wide.add(32, 0, 0, 0, 0);
ok(wide.rotate(wide.crates[0].id).ok, "10 宽时 32 SCU 能转 90°");
ok(wide.findAt(7, 1, 1) !== null, "旋转后占格跟着变");

const round = new M.GridModel({ name: "r", dims: [5, 8, 3], max: null });
round.load([{ scu: 32, x: 0, y: 0, z: 0, yaw: 0 }, { scu: 4, x: 0, y: 0, z: 2, yaw: 0 }]);
eq(round.crates.length, 2, "JSON 载入");
eq(round.toJSON().length, 2, "JSON 导出");

// ---------------------------------------------------------------- 出图

[["isoSheet", {}], ["orthoSheet", {}], ["layersSheet", {}]].forEach(function (pair) {
  const fn = R[pair[0]];
  const s = fn([round], { headerLines: ["t"] });
  const svg = R.toSVG(s, "#f7f8fa");
  ok(s.width > 100 && s.height > 100, pair[0] + " 尺寸合理");
  ok(svg.indexOf("<svg") === 0 && svg.trim().endsWith("</svg>"), pair[0] + " 生成完整 SVG");
  ok(svg.indexOf('font-family=""') < 0, pair[0] + " 属性引号没有嵌套错误");
});

console.log(failed ? "\n" + failed + " 项失败" : "\n全部通过");
process.exit(failed ? 1 : 0);
