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

// ---------------------------------------------------------------- 等距图底部图例

const iso = R.isoSheet([round], { width: 800 });
const isoSvg = R.toSVG(iso, "#ffffff");
ok(isoSvg.indexOf("货箱统计") >= 0, "等距图有货箱统计");
ok(isoSvg.indexOf("32 SCU") >= 0, "统计里有放过的尺寸");
ok(isoSvg.indexOf("24 SCU") < 0, "没放过的尺寸不显示");
ok(isoSvg.indexOf("SCU  ·") < 0, "不再输出「网格名 / 尺寸 / 件数」标注");
ok(isoSvg.indexOf("图例") < 0, "不输出旧版底部图例");
ok(isoSvg.indexOf(">r<") < 0, "不再输出标题");

// 图例条目（标题 / 尺寸 / 合计）的基线 y 去重后就是行数
function legendRows(sheet) {
  const ys = new Set();
  sheet.ops.items.forEach(function (o) {
    if (o.t !== "text") return;
    if (o.s === "货箱统计" || o.s.indexOf(" SCU × ") > 0 || o.s.indexOf("共 ") === 0) {
      ys.add(o.y);
    }
  });
  return ys.size;
}

const legendWide = R.isoSheet([round], { width: 1600 });
eq(legendRows(legendWide), 1, "图例够宽时只有一行");

const legendNarrow = R.isoSheet([round], { width: 460, pad: 20 });
ok(legendRows(legendNarrow) > 1, "图例放不下时自动换行");

const legendTexts = legendNarrow.ops.items.filter(function (o) {
  return o.t === "text" && (o.s === "货箱统计" || o.s.indexOf(" SCU × ") > 0);
});
const legendY = legendTexts.map(function (o) {
  return o.y;
});
ok(Math.min.apply(null, legendY) > legendNarrow.height / 2, "图例排在图的下方");
ok(
  legendTexts.every(function (o) {
    return o.x < legendNarrow.width - 20;
  }),
  "换行后的图例不超出画布宽度"
);
ok(Math.max.apply(null, legendY) < legendNarrow.height - 20, "最后一行图例不超出画布底部");

const isoEmpty = R.isoSheet([new M.GridModel({ name: "e", dims: [2, 2, 2], max: null })], { width: 400 });
ok(R.toSVG(isoEmpty, "#ffffff").indexOf("货箱统计") < 0, "空网格不画图例");

// 导出选项：隐藏图例 / 透明背景
const isoNoLegend = R.isoSheet([round], { width: 800, stats: false });
ok(R.toSVG(isoNoLegend, "#ffffff").indexOf("货箱统计") < 0, "隐藏图例后不画货箱统计");
ok(isoNoLegend.height < iso.height, "隐藏图例后画布变矮");

const isoTransparent = R.isoSheet([round], { width: 800, transparent: true });
ok(
  R.toSVG(isoTransparent, null).indexOf('<rect width="100%" height="100%"') < 0,
  "透明背景不画铺底矩形"
);
ok(
  isoTransparent.ops.items.some(function (o) {
    return o.t === "poly" && o.fill === globalThis.CGV_THEME.sheet.floor;
  }),
  "透明背景仍保留地面 / 格线"
);

// 透明背景 + 显示图例时，图例底下要有圆角底板
function backdropRects(sheet) {
  return sheet.ops.items.filter(function (o) {
    return o.t === "rect" && o.rx === 20;
  });
}
const backdrops = backdropRects(isoTransparent);
eq(backdrops.length, 2, "透明背景 + 图例时画「填充 + 描边」两层底板");
ok(backdrops[0] && backdrops[0].fill === "#ffffff" && backdrops[0].opacity === 0.75, "底板是 75% 白色");
ok(
  backdrops[1] &&
    backdrops[1].stroke === globalThis.CGV_THEME.sheet.ink &&
    backdrops[1].sw === 3,
  "底板描边 3px 且与货箱统计同色"
);
eq(backdropRects(iso).length, 0, "不透明背景不画底板");
eq(
  backdropRects(R.isoSheet([round], { width: 800, transparent: true, stats: false })).length,
  0,
  "隐藏图例时不画底板"
);

console.log(failed ? "\n" + failed + " 项失败" : "\n全部通过");
process.exit(failed ? 1 : 0);
