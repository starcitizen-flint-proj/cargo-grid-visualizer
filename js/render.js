/* 渲染：把场景编译成一份中立的图元列表（Ops），再分别输出 SVG 与 Canvas。
 * 两个后端吃同一份图元，所以导出的 PNG 和 SVG 几何完全一致。
 *
 * 四类场景：
 *   isoSheet     等距立体总览
 *   orthoSheet   正 / 侧 / 俯三视图
 *   layersSheet  逐层俯视 + 编号清单（主要参考图）
 *   editorSheet  交互编辑画布（只有 Canvas 用）
 */
(function (global) {
  "use strict";

  var M = global.CGV;
  var COS30 = Math.sqrt(3) / 2;

  var SANS =
    '"DejaVu Sans", "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", sans-serif';
  var MONO = '"DejaVu Sans Mono", Consolas, "Courier New", monospace';

  // 导出图与编辑画布的字号倍率：只改这一个数就能整体缩放所有文字。
  // 和文字相关的间距（行高、标签偏移、卡片尺寸）都跟着它走，
  // 否则字变大之后会互相压住。
  var FS = 3;

  function px(n) {
    return Math.round(n * FS * 10) / 10;
  }

  function theme() {
    return global.CGV_THEME;
  }
  function colorOf(scu) {
    var c = theme().crateColors || {};
    return c[scu] || "#888888";
  }

  // ------------------------------------------------------------ 图元收集

  function Ops() {
    this.items = [];
  }
  Ops.prototype.rect = function (x, y, w, h, s) {
    this.items.push(assign({ t: "rect", x: x, y: y, w: w, h: h }, s));
    return this;
  };
  Ops.prototype.poly = function (pts, s) {
    this.items.push(assign({ t: "poly", pts: pts }, s));
    return this;
  };
  Ops.prototype.line = function (x1, y1, x2, y2, s) {
    this.items.push(assign({ t: "line", x1: x1, y1: y1, x2: x2, y2: y2 }, s));
    return this;
  };
  Ops.prototype.text = function (x, y, s, o) {
    this.items.push(assign({ t: "text", x: x, y: y, s: s }, o));
    return this;
  };

  function assign(base, src) {
    if (!src) return base;
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) base[k] = src[k];
    return base;
  }

  function hexShade(hex, factor) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var f = function (v) {
      return Math.max(0, Math.min(255, Math.round(v * factor)));
    };
    return "#" + [f(r), f(g), f(b)].map(pad2).join("");
  }

  function pad2(v) {
    return (v < 16 ? "0" : "") + v.toString(16);
  }

  /** 浅色底用深字，深色底用白字。 */
  function inkOn(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1f2933" : "#ffffff";
  }

  /** 粗略估算文字宽度：中日韩按 1em，其它按 0.62em（DejaVu Sans 的数字/字母更宽）。 */
  function textWidth(str, size) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      w += str.charCodeAt(i) > 0x2e80 ? size : size * 0.62;
    }
    return w;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function num(v) {
    return Math.round(v * 100) / 100;
  }

  // ------------------------------------------------------------ SVG 后端

  function toSVG(sheet, bg) {
    var out = [];
    out.push(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        sheet.width +
        '" height="' +
        sheet.height +
        '" viewBox="0 0 ' +
        sheet.width +
        " " +
        sheet.height +
        '" font-family=\'' +
        SANS +
        "'>"
    );
    // bg 为空表示透明背景（等距图导出选项），不画铺底矩形
    if (bg) out.push('<rect width="100%" height="100%" fill="' + bg + '"/>');
    sheet.ops.items.forEach(function (o) {
      if (o.t === "rect") {
        out.push(
          "<rect" +
            attr("x", o.x) +
            attr("y", o.y) +
            attr("width", o.w) +
            attr("height", o.h) +
            fillAttrs(o) +
            ' stroke="' +
            (o.stroke || "none") +
            '" stroke-width="' +
            (o.sw == null ? 1 : o.sw) +
            '"' +
            (o.rx ? ' rx="' + o.rx + '"' : "") +
            (o.dash ? ' stroke-dasharray="' + o.dash.join(" ") + '"' : "") +
            "/>"
        );
      } else if (o.t === "poly") {
        out.push(
          '<polygon points="' +
            o.pts
              .map(function (p) {
                return num(p[0]) + "," + num(p[1]);
              })
              .join(" ") +
            '"' +
            fillAttrs(o) +
            ' stroke="' +
            (o.stroke || "none") +
            '" stroke-width="' +
            (o.sw == null ? 1 : o.sw) +
            '"/>'
        );
      } else if (o.t === "line") {
        out.push(
          "<line" +
            attr("x1", o.x1) +
            attr("y1", o.y1) +
            attr("x2", o.x2) +
            attr("y2", o.y2) +
            ' stroke="' +
            (o.stroke || "#000") +
            '" stroke-width="' +
            (o.sw == null ? 1 : o.sw) +
            '"' +
            (o.dash ? ' stroke-dasharray="' + o.dash.join(" ") + '"' : "") +
            "/>"
        );
      } else if (o.t === "text") {
        out.push(
          "<text" +
            attr("x", o.x) +
            attr("y", o.y) +
            ' font-size="' +
            (o.size || px(12)) +
            '"' +
            " font-family='" +
            (o.family === "mono" ? MONO : SANS) +
            "'" +
            (o.weight ? ' font-weight="' + o.weight + '"' : "") +
            (o.anchor ? ' text-anchor="' + o.anchor + '"' : "") +
            ' fill="' +
            (o.fill || theme().sheet.ink) +
            '"' +
            (o.opacity != null ? ' fill-opacity="' + o.opacity + '"' : "") +
            ">" +
            esc(o.s) +
            "</text>"
        );
      }
    });
    out.push("</svg>");
    return out.join("\n");
  }

  function attr(name, v) {
    return " " + name + '="' + num(v) + '"';
  }

  function fillAttrs(o) {
    return (
      ' fill="' +
      (o.fill || "none") +
      '"' +
      (o.opacity != null ? ' fill-opacity="' + o.opacity + '"' : "")
    );
  }

  // ------------------------------------------------------------ Canvas 后端

  function paintCanvas(canvas, sheet, bg, scale) {
    scale = scale || 1;
    canvas.style.width = sheet.width + "px";
    canvas.style.height = sheet.height + "px";
    canvas.width = Math.max(1, Math.round(sheet.width * scale));
    canvas.height = Math.max(1, Math.round(sheet.height * scale));
    var ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, sheet.width, sheet.height);
    } else {
      // 透明背景：新画布本身就是透明的，清一下兼容复用的情况
      ctx.clearRect(0, 0, sheet.width, sheet.height);
    }
    ctx.lineJoin = "round";

    sheet.ops.items.forEach(function (o) {
      ctx.save();
      if (o.opacity != null) ctx.globalAlpha = o.opacity;
      if (o.t === "rect") {
        if (o.rx && ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(o.x, o.y, o.w, o.h, o.rx);
          if (o.fill && o.fill !== "none") {
            ctx.fillStyle = o.fill;
            ctx.fill();
          }
          if (o.stroke && o.stroke !== "none") {
            ctx.strokeStyle = o.stroke;
            ctx.lineWidth = o.sw == null ? 1 : o.sw;
            ctx.setLineDash(o.dash || []);
            ctx.stroke();
          }
        } else {
          if (o.fill && o.fill !== "none") {
            ctx.fillStyle = o.fill;
            ctx.fillRect(o.x, o.y, o.w, o.h);
          }
          if (o.stroke && o.stroke !== "none") {
            ctx.strokeStyle = o.stroke;
            ctx.lineWidth = o.sw == null ? 1 : o.sw;
            ctx.setLineDash(o.dash || []);
            ctx.strokeRect(o.x, o.y, o.w, o.h);
          }
        }
      } else if (o.t === "poly") {
        ctx.beginPath();
        o.pts.forEach(function (p, i) {
          if (i === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        });
        ctx.closePath();
        if (o.fill && o.fill !== "none") {
          ctx.fillStyle = o.fill;
          ctx.fill();
        }
        if (o.stroke && o.stroke !== "none") {
          ctx.strokeStyle = o.stroke;
          ctx.lineWidth = o.sw == null ? 1 : o.sw;
          ctx.setLineDash(o.dash || []);
          ctx.stroke();
        }
      } else if (o.t === "line") {
        ctx.beginPath();
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x2, o.y2);
        ctx.strokeStyle = o.stroke || "#000";
        ctx.lineWidth = o.sw == null ? 1 : o.sw;
        ctx.setLineDash(o.dash || []);
        ctx.stroke();
      } else if (o.t === "text") {
        ctx.font =
          (o.weight || 400) + " " + (o.size || px(12)) + "px " + (o.family === "mono" ? MONO : SANS);
        ctx.fillStyle = o.fill || theme().sheet.ink;
        ctx.textAlign = o.anchor === "middle" ? "center" : o.anchor === "end" ? "right" : "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(o.s, o.x, o.y);
      }
      ctx.restore();
    });
  }

  // ------------------------------------------------------------ 公共零件

  function countsOf(models) {
    var out = {};
    models.forEach(function (m) {
      m.crates.forEach(function (c) {
        out[c.scu] = (out[c.scu] || 0) + 1;
      });
    });
    return out;
  }

  function totalsOf(models) {
    var crates = 0,
      scu = 0,
      cap = 0;
    models.forEach(function (m) {
      crates += m.crates.length;
      cap += m.capacity();
      m.crates.forEach(function (c) {
        scu += c.scu;
      });
    });
    return { crates: crates, scu: scu, cap: cap };
  }

  function summaryLine(models) {
    var t = totalsOf(models);
    var pct = t.cap ? Math.round((t.scu / t.cap) * 100) : 0;
    return (
      models.length +
      " 个网格  ·  " +
      t.crates +
      " 件  ·  " +
      t.scu +
      "/" +
      t.cap +
      " SCU (" +
      pct +
      "%)"
    );
  }

  var LEGEND_ORDER = [32, 24, 16, 8, 4, 2, 1];

  function legendOps(ops, models, x, y, label) {
    var th = theme();
    var counts = countsOf(models);
    ops.text(x, y, label || "图例", { size: px(12), weight: 700, fill: th.sheet.ink });
    var cx = x;
    var sw = px(13);
    LEGEND_ORDER.forEach(function (scu) {
      var n = counts[scu] || 0;
      if (!n) return;
      ops.rect(cx, y + px(8), sw, sw, {
        fill: colorOf(scu),
        stroke: th.sheet.boxStroke,
        sw: 0.7,
      });
      var s = scu + " × " + n;
      ops.text(cx + sw + px(5), y + px(19), s, { size: px(11), fill: th.sheet.ink });
      cx += sw + px(5) + s.length * px(6.6) + px(16);
    });
    return cx;
  }

  // 底部横向图例的排版常量。图例按「色块 + 尺寸 + 件数」从左往右排，
  // 一行放不下就自动换到下一行，行数决定图例区的高度。
  var LEG = {
    size: px(13),
    sw: px(13),
    swGap: px(6),
    gap: px(8),
    rowH: px(23),
  };

  /**
   * 先把图例排成行，只算尺寸不画图，供 isoSheet 提前撑高画布。
   * 空网格返回 height 0，调用方据此跳过图例区。
   */
  function bottomLegendLayout(models, x0, maxX) {
    var th = theme();
    var counts = countsOf(models);
    var sizes = LEGEND_ORDER.filter(function (scu) {
      return (counts[scu] || 0) > 0;
    });
    if (!sizes.length) return { rows: [], height: 0 };

    var entries = [{ text: "货箱统计", weight: 700, fill: th.sheet.ink }];
    entries[0].w = textWidth(entries[0].text, LEG.size);
    sizes.forEach(function (scu) {
      var s = scu + " SCU × " + counts[scu];
      entries.push({
        scu: scu,
        text: s,
        fill: th.sheet.ink,
        w: LEG.sw + LEG.swGap + textWidth(s, LEG.size) + px(2),
      });
    });
    var t = totalsOf(models);
    var total = "共 " + t.crates + " 件 · " + t.scu + " SCU";
    entries.push({
      text: total,
      fill: th.sheet.muted,
      w: textWidth(total, LEG.size) + px(2),
    });

    var rows = [[]];
    var cx = x0;
    entries.forEach(function (e) {
      if (rows[rows.length - 1].length && cx + e.w > maxX) {
        rows.push([]);
        cx = x0;
      }
      rows[rows.length - 1].push({ e: e, x: cx });
      cx += e.w + LEG.gap;
    });

    return { rows: rows, height: rows.length * LEG.rowH };
  }

  function drawBottomLegend(ops, layout, x0, y0) {
    var th = theme();
    var baseline = LEG.sw / 2 + LEG.size * 0.36;
    layout.rows.forEach(function (row, i) {
      var ry = y0 + i * LEG.rowH;
      row.forEach(function (it) {
        var e = it.e;
        var tx = it.x;
        if (e.scu) {
          ops.rect(tx, ry, LEG.sw, LEG.sw, {
            fill: colorOf(e.scu),
            stroke: th.sheet.boxStroke,
            sw: 1,
          });
          tx += LEG.sw + LEG.swGap;
        }
        ops.text(tx, ry + baseline, e.text, {
          size: LEG.size,
          weight: e.weight,
          fill: e.fill,
        });
      });
    });
  }

  /**
   * 透明背景时垫在图例后面的圆角底板。
   * 尺寸按图例实际内容算：最右一条的右边缘 + 内边距，最后一行文字底部 + 内边距。
   * 描边颜色跟「货箱统计」标题一致（th.sheet.ink）。
   * 填充和描边拆成两个图元，Canvas 的 globalAlpha 才不会把描边也一起变透明。
   */
  function drawLegendBackdrop(ops, layout, x0, y0) {
    var right = x0;
    layout.rows.forEach(function (row) {
      row.forEach(function (it) {
        right = Math.max(right, it.x + it.e.w);
      });
    });
    var contentH = (layout.rows.length - 1) * LEG.rowH + Math.max(LEG.sw, LEG.size * 1.15);
    var padX = 16;
    var padY = 12;
    var x = x0 - padX;
    var y = y0 - padY;
    var w = right - x0 + padX * 2;
    var h = contentH + padY * 2;
    var radius = 20;
    ops.rect(x, y, w, h, { rx: radius, fill: "#ffffff", opacity: 0.75 });
    ops.rect(x, y, w, h, { rx: radius, stroke: theme().sheet.ink, sw: 3 });
  }

  // ------------------------------------------------------------ 等距图

  function isoPoint(x, y, z) {
    return [(x - y) * COS30, (x + y) * 0.5 - z];
  }

  function isoSheet(models, opts) {
    var th = theme();
    var o = assign(
      {
        width: 1600,
        gap: 2,
        explode: 0,
        pad: 40,
        stats: true,
        transparent: false,
      },
      opts
    );
    var ops = new Ops();
    if (!models.length) return { width: 10, height: 10, ops: ops };

    var offsets = [];
    var cursor = 0;
    models.forEach(function (m) {
      offsets.push(cursor);
      cursor += m.dims[0] + o.gap;
    });

    var minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    function note(x, y, z) {
      var p = isoPoint(x, y, z);
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    models.forEach(function (m, i) {
      var ox = offsets[i];
      var X = m.dims[0],
        Y = m.dims[1],
        Z = m.dims[2];
      var zt = Z + o.explode * Math.max(0, Z - 1);
      [ox, ox + X].forEach(function (x) {
        [0, Y].forEach(function (y) {
          [0, zt].forEach(function (z) {
            note(x, y, z);
          });
        });
      });
    });

    var legend = o.stats ? bottomLegendLayout(models, o.pad, o.width - o.pad) : { height: 0 };
    var legendH = legend.height;
    var legendGap = legendH ? px(14) : 0;
    var scale = (o.width - 2 * o.pad) / Math.max(maxX - minX, 1e-6);
    var bodyH = (maxY - minY) * scale;
    var height = Math.round(bodyH + legendGap + legendH + 2 * o.pad);

    function tx(x, y, z) {
      var p = isoPoint(x, y, z);
      return [o.pad + (p[0] - minX) * scale, o.pad + (p[1] - minY) * scale];
    }

    // 透明背景时不铺底色；地面和格线本身仍是不透明的
    if (!o.transparent) ops.rect(0, 0, o.width, height, { fill: th.sheet.bg });
    if (legendH) {
      var legendY = o.pad + bodyH + legendGap;
      // 透明背景时给图例垫一块圆角底板，否则文字落在透明区域不好读
      if (o.transparent) drawLegendBackdrop(ops, legend, o.pad, legendY);
      drawBottomLegend(ops, legend, o.pad, legendY);
    }

    // 地面 + 格线
    var showGrid = scale * COS30 >= 4;
    models.forEach(function (m, i) {
      var ox = offsets[i];
      var X = m.dims[0],
        Y = m.dims[1];
      ops.poly([tx(ox, 0, 0), tx(ox + X, 0, 0), tx(ox + X, Y, 0), tx(ox, Y, 0)], {
        fill: th.sheet.floor,
        stroke: th.sheet.floorEdge,
        sw: 1,
      });
      if (!showGrid) return;
      for (var gx = 1; gx < X; gx++) {
        var a = tx(ox + gx, 0, 0),
          b = tx(ox + gx, Y, 0);
        ops.line(a[0], a[1], b[0], b[1], { stroke: th.sheet.gridLine, sw: 0.5 });
      }
      for (var gy = 1; gy < Y; gy++) {
        var c = tx(ox, gy, 0),
          d = tx(ox + X, gy, 0);
        ops.line(c[0], c[1], d[0], d[1], { stroke: th.sheet.gridLine, sw: 0.5 });
      }
    });

    // 货箱：从远到近
    var boxes = [];
    models.forEach(function (m, i) {
      var ox = offsets[i];
      m.orderedCrates().forEach(function (c) {
        boxes.push({
          x: c.x + ox,
          y: c.y,
          z: c.z,
          dx: c.w,
          dy: c.l,
          dz: c.h,
          scu: c.scu,
        });
      });
    });
    boxes.sort(function (a, b) {
      var ka = a.x + a.y + a.z + a.z * o.explode,
        kb = b.x + b.y + b.z + b.z * o.explode;
      if (ka !== kb) return ka - kb;
      if (a.x + a.y !== b.x + b.y) return a.x + a.y - (b.x + b.y);
      return a.z - b.z;
    });

    boxes.forEach(function (b) {
      var z0 = b.z + b.z * o.explode;
      var z1 = z0 + b.dz;
      var x1 = b.x + b.dx,
        y1 = b.y + b.dy;
      var base = colorOf(b.scu);
      var top = [tx(b.x, b.y, z1), tx(x1, b.y, z1), tx(x1, y1, z1), tx(b.x, y1, z1)];
      var right = [tx(x1, b.y, z0), tx(x1, y1, z0), tx(x1, y1, z1), tx(x1, b.y, z1)];
      var left = [tx(b.x, y1, z0), tx(x1, y1, z0), tx(x1, y1, z1), tx(b.x, y1, z1)];
      var sw = th.iso.strokeWidth;
      ops.poly(left, {
        fill: hexShade(base, th.iso.leftShade),
        stroke: th.sheet.boxStroke,
        sw: sw,
      });
      ops.poly(right, {
        fill: hexShade(base, th.iso.rightShade),
        stroke: th.sheet.boxStroke,
        sw: sw,
      });
      ops.poly(top, { fill: base, stroke: th.sheet.boxStroke, sw: sw });
    });

    return { width: o.width, height: height, ops: ops };
  }

  // ------------------------------------------------------------ 三视图

  function orthoPanel(ops, crates, view) {
    var th = theme();
    var ox = view.ox,
      oy = view.oy,
      cell = view.cell;
    var w = view.wCells * cell,
      h = view.hCells * cell;
    ops.text(ox, oy - px(5), view.title, { size: px(10), weight: 700, fill: th.sheet.muted });
    ops.rect(ox, oy, w, h, { fill: th.sheet.panel, stroke: th.sheet.floorEdge, sw: 0.8 });
    var g;
    for (g = 1; g < view.wCells; g++) {
      ops.line(ox + g * cell, oy, ox + g * cell, oy + h, {
        stroke: th.sheet.panelGrid,
        sw: 0.5,
      });
    }
    for (g = 1; g < view.hCells; g++) {
      ops.line(ox, oy + g * cell, ox + w, oy + g * cell, {
        stroke: th.sheet.panelGrid,
        sw: 0.5,
      });
    }
    crates.forEach(function (c) {
      var rx, ry, rw, rh;
      if (view.axis === "front") {
        rx = ox + c.x * cell;
        ry = oy + (view.hCells - c.z - c.h) * cell;
        rw = c.w * cell;
        rh = c.h * cell;
      } else if (view.axis === "side") {
        rx = ox + c.y * cell;
        ry = oy + (view.hCells - c.z - c.h) * cell;
        rw = c.l * cell;
        rh = c.h * cell;
      } else {
        rx = ox + c.x * cell;
        ry = oy + c.y * cell;
        rw = c.w * cell;
        rh = c.l * cell;
      }
      ops.rect(rx + 0.4, ry + 0.4, rw - 0.8, rh - 0.8, {
        fill: colorOf(c.scu),
        opacity: 0.9,
        stroke: th.sheet.boxStroke,
        sw: 0.7,
      });
    });
  }

  function orthoSheet(models, opts) {
    var th = theme();
    var o = assign({ cell: 18, pad: 36, labelW: px(210), gap: 34, headerLines: [] }, opts);
    var ops = new Ops();
    if (!models.length) return { width: 10, height: 10, ops: ops };

    var maxRowW = 0;
    var rowHeights = [];
    models.forEach(function (m) {
      var X = m.dims[0],
        Y = m.dims[1],
        Z = m.dims[2];
      maxRowW = Math.max(maxRowW, X * o.cell + o.gap + Y * o.cell + o.gap + X * o.cell);
      rowHeights.push(Math.max(Z, Y) * o.cell + px(30));
    });
    var headerLines = o.headerLines.concat([
      "F = 正视 (X-Z)    S = 侧视 (Y-Z)    T = 俯视 (X-Y)",
      "均为从外侧看的投影，只有最外层可见；内部结构见分层图",
    ]);
    var headerW = 0;
    headerLines.forEach(function (line, i) {
      headerW = Math.max(headerW, textWidth(line, i === 0 ? px(18) : px(12)));
    });
    var width = Math.round(
      Math.max(o.pad * 2 + o.labelW + maxRowW + px(20), headerW + o.pad * 2)
    );
    var top = o.pad + px(26) * headerLines.length + px(16);
    var height = Math.round(
      top +
        rowHeights.reduce(function (a, b) {
          return a + b;
        }, 0) +
        px(70) +
        o.pad
    );

    ops.rect(0, 0, width, height, { fill: th.sheet.bg });
    headerLines.forEach(function (line, i) {
      ops.text(o.pad, px(26) + i * px(24), line, {
        size: i === 0 ? px(18) : px(12),
        weight: i === 0 ? 700 : 400,
        fill: i === 0 ? th.sheet.ink : th.sheet.muted,
      });
    });

    var y = top;
    models.forEach(function (m, i) {
      var crates = m.orderedCrates();
      ops.text(o.pad, y + px(16), m.name, {
        size: px(12),
        weight: 700,
        fill: th.sheet.ink,
      });
      ops.text(o.pad, y + px(31), m.dims.join("×") + " · " + crates.length + " 件", {
        size: px(11),
        fill: th.sheet.muted,
      });
      var x = o.pad + o.labelW;
      // 投影像素是「从外面看」，所以按观察轴排序：近的最后画
      function sorted(axis) {
        return crates.slice().sort(function (a, b) {
          if (axis === "front") return a.y - b.y || a.z - b.z || a.x - b.x;
          if (axis === "side") return a.x - b.x || a.z - b.z || a.y - b.y;
          return a.z - b.z || a.y - b.y || a.x - b.x;
        });
      }
      orthoPanel(ops, sorted("front"), {
        ox: x,
        oy: y,
        cell: o.cell,
        axis: "front",
        wCells: m.dims[0],
        hCells: m.dims[2],
        title: "F",
      });
      x += m.dims[0] * o.cell + o.gap;
      orthoPanel(ops, sorted("side"), {
        ox: x,
        oy: y,
        cell: o.cell,
        axis: "side",
        wCells: m.dims[1],
        hCells: m.dims[2],
        title: "S",
      });
      x += m.dims[1] * o.cell + o.gap;
      orthoPanel(ops, sorted("top"), {
        ox: x,
        oy: y,
        cell: o.cell,
        axis: "top",
        wCells: m.dims[0],
        hCells: m.dims[1],
        title: "T",
      });
      y += rowHeights[i];
    });

    legendOps(ops, models, o.pad, height - px(56));
    return { width: width, height: height, ops: ops };
  }

  // ------------------------------------------------------------ 分层图

  function clauseRow(c) {
    var zs = c.h > 1 ? "z" + c.z + "-" + (c.z + c.h - 1) : "z" + c.z;
    var dims = c.w + "×" + c.h + "×" + c.l;
    return (
      String(c.no).padStart(3) +
      "  " +
      String(c.scu).padStart(2) +
      "  " +
      dims.padEnd(7) +
      "  " +
      zs.padEnd(7) +
      "  (" +
      String(c.x).padStart(2) +
      "," +
      String(c.y).padStart(2) +
      ")  " +
      (c.yaw ? "y" : "-")
    );
  }

  var TABLE_HEADER = "  #  SCU  w×h×l    layer    (x,y)   rot";

  function drawTable(ops, crates, x0, y0, maxW) {
    var th = theme();
    var colW = px(336);
    var fits = Math.max(1, Math.min(4, Math.floor(maxW / colW)));
    // 件数少的时候不要摊成 4 列，按「每列最多 28 行」决定列数
    var cols = Math.max(1, Math.min(fits, Math.ceil(crates.length / 28)));
    var maxRows = 40;
    var lines = crates.slice(0, cols * maxRows);
    var rowH = px(15);
    var rows = Math.ceil(lines.length / cols);
    var left = Math.max(0, crates.length - lines.length);

    ops.text(
      x0,
      y0 + px(10),
      "序号 / SCU / 占格(宽×高×长) / 层 / 左下角坐标 / 是否旋转 (rot=y 表示宽长互换)",
      { size: px(10.5), fill: th.sheet.faint }
    );
    var y = y0 + px(28);
    for (var c = 0; c < cols; c++) {
      var colX = x0 + c * colW;
      ops.text(colX, y, TABLE_HEADER, {
        size: px(11),
        family: "mono",
        weight: 700,
        fill: th.sheet.ink,
      });
      for (var r = 0; r < rows; r++) {
        var idx = c * rows + r;
        if (idx >= lines.length) break;
        ops.text(colX, y + (r + 1) * rowH, clauseRow(lines[idx]), {
          size: px(11),
          family: "mono",
          fill: th.sheet.ink,
        });
      }
    }
    var bottom = y + rows * rowH + px(6);
    if (left > 0) {
      ops.text(x0, bottom, "… 另有 " + left + " 件未列出（件数过多，按上面的分层图摆放）", {
        size: px(10.5),
        fill: th.sheet.faint,
      });
      bottom += px(16);
    }
    return bottom;
  }

  function layersSheet(models, opts) {
    var th = theme();
    var o = assign({ maxWidth: 1600, cellMax: 30, cellMin: 7, pad: 36, headerLines: [] }, opts);
    var ops = new Ops();
    var W = o.maxWidth;
    var y = o.pad;

    o.headerLines.forEach(function (line, i) {
      ops.text(o.pad, y + px(20), line, {
        size: i === 0 ? px(18) : px(12),
        weight: i === 0 ? 700 : 400,
        fill: i === 0 ? th.sheet.ink : th.sheet.muted,
      });
      y += i === 0 ? px(26) : px(20);
    });
    if (o.headerLines.length) y += px(14);

    models.forEach(function (m) {
      var X = m.dims[0],
        Y = m.dims[1],
        Z = m.dims[2];
      var crates = m.orderedCrates();
      var t = totalsOf([m]);
      var pct = t.cap ? Math.round((t.scu / t.cap) * 100) : 0;

      ops.text(o.pad, y + px(16), m.name, { size: px(15), weight: 700, fill: th.sheet.ink });
      ops.text(
        o.pad,
        y + px(34),
        X + "×" + Y + "×" + Z + "  ·  " + t.cap + " SCU  ·  " + crates.length + " 件  ·  " + pct + "%",
        { size: px(11), fill: th.sheet.muted }
      );
      y += px(48);

      var cell = Math.max(o.cellMin, Math.min(o.cellMax, Math.floor(560 / Math.max(X, Y))));
      var pw = X * cell,
        ph = Y * cell;
      var rowH = ph + px(30);
      var gapX = 26;
      var x = o.pad;

      for (var z = 0; z < Z; z++) {
        if (x + pw > W - o.pad) {
          x = o.pad;
          y += rowH;
        }
        var ptop = y + px(16);
        ops.text(x, y + px(11), "z = " + z, { size: px(11), weight: 700, fill: th.sheet.muted });
        ops.rect(x, ptop, pw, ph, {
          fill: th.sheet.panel,
          stroke: th.sheet.floorEdge,
          sw: 0.8,
        });
        for (var gx = 1; gx < X; gx++) {
          ops.line(x + gx * cell, ptop, x + gx * cell, ptop + ph, {
            stroke: th.sheet.panelGrid,
            sw: 0.5,
          });
        }
        for (var gy = 1; gy < Y; gy++) {
          ops.line(x, ptop + gy * cell, x + pw, ptop + gy * cell, {
            stroke: th.sheet.panelGrid,
            sw: 0.5,
          });
        }

        crates.forEach(function (c) {
          if (!(c.z <= z && z < c.z + c.h)) return;
          var rx = x + c.x * cell,
            ry = ptop + c.y * cell;
          var rw = c.w * cell,
            rh = c.l * cell;
          var upper = c.z < z;
          ops.rect(rx + 0.5, ry + 0.5, rw - 1, rh - 1, {
            fill: colorOf(c.scu),
            opacity: upper ? 0.38 : 1,
            stroke: th.sheet.boxStroke,
            sw: 0.7,
            dash: upper ? [3, 2] : null,
          });
          var minSide = Math.min(rw, rh);
          if (minSide >= px(20) && cell >= 12) {
            ops.text(rx + rw / 2, ry + rh / 2 + px(4), String(c.no), {
              size: Math.min(px(12), cell * 0.55),
              fill: inkOn(colorOf(c.scu)),
              anchor: "middle",
              weight: 600,
            });
          }
        });
        x += pw + gapX;
      }
      y += rowH + px(10);

      if (crates.length) {
        y = drawTable(ops, crates, o.pad, y, W - 2 * o.pad);
      } else {
        ops.text(o.pad, y + px(10), "（空）", { size: px(11), fill: th.sheet.faint });
        y += px(20);
      }
      y += px(34);
    });

    var height = Math.round(y + o.pad * 0.4);
    var bg = new Ops();
    bg.rect(0, 0, W, height, { fill: th.sheet.bg });
    bg.items = bg.items.concat(ops.items);
    return { width: W, height: height, ops: bg };
  }

  // ------------------------------------------------------------ 编辑画布

  /**
   * 鼠标位置 → 网格浮点坐标。
   *
   * view 里的 x0 / y0 / cell 是图元坐标（= CSS 像素），而 canvas.width 被设成
   * 「图元宽 × devicePixelRatio」。所以换算只能用「图元宽 / 元素显示宽」，
   * 乘 dpr 会把位置整体放大，越往右下偏得越多（高 DPI 下直接飞出网格）。
   *
   * px / py 是相对画布左上角的 CSS 像素，dw / dh 是元素显示尺寸。
   * 返回的坐标可能为负或越界，由调用方 floor + 判边界。
   */
  function cellAtPoint(view, dw, dh, px, py) {
    if (!view || !dw || !dh) return null;
    return { fx: (px * (view.w / dw) - view.x0) / view.cell, fy: (py * (view.h / dh) - view.y0) / view.cell };
  }

  function editorSheet(model, view) {
    var th = theme();
    var ops = new Ops();
    var W = view.width,
      H = view.height;
    var X = model.dims[0],
      Y = model.dims[1];
    var padL = 24,
      padT = 22,
      padR = 20,
      padB = 22;

    var cell = Math.min(
      (W - padL - padR) / X,
      (H - padT - padB) / Y
    );
    cell = Math.max(4, Math.min(56, cell));
    var gw = X * cell,
      gh = Y * cell;
    var x0 = Math.round(padL + (W - padL - padR - gw) / 2);
    var y0 = Math.round(padT + (H - padT - padB - gh) / 2);

    ops.rect(0, 0, W, H, { fill: th.editor.bg });

    // 悬停格
    if (view.hover && view.hover.x >= 0 && view.hover.x < X && view.hover.y >= 0 && view.hover.y < Y) {
      ops.rect(x0 + view.hover.x * cell, y0 + view.hover.y * cell, cell, cell, {
        fill: th.editor.cellHover,
      });
    }

    ops.rect(x0, y0, gw, gh, { fill: "#ffffff", stroke: th.editor.gridEdge, sw: 1 });

    var crates = model.orderedCrates();
    crates.forEach(function (c) {
      if (!(c.z <= view.layer && view.layer < c.z + c.h)) return;
      var rx = x0 + c.x * cell,
        ry = y0 + c.y * cell;
      var rw = c.w * cell,
        rh = c.l * cell;
      var upper = c.z < view.layer;
      var base = colorOf(c.scu);
      ops.rect(rx + 0.5, ry + 0.5, rw - 1, rh - 1, {
        fill: base,
        opacity: upper ? th.editor.upperFill : 1,
        stroke: upper ? th.editor.gridEdge : th.sheet.boxStroke,
        sw: upper ? 1.2 : 1,
        dash: upper ? [4, 3] : null,
      });
      if (Math.min(rw, rh) >= 22 && cell >= 16) {
        ops.text(rx + rw / 2, ry + rh / 2 + 4, String(c.scu), {
          size: Math.min(px(13), cell * 0.5),
          fill: inkOn(base),
          anchor: "middle",
          weight: 600,
        });
      }
      if (view.selectedId === c.id) {
        ops.rect(rx + 1.5, ry + 1.5, rw - 3, rh - 3, {
          stroke: th.editor.selection,
          sw: 2.5,
        });
      }
    });

    // 格线
    for (var gx = 0; gx <= X; gx++) {
      ops.line(x0 + gx * cell, y0, x0 + gx * cell, y0 + gh, {
        stroke: gx === 0 || gx === X ? th.editor.gridEdge : th.editor.gridLine,
        sw: gx === 0 || gx === X ? 1.2 : 0.8,
      });
    }
    for (var gy = 0; gy <= Y; gy++) {
      ops.line(x0, y0 + gy * cell, x0 + gw, y0 + gy * cell, {
        stroke: gy === 0 || gy === Y ? th.editor.gridEdge : th.editor.gridLine,
        sw: gy === 0 || gy === Y ? 1.2 : 0.8,
      });
    }

    // 坐标刻度（格子够大才画）
    // 坐标刻度（格子够大才画）。这里的字号 / 偏移直接写死：
    // 格子大小是画布 CSS 像素，不跟 FS 走，刻度数字跟着 FS 放大会和格子脱节。
    if (cell >= 22) {
      for (var ix = 0; ix < X; ix++) {
        ops.text(x0 + (ix + 0.5) * cell, y0 - 6, String(ix), {
          size: 14,
          fill: th.editor.ruler,
          anchor: "middle",
          family: "mono",
        });
      }
      for (var iy = 0; iy < Y; iy++) {
        ops.text(x0 - 6, y0 + (iy + 0.5) * cell + 3.5, String(iy), {
          size: 14,
          fill: th.editor.ruler,
          anchor: "end",
          family: "mono",
        });
      }
      ops.text(x0 - 14, y0 - 12, "y↓", { size: 9, fill: th.editor.ruler });
      ops.text(x0 + gw, y0 - 12, "x→", { size: 9, fill: th.editor.ruler, anchor: "end" });
    }

    // 幽灵预览
    if (view.ghost) {
      var g = view.ghost;
      var gx0 = x0 + g.x * cell,
        gy0 = y0 + g.y * cell;
      var col = g.ok ? th.editor.ghostOk : th.editor.ghostBad;
      ops.rect(gx0 + 0.5, gy0 + 0.5, g.w * cell - 1, g.l * cell - 1, {
        fill: col,
        opacity: th.editor.ghostFill,
        stroke: col,
        sw: 2,
        dash: [5, 3],
      });
      if (g.label) {
        ops.text(gx0 + (g.w * cell) / 2, gy0 + (g.l * cell) / 2 + 4, g.label, {
          size: Math.min(px(12), cell * 0.5),
          fill: col,
          anchor: "middle",
          weight: 700,
        });
      }
    }

    return { width: W, height: H, ops: ops, view: { x0: x0, y0: y0, cell: cell, w: W, h: H } };
  }

  global.CGV_RENDER = {
    Ops: Ops,
    toSVG: toSVG,
    paintCanvas: paintCanvas,
    isoSheet: isoSheet,
    orthoSheet: orthoSheet,
    layersSheet: layersSheet,
    editorSheet: editorSheet,
    cellAtPoint: cellAtPoint,
    summaryLine: summaryLine,
    totalsOf: totalsOf,
    countsOf: countsOf,
    colorOf: colorOf,
  };
})(typeof window !== "undefined" ? window : globalThis);
