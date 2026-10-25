/* 全部配色集中在这里，改完刷新页面即可生效。
 *
 * 三组用途不同：
 *   crateColors —— 货箱颜色，界面和导出图共用，按 SCU 查表
 *   sheet       —— 导出图（浅色，适合打印 / 贴参考）
 *   editor      —— 编辑区画布
 *   ui          —— 界面外壳，会被写入 CSS 变量（键名 = 变量名）
 *
 * 键名不要改：model.js / render.js / app.js 都按名字取。
 */
window.CGV_THEME = {
  // ---------------------------------------------------------- 货箱颜色
  // 想换配色只改这里；键是 SCU 数，值是 #rrggbb。
  crateColors: {
    32: "#d64541", // 红
    24: "#e08e0b", // 橙
    16: "#d4b106", // 黄
    8: "#219a52", // 绿
    4: "#2f80c1", // 蓝
    2: "#8e44ad", // 紫
    1: "#7f8c8d", // 灰
  },

  // ---------------------------------------------------------- 导出图（浅色）
  sheet: {
    bg: "#f7f8fa", // 画布底色
    ink: "#1f2933", // 正文
    muted: "#7b8794", // 次要文字
    faint: "#aab4bf", // 更浅的说明文字
    floor: "#e8ecf1", // 网格地面
    gridLine: "#d5dbe3", // 地面格线
    floorEdge: "#c7ced8", // 地面 / 面板边框
    panel: "#eef1f5", // 三视图面板底
    panelGrid: "#e1e5eb", // 面板格线
    boxStroke: "#1f2933", // 货箱描边
    labelBg: "#ffffff", // 标签底色
    labelBgOpacity: 0.85,
  },

  // 等距图的明暗：正面 = 1.0，右面 / 左面各乘一个系数
  iso: {
    leftShade: 0.72,
    rightShade: 0.86,
    strokeWidth: 0.8,
  },

  // ---------------------------------------------------------- 编辑区
  editor: {
    bg: "#fbfcfd", // 画布底色
    gridLine: "#dbe2ea", // 格线
    gridEdge: "#9aa7b5", // 网格外框
    cellHover: "#cfe4f7", // 悬停格
    ruler: "#9aa7b5", // 坐标刻度
    upperFill: 0.4, // 「下层箱子的上半截」透明度
    ghostOk: "#2fb26a", // 可放
    ghostBad: "#e04848", // 冲突
    ghostFill: 0.16,
    selection: "#0f8fd6", // 选中框
    selectedGlow: 0.28,
    label: "#ffffff", // 箱内数字
    labelShadow: "rgba(0,0,0,0.45)",
  },

  // ---------------------------------------------------------- 界面外壳（暗色）
  ui: {
    bg: "#0e1319",
    panel: "#151c25",
    panel2: "#1b2430",
    border: "#26323f",
    text: "#dbe4ee",
    textDim: "#8494a5",
    accent: "#2f9fe0",
    accentDim: "#1d5f87",
    ok: "#2fb26a",
    danger: "#e04848",
    warn: "#d9a521",
    shadow: "rgba(0,0,0,0.35)",
  },
};

window.CGV_color = function (scu) {
  return (window.CGV_THEME.crateColors || {})[scu] || "#888888";
};
