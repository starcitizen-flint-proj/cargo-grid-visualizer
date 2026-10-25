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
    out.push('<rect width="100%" height="100%" fill="' + bg + '"/>');
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
            (o.size || 12) +
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
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.lineJoin = "round";

    sheet.ops.items.forEach(function (o) {
      ctx.save();
      if (o.opacity != null) ctx.globalAlpha = o.opacity;
      if (o.t === "rect") {
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
          (o.weight || 400) + " " + (o.size || 12) + "px " + (o.family === "mono" ? MONO : SANS);
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
    ops.text(x, y, label || "图例", { size: 12, weight: 700, fill: th.sheet.ink });
    var cx = x;
    LEGEND_ORDER.forEach(function (scu) {
      var n = counts[scu] || 0;
      if (!n) return;
      ops.rect(cx, y + 8, 13, 13, {
        fill: colorOf(scu),
        stroke: th.sheet.boxStroke,
        sw: 0.7,
      });
      var s = scu + " × " + n;
      ops.text(cx + 18, y + 19, s, { size: 11, fill: th.sheet.ink });
      cx += 26 + s.length * 6.6;
    });
    return cx;
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
        headerLines: [],
        legend: true,
        labels: true,
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

    var headerH = o.headerLines.length ? o.headerLines.length * 26 + 10 : 0;
    var legendH = o.legend ? 62 : 0;
    var labelH = o.labels ? 40 : 0;
    var scale = (o.width - 2 * o.pad) / Math.max(maxX - minX, 1e-6);
    var height = Math.round(
      (maxY - minY) * scale + headerH + 2 * o.pad + legendH + labelH
    );

    function tx(x, y, z) {
      var p = isoPoint(x, y, z);
      return [o.pad + (p[0] - minX) * scale, headerH + o.pad + (p[1] - minY) * scale];
    }

    ops.rect(0, 0, o.width, height, { fill: th.sheet.bg });
    o.headerLines.forEach(function (line, i) {
      ops.text(o.pad, 28 + i * 26, line, {
        size: i === 0 ? 18 : 13,
        weight: i === 0 ? 700 : 400,
        fill: i === 0 ? th.sheet.ink : th.sheet.muted,
      });
    });

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

    // 网格标签压在货箱之上，避免被挡住
    if (o.labels) {
      models.forEach(function (m, i) {
        var ox = offsets[i];
        // 取这个网格投影后的包围盒下沿，标签才不会压在箱子上
        var nx0 = Infinity, nx1 = -Infinity, ny1 = -Infinity;
        [ox, ox + m.dims[0]].forEach(function (x) {
          [0, m.dims[1]].forEach(function (y) {
            [0, m.dims[2] + o.explode * Math.max(0, m.dims[2] - 1)].forEach(function (z) {
              var q = tx(x, y, z);
              if (q[0] < nx0) nx0 = q[0];
              if (q[0] > nx1) nx1 = q[0];
              if (q[1] > ny1) ny1 = q[1];
            });
          });
        });
        var p = [(nx0 + nx1) / 2, ny1];
        var label = m.name;
        var sub = m.dims.join("×") + "  ·  " + m.crates.length + " 件";
        var w = Math.max(label.length * 7.2, sub.length * 6.4) + 14;
        ops.rect(p[0] - w / 2, p[1] + 8, w, 32, {
          fill: th.sheet.labelBg,
          opacity: th.sheet.labelBgOpacity,
          rx: 4,
        });
        ops.text(p[0], p[1] + 22, label, {
          size: 12,
          fill: th.sheet.ink,
          anchor: "middle",
        });
        ops.text(p[0], p[1] + 35, sub, {
          size: 11,
          fill: th.sheet.muted,
          anchor: "middle",
        });
      });
    }

    if (o.legend) legendOps(ops, models, o.pad, height - legendH + 14);
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
    ops.text(ox, oy - 5, view.title, { size: 10, weight: 700, fill: th.sheet.muted });
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
    var o = assign({ cell: 18, pad: 36, labelW: 210, gap: 34, headerLines: [] }, opts);
    var ops = new Ops();
    if (!models.length) return { width: 10, height: 10, ops: ops };

    var maxRowW = 0;
    var rowHeights = [];
    models.forEach(function (m) {
      var X = m.dims[0],
        Y = m.dims[1],
        Z = m.dims[2];
      maxRowW = Math.max(maxRowW, X * o.cell + o.gap + Y * o.cell + o.gap + X * o.cell);
      rowHeights.push(Math.max(Z, Y) * o.cell + 30);
    });
    var width = Math.round(o.pad * 2 + o.labelW + maxRowW + 20);

    var headerLines = o.headerLines.concat([
      "F = 正视 (X-Z)    S = 侧视 (Y-Z)    T = 俯视 (X-Y)   —— 均为从外侧看的投影，只有最外层可见，内部结构见分层图",
    ]);
    var top = o.pad + 26 * headerLines.length + 16;
    var height = Math.round(
      top +
        rowHeights.reduce(function (a, b) {
          return a + b;
        }, 0) +
        70 +
        o.pad
    );

    ops.rect(0, 0, width, height, { fill: th.sheet.bg });
    headerLines.forEach(function (line, i) {
      ops.text(o.pad, 26 + i * 24, line, {
        size: i === 0 ? 18 : 12,
        weight: i === 0 ? 700 : 400,
        fill: i === 0 ? th.sheet.ink : th.sheet.muted,
      });
    });

    var y = top;
    models.forEach(function (m, i) {
      var crates = m.orderedCrates();
      ops.text(o.pad, y + 16, m.name, {
        size: 12,
        weight: 700,
        fill: th.sheet.ink,
      });
      ops.text(o.pad, y + 31, m.dims.join("×") + " · " + crates.length + " 件", {
        size: 11,
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

    legendOps(ops, models, o.pad, height - 56);
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
    var colW = 336;
    var fits = Math.max(1, Math.min(4, Math.floor(maxW / colW)));
    // 件数少的时候不要摊成 4 列，按「每列最多 28 行」决定列数
    var cols = Math.max(1, Math.min(fits, Math.ceil(crates.length / 28)));
    var maxRows = 40;
    var lines = crates.slice(0, cols * maxRows);
    var rowH = 15;
    var rows = Math.ceil(lines.length / cols);
    var left = Math.max(0, crates.length - lines.length);

    ops.text(
      x0,
      y0 + 10,
      "序号 / SCU / 占格(宽×高×长) / 层 / 左下角坐标 / 是否旋转 (rot=y 表示宽长互换)",
      { size: 10.5, fill: th.sheet.faint }
    );
    var y = y0 + 28;
    for (var c = 0; c < cols; c++) {
      var colX = x0 + c * colW;
      ops.text(colX, y, TABLE_HEADER, {
        size: 11,
        family: "mono",
        weight: 700,
        fill: th.sheet.ink,
      });
      for (var r = 0; r < rows; r++) {
        var idx = c * rows + r;
        if (idx >= lines.length) break;
        ops.text(colX, y + (r + 1) * rowH, clauseRow(lines[idx]), {
          size: 11,
          family: "mono",
          fill: th.sheet.ink,
        });
      }
    }
    var bottom = y + rows * rowH + 6;
    if (left > 0) {
      ops.text(x0, bottom, "… 另有 " + left + " 件未列出（件数过多，按上面的分层图摆放）", {
        size: 10.5,
        fill: th.sheet.faint,
      });
      bottom += 16;
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
      ops.text(o.pad, y + 20, line, {
        size: i === 0 ? 18 : 12,
        weight: i === 0 ? 700 : 400,
        fill: i === 0 ? th.sheet.ink : th.sheet.muted,
      });
      y += i === 0 ? 26 : 20;
    });
    if (o.headerLines.length) y += 14;

    models.forEach(function (m) {
      var X = m.dims[0],
        Y = m.dims[1],
        Z = m.dims[2];
      var crates = m.orderedCrates();
      var t = totalsOf([m]);
      var pct = t.cap ? Math.round((t.scu / t.cap) * 100) : 0;

      ops.text(o.pad, y + 16, m.name, { size: 15, weight: 700, fill: th.sheet.ink });
      ops.text(o.pad, y + 34, X + "×" + Y + "×" + Z + "  ·  " + t.cap + " SCU  ·  " + crates.length + " 件  ·  " + pct + "%", {
        size: 11,
        fill: th.sheet.muted,
      });
      y += 48;

      var cell = Math.max(o.cellMin, Math.min(o.cellMax, Math.floor(560 / Math.max(X, Y))));
      var pw = X * cell,
        ph = Y * cell;
      var rowH = ph + 30;
      var gapX = 26;
      var x = o.pad;

      for (var z = 0; z < Z; z++) {
        if (x + pw > W - o.pad) {
          x = o.pad;
          y += rowH;
        }
        var ptop = y + 16;
        ops.text(x, y + 11, "z = " + z, { size: 11, weight: 700, fill: th.sheet.muted });
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
          if (minSide >= 20 && cell >= 12) {
            ops.text(rx + rw / 2, ry + rh / 2 + 4, String(c.no), {
              size: Math.min(12, cell * 0.55),
              fill: inkOn(colorOf(c.scu)),
              anchor: "middle",
              weight: 600,
            });
          }
        });
        x += pw + gapX;
      }
      y += rowH + 10;

      if (crates.length) {
        y = drawTable(ops, crates, o.pad, y, W - 2 * o.pad);
      } else {
        ops.text(o.pad, y + 10, "（空）", { size: 11, fill: th.sheet.faint });
        y += 20;
      }
      y += 34;
    });

    var height = Math.round(y + o.pad * 0.4);
    var bg = new Ops();
    bg.rect(0, 0, W, height, { fill: th.sheet.bg });
    bg.items = bg.items.concat(ops.items);
    return { width: W, height: height, ops: bg };
  }

  // ------------------------------------------------------------ 编辑画布

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
          size: Math.min(13, cell * 0.5),
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
    if (cell >= 22) {
      for (var ix = 0; ix < X; ix++) {
        ops.text(x0 + (ix + 0.5) * cell, y0 - 6, String(ix), {
          size: 10,
          fill: th.editor.ruler,
          anchor: "middle",
          family: "mono",
        });
      }
      for (var iy = 0; iy < Y; iy++) {
        ops.text(x0 - 6, y0 + (iy + 0.5) * cell + 3.5, String(iy), {
          size: 10,
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
          size: Math.min(12, cell * 0.5),
          fill: col,
          anchor: "middle",
          weight: 700,
        });
      }
    }

    return { width: W, height: H, ops: ops, view: { x0: x0, y0: y0, cell: cell } };
  }

  global.CGV_RENDER = {
    Ops: Ops,
    toSVG: toSVG,
    paintCanvas: paintCanvas,
    isoSheet: isoSheet,
    orthoSheet: orthoSheet,
    layersSheet: layersSheet,
    editorSheet: editorSheet,
    summaryLine: summaryLine,
    totalsOf: totalsOf,
    countsOf: countsOf,
    colorOf: colorOf,
  };
})(typeof window !== "undefined" ? window : globalThis);
