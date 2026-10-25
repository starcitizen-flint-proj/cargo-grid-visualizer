/* 界面逻辑：网格选择、逐层编辑、统计、导入导出。
 * 无框架、无构建，直接 file:// 打开即可。
 */
(function () {
  "use strict";

  var T = window.CGV_THEME;
  var M = window.CGV;
  var R = window.CGV_RENDER;

  var LS_SESSION = "cgv.v2.session";
  var LS_LAYOUTS = "cgv.v2.layouts";

  var state = {
    ships: [],
    ship: null,
    def: null,
    model: null,
    layer: 0,
    palScu: 32,
    yaw: 0,
    anchor: "center",
    hover: null,
    drag: null,
    selected: null,
    undo: [],
    redo: [],
  };

  var view = null; // 编辑区几何 {x0, y0, cell}
  var saveTimer = 0;
  var rafEditor = 0;

  function el(id) {
    return document.getElementById(id);
  }

  // ---------------------------------------------------------------- 主题

  function applyTheme() {
    var root = document.documentElement;
    Object.keys(T.ui).forEach(function (k) {
      root.style.setProperty("--" + k, T.ui[k]);
    });
  }

  // ---------------------------------------------------------------- 存储

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 隐私模式 / 配额满：静默放弃，导出 JSON 仍然可用 */
    }
  }

  function allLayouts() {
    return readJSON(LS_LAYOUTS, {});
  }

  function saveLayouts() {
    if (!state.def || !state.model) return;
    var all = allLayouts();
    all[state.def.key] = state.model.toJSON();
    writeJSON(LS_LAYOUTS, all);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLayouts, 250);
  }

  function saveSession() {
    writeJSON(LS_SESSION, {
      v: 2,
      ship: state.ship ? state.ship.cls : null,
      gridKey: state.def ? state.def.key : null,
      custom: state.ship ? null : state.def,
      palScu: state.palScu,
      yaw: state.yaw,
      anchor: state.anchor,
      layer: state.layer,
    });
  }

  // ---------------------------------------------------------------- 网格定义

  function defFromPreset(ship, g, i) {
    return {
      key: "p|" + ship.cls + "|" + i + "|" + g.name,
      name: g.name,
      dims: g.dims.slice(),
      max: g.max ? g.max.slice() : null,
      scu: g.scu,
    };
  }

  function applyDef(def) {
    saveLayouts();
    state.def = def;
    state.model = new M.GridModel(def);
    var saved = allLayouts()[def.key];
    if (saved && saved.length) state.model.load(saved);
    if (state.model.allowed.indexOf(state.palScu) < 0) {
      state.palScu = state.model.allowed[0] || 1;
    }
    state.layer = 0;
    state.selected = null;
    state.hover = null;
    state.drag = null;
    state.undo.length = 0;
    state.redo.length = 0;
    saveSession();
    refreshAll();
  }

  function customDef(x, y, z) {
    var dims = [x | 0, y | 0, z | 0];
    return {
      key: "c|" + dims.join("x"),
      name: "自定义 " + dims.join("×"),
      dims: dims,
      max: null,
    };
  }

  // ---------------------------------------------------------------- 启动

  function boot() {
    applyTheme();
    state.ships = Array.isArray(window.SC_SHIPS) ? window.SC_SHIPS : [];
    buildShipOptions();
    bindEvents();

    var session = readJSON(LS_SESSION, null);
    if (!restoreSession(session)) {
      if (state.ships.length) {
        var first = state.ships.findIndex(function (s) {
          return s.grids && s.grids.length;
        });
        selectShip(first < 0 ? 0 : first);
      } else {
        applyDef(customDef(5, 8, 3));
      }
    }
    el("shipCount").textContent = state.ships.length
      ? state.ships.length + " 艘船"
      : "未找到 ships.js";
  }

  function restoreSession(s) {
    if (!s) return false;
    state.palScu = s.palScu || 32;
    state.yaw = s.yaw ? 1 : 0;
    state.anchor = s.anchor || "center";
    if (s.ship) {
      var idx = state.ships.findIndex(function (x) {
        return x.cls === s.ship;
      });
      if (idx >= 0) {
        state.ship = state.ships[idx];
        el("ship").value = String(idx);
        buildGridOptions();
        var g = 0;
        if (s.gridKey) {
          for (var i = 0; i < state.ship.grids.length; i++) {
            if (defFromPreset(state.ship, state.ship.grids[i], i).key === s.gridKey) {
              g = i;
              break;
            }
          }
        }
        el("grid").value = String(g);
        applyDef(defFromPreset(state.ship, state.ship.grids[g], g));
        state.layer = Math.min(s.layer || 0, state.model.dims[2] - 1);
        refreshLayer();
        scheduleEditor();
        return true;
      }
    }
    if (s.custom && s.custom.dims) {
      state.ship = null;
      el("ship").value = "";
      applyDef(s.custom);
      state.layer = Math.min(s.layer || 0, state.model.dims[2] - 1);
      refreshLayer();
      scheduleEditor();
      return true;
    }
    return false;
  }

  function buildShipOptions() {
    var sel = el("ship");
    sel.innerHTML = "";
    sel.appendChild(new Option("— 自定义网格 —", ""));
    state.ships.forEach(function (s, i) {
      var label = s.name + (s.cargo ? "  ·  " + s.cargo + " SCU" : "");
      sel.appendChild(new Option(label, String(i)));
    });
  }

  function buildGridOptions() {
    var sel = el("grid");
    sel.innerHTML = "";
    if (!state.ship || !state.ship.grids.length) {
      sel.appendChild(new Option("（该船没有货舱网格）", ""));
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    state.ship.grids.forEach(function (g, i) {
      sel.appendChild(
        new Option(
          g.name + "  ·  " + g.dims.join("×") + "  ·  " + (g.scu || g.dims[0] * g.dims[1] * g.dims[2]) + " SCU",
          String(i)
        )
      );
    });
  }

  function selectShip(idx) {
    if (idx < 0 || idx >= state.ships.length) return;
    state.ship = state.ships[idx];
    el("ship").value = String(idx);
    buildGridOptions();
    var g = 0;
    // 优先选有布局的网格，方便接着上次摆
    var layouts = allLayouts();
    for (var i = 0; i < state.ship.grids.length; i++) {
      if (layouts[defFromPreset(state.ship, state.ship.grids[i], i).key]) {
        g = i;
        break;
      }
    }
    el("grid").value = String(g);
    applyDef(defFromPreset(state.ship, state.ship.grids[g], g));
  }

  // ---------------------------------------------------------------- 刷新

  function refreshAll() {
    refreshMeta();
    refreshLayer();
    refreshPalette();
    refreshStats();
    refreshUndoButtons();
    scheduleEditor();
    drawPreview();
  }

  function refreshMeta() {
    var m = state.model;
    if (!m) return;
    var X = m.dims[0],
      Y = m.dims[1],
      Z = m.dims[2];
    el("gridMeta").textContent =
      X + "×" + Y + "×" + Z + " = " + m.capacity() + " SCU";
    el("gridMeta").title = m.max
      ? "单件上限 " + m.max.join("×") + " 格"
      : "单件上限：无限制";
    el("maxNote").textContent = m.max ? "单件上限 " + m.max.join("×") + " 格" : "";
  }

  function refreshLayer() {
    var Z = state.model ? state.model.dims[2] : 1;
    var range = el("layerRange");
    range.max = String(Math.max(0, Z - 1));
    range.value = String(Math.min(state.layer, Z - 1));
    var per = state.model.perLayer();
    var occ = per[state.layer] || 0;
    var plane = state.model.dims[0] * state.model.dims[1];
    el("layerLabel").innerHTML =
      "z = <b>" + state.layer + "</b> / " + (Z - 1) +
      ' <span class="dim">本层 ' + occ + "/" + plane + " 格</span>";
  }

  function refreshPalette() {
    var box = el("palette");
    var m = state.model;
    var counts = m.counts();
    box.innerHTML = "";
    M.BOXES.forEach(function (b, i) {
      var allowed = m.allowed.indexOf(b.scu) >= 0;
      var f = M.foot(b, state.yaw);
      var btn = document.createElement("button");
      btn.className = "pal";
      btn.dataset.scu = String(b.scu);
      btn.disabled = !allowed;
      if (b.scu === state.palScu) btn.classList.add("active");
      btn.style.setProperty("--c", R.colorOf(b.scu));
      btn.title =
        b.scu +
        " SCU · " +
        f.w +
        "×" +
        f.l +
        "×" +
        f.h +
        " 格（宽×高×长）" +
        (allowed ? "" : " — 该网格放不下或被单件上限禁止") +
        " · 快捷键 " +
        (i + 1);
      btn.innerHTML =
        '<span class="sw"></span>' +
        '<span class="nm">' + b.scu + " SCU</span>" +
        '<span class="dim">' + f.w + "×" + f.h + "×" + f.l + "</span>" +
        '<span class="cnt">' + (counts[b.scu] ? "已放 " + counts[b.scu] : "") + "</span>";
      btn.addEventListener("click", function () {
        state.palScu = b.scu;
        refreshPalette();
        scheduleEditor();
      });
      box.appendChild(btn);
    });
    el("yawTag").textContent = state.yaw ? "已旋转 90°" : "未旋转";
    Array.prototype.forEach.call(document.querySelectorAll("[data-anchor]"), function (b) {
      b.classList.toggle("active", b.dataset.anchor === state.anchor);
    });
  }

  function refreshStats() {
    var m = state.model;
    var filled = m.filled(),
      cap = m.capacity();
    var pct = cap ? Math.round((filled / cap) * 100) : 0;
    el("statFill").textContent = filled + " / " + cap + " SCU";
    el("statPct").textContent = pct + "%";
    el("statBar").style.width = pct + "%";
    el("statCrates").textContent =
      m.crates.length + " 件 / " + (cap - filled) + " 格空位";
    var counts = m.counts();
    var parts = [];
    M.BOXES.forEach(function (b) {
      if (counts[b.scu]) parts.push(b.scu + "×" + counts[b.scu]);
    });
    el("statSize").textContent = parts.length ? parts.join("  ") : "—";
  }

  // ---------------------------------------------------------------- 绘制

  function scheduleEditor() {
    if (rafEditor) return;
    rafEditor = requestAnimationFrame(function () {
      rafEditor = 0;
      drawEditor();
    });
  }

  function ghostFor() {
    if (state.drag && state.drag.moved && state.drag.target) {
      var cr = state.model.byId[state.drag.id];
      var ft = M.foot(M.box(cr.scu), cr.yaw);
      return {
        x: state.drag.target.x,
        y: state.drag.target.y,
        w: ft.w,
        l: ft.l,
        ok: state.drag.target.ok,
        label: String(cr.scu),
      };
    }
    if (!state.hover || !state.model) return null;
    var p = anchorPos(state.hover.x, state.hover.y);
    var res = state.model.canPlace(state.palScu, p.x, p.y, p.z, state.yaw, 0);
    return {
      x: p.x,
      y: p.y,
      w: p.f.w,
      l: p.f.l,
      ok: res.ok,
      label: String(state.palScu),
    };
  }

  function drawEditor() {
    var wrap = el("editorWrap");
    var w = Math.max(200, wrap.clientWidth);
    var h = Math.max(180, wrap.clientHeight);
    var sheet = R.editorSheet(state.model, {
      width: w,
      height: h,
      layer: state.layer,
      hover: state.hover,
      ghost: ghostFor(),
      selectedId: state.selected,
    });
    view = sheet.view;
    R.paintCanvas(el("editor"), sheet, T.editor.bg, window.devicePixelRatio || 1);
    updateCursorLine();
  }

  function drawPreview() {
    var wrap = el("previewWrap");
    var w = Math.max(200, wrap.clientWidth);
    var sheet = R.isoSheet([state.model], {
      width: w,
      pad: 14,
      gap: 0,
      stats: false, // 预览太小，统计卡片会挤掉模型
    });
    R.paintCanvas(el("preview"), sheet, T.sheet.bg, window.devicePixelRatio || 1);
  }

  function updateCursorLine() {
    var line = el("cursorLine");
    if (state.drag && state.drag.moved && state.drag.target) {
      var t = state.drag.target;
      line.textContent = "移动中 → (" + t.x + ", " + t.y + ") " + (t.ok ? "可放" : "冲突");
      return;
    }
    if (!state.hover) {
      line.textContent = "左键放置 · 右键删除 · R 旋转 · 滚轮切层";
      return;
    }
    var p = anchorPos(state.hover.x, state.hover.y);
    var res = state.model.canPlace(state.palScu, p.x, p.y, p.z, state.yaw, 0);
    var extra = p.z !== state.layer ? " · 自动下移到 z=" + p.z : "";
    line.textContent =
      "(" + state.hover.x + ", " + state.hover.y + ")  " +
      state.palScu + " SCU  " + p.f.w + "×" + p.f.h + "×" + p.f.l +
      " → (" + p.x + ", " + p.y + ", " + p.z + ")  " +
      (res.ok ? "可放" : res.why) + extra;
  }

  // ---------------------------------------------------------------- 摆放

  function anchorPos(cx, cy) {
    var b = M.box(state.palScu);
    var f = M.foot(b, state.yaw);
    var x = state.anchor === "corner" ? cx : cx - Math.floor((f.w - 1) / 2);
    var y = state.anchor === "corner" ? cy : cy - Math.floor((f.l - 1) / 2);
    var z = Math.min(state.layer, state.model.dims[2] - f.h);
    return { x: x, y: y, z: z, f: f };
  }

  function cellFromEvent(ev) {
    if (!view) return null;
    var rect = el("editor").getBoundingClientRect();
    var q = R.cellAtPoint(view, rect.width, rect.height, ev.clientX - rect.left, ev.clientY - rect.top);
    if (!q) return null;
    var cx = Math.floor(q.fx);
    var cy = Math.floor(q.fy);
    if (cx < 0 || cy < 0 || cx >= state.model.dims[0] || cy >= state.model.dims[1]) return null;
    return { x: cx, y: cy };
  }

  function placeAt(cx, cy) {
    var p = anchorPos(cx, cy);
    var res = state.model.canPlace(state.palScu, p.x, p.y, p.z, state.yaw, 0);
    if (!res.ok) {
      toast(res.why);
      return;
    }
    pushUndo();
    var out = state.model.add(state.palScu, p.x, p.y, p.z, state.yaw);
    if (out.ok) state.selected = out.crate.id;
    afterChange();
  }

  function pushUndo() {
    state.undo.push(JSON.stringify(state.model.toJSON()));
    if (state.undo.length > 80) state.undo.shift();
    state.redo.length = 0;
    refreshUndoButtons();
  }

  function doUndo() {
    if (!state.undo.length) return;
    state.redo.push(JSON.stringify(state.model.toJSON()));
    state.model.load(JSON.parse(state.undo.pop()));
    state.selected = null;
    refreshUndoButtons();
    afterChange();
  }

  function doRedo() {
    if (!state.redo.length) return;
    state.undo.push(JSON.stringify(state.model.toJSON()));
    state.model.load(JSON.parse(state.redo.pop()));
    state.selected = null;
    refreshUndoButtons();
    afterChange();
  }

  function refreshUndoButtons() {
    el("btnUndo").disabled = !state.undo.length;
    el("btnRedo").disabled = !state.redo.length;
  }

  function afterChange() {
    scheduleSave();
    saveSession();
    refreshLayer();
    refreshPalette();
    refreshStats();
    scheduleEditor();
    drawPreview();
  }

  // ---------------------------------------------------------------- 事件

  function bindEvents() {
    el("ship").addEventListener("change", function () {
      if (!this.value) {
        state.ship = null;
        applyDef(customDef(5, 8, 3));
        return;
      }
      selectShip(Number(this.value));
    });

    el("grid").addEventListener("change", function () {
      if (!state.ship || !this.value) return;
      var i = Number(this.value);
      applyDef(defFromPreset(state.ship, state.ship.grids[i], i));
    });

    el("useCustom").addEventListener("click", function () {
      var x = clampInt(el("cx").value, 1, 200, 5);
      var y = clampInt(el("cy").value, 1, 200, 8);
      var z = clampInt(el("cz").value, 1, 200, 3);
      el("cx").value = x;
      el("cy").value = y;
      el("cz").value = z;
      state.ship = null;
      el("ship").value = "";
      el("grid").innerHTML = "";
      el("grid").disabled = true;
      applyDef(customDef(x, y, z));
    });

    el("layerRange").addEventListener("input", function () {
      state.layer = Number(this.value);
      refreshLayer();
      scheduleEditor();
    });

    document.querySelectorAll("[data-anchor]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.anchor = b.dataset.anchor;
        refreshPalette();
        scheduleEditor();
        saveSession();
      });
    });

    el("btnUndo").addEventListener("click", doUndo);
    el("btnRedo").addEventListener("click", doRedo);
    el("btnClear").addEventListener("click", function () {
      if (!state.model.crates.length) return;
      if (!confirm("清空当前网格的 " + state.model.crates.length + " 件货物？")) return;
      pushUndo();
      state.model.clear();
      state.selected = null;
      afterChange();
    });

    bindEditor();
    bindExport();
    bindKeys();

    var ro = new ResizeObserver(function () {
      scheduleEditor();
      drawPreview();
    });
    ro.observe(el("editorWrap"));
    ro.observe(el("previewWrap"));
  }

  function bindEditor() {
    var canvas = el("editor");

    canvas.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      var c = cellFromEvent(ev);
      if (!c) return;
      var hit = state.model.findAt(c.x, c.y, state.layer);
      if (hit) {
        state.selected = hit.id;
        state.drag = { id: hit.id, ox: c.x - hit.x, oy: c.y - hit.y, moved: false, target: null };
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* 忽略 */
        }
        scheduleEditor();
      } else {
        placeAt(c.x, c.y);
      }
    });

    canvas.addEventListener("pointermove", function (ev) {
      var c = cellFromEvent(ev);
      var changed = !sameCell(c, state.hover);
      state.hover = c;
      if (state.drag && c) {
        var tx = c.x - state.drag.ox;
        var ty = c.y - state.drag.oy;
        var cr = state.model.byId[state.drag.id];
        if (cr) {
          var res = state.model.canPlace(cr.scu, tx, ty, cr.z, cr.yaw, cr.id);
          var moved = tx !== cr.x || ty !== cr.y;
          if (!state.drag.moved && moved) state.drag.moved = true;
          state.drag.target = { x: tx, y: ty, ok: res.ok };
          changed = true;
        }
      }
      if (changed) scheduleEditor();
    });

    canvas.addEventListener("pointerup", function (ev) {
      if (!state.drag) return;
      var drag = state.drag;
      state.drag = null;
      if (drag.moved && drag.target && drag.target.ok) {
        pushUndo();
        state.model.moveTo(drag.id, drag.target.x, drag.target.y, state.model.byId[drag.id].z);
        afterChange();
      } else {
        scheduleEditor();
      }
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch (e) {
        /* 忽略 */
      }
    });

    canvas.addEventListener("pointerleave", function () {
      if (state.drag) return;
      state.hover = null;
      scheduleEditor();
    });

    canvas.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      var c = cellFromEvent(ev);
      if (!c) return;
      var hit = state.model.findAt(c.x, c.y, state.layer);
      if (!hit) return;
      pushUndo();
      state.model.remove(hit.id);
      if (state.selected === hit.id) state.selected = null;
      afterChange();
    });

    canvas.addEventListener(
      "wheel",
      function (ev) {
        ev.preventDefault();
        var Z = state.model.dims[2];
        var next = state.layer + (ev.deltaY > 0 ? 1 : -1);
        state.layer = Math.max(0, Math.min(Z - 1, next));
        refreshLayer();
        scheduleEditor();
      },
      { passive: false }
    );
  }

  function sameCell(a, b) {
    if (!a || !b) return a === b;
    return a.x === b.x && a.y === b.y;
  }

  function bindKeys() {
    window.addEventListener("keydown", function (ev) {
      var tag = (ev.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;

      var meta = ev.ctrlKey || ev.metaKey;
      if (meta && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        if (ev.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (meta && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        doRedo();
        return;
      }
      if (meta) return;

      if (ev.key >= "1" && ev.key <= "7") {
        var scu = [32, 24, 16, 8, 4, 2, 1][Number(ev.key) - 1];
        if (state.model.allowed.indexOf(scu) >= 0) {
          state.palScu = scu;
          refreshPalette();
          scheduleEditor();
        }
        return;
      }
      if (ev.key === "r" || ev.key === "R") {
        if (state.selected && state.model.byId[state.selected]) {
          pushUndo();
          var res = state.model.rotate(state.selected);
          if (!res.ok) toast(res.why);
          afterChange();
        } else {
          state.yaw = state.yaw ? 0 : 1;
          refreshPalette();
          scheduleEditor();
        }
        return;
      }
      if (ev.key === "Delete" || ev.key === "Backspace") {
        if (state.selected && state.model.byId[state.selected]) {
          pushUndo();
          state.model.remove(state.selected);
          state.selected = null;
          afterChange();
        }
        return;
      }
      if (ev.key === "Escape") {
        state.selected = null;
        scheduleEditor();
        return;
      }
      if (ev.key === "[" || ev.key === "]") {
        var Z = state.model.dims[2];
        state.layer = Math.max(0, Math.min(Z - 1, state.layer + (ev.key === "]" ? 1 : -1)));
        refreshLayer();
        scheduleEditor();
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        if (!state.selected || !state.model.byId[state.selected]) return;
        ev.preventDefault();
        var cr = state.model.byId[state.selected];
        var dx = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
        var dy = ev.key === "ArrowUp" ? -1 : ev.key === "ArrowDown" ? 1 : 0;
        if (state.model.canPlace(cr.scu, cr.x + dx, cr.y + dy, cr.z, cr.yaw, cr.id).ok) {
          pushUndo();
          state.model.moveTo(cr.id, cr.x + dx, cr.y + dy, cr.z);
          afterChange();
        }
      }
    });
  }

  // ---------------------------------------------------------------- 导出

  function slug(s) {
    return String(s)
      .replace(/[^\w\u4e00-\u9fa5.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "grid";
  }

  function shipModels() {
    if (!state.ship) return [state.model];
    saveLayouts();
    var layouts = allLayouts();
    return state.ship.grids.map(function (g, i) {
      var def = defFromPreset(state.ship, g, i);
      var m = new M.GridModel(def);
      m.load(layouts[def.key] || []);
      return m;
    });
  }

  function sheetFor(kind, scope) {
    var models = scope === "ship" ? shipModels() : [state.model];
    var title =
      scope === "ship"
        ? state.ship
          ? state.ship.name + " · 全部货舱"
          : state.model.name
        : state.model.name;
    var headerLines = [title, R.summaryLine(models)];
    // 等距图只保留左上角的货箱统计，不画标题 / 网格名 / 图例
    if (kind === "iso") return R.isoSheet(models, { width: 1600 });
    if (kind === "ortho") return R.orthoSheet(models, { headerLines: headerLines });
    headerLines.push(
      "按 z 从下往上逐层摆放；淡色虚线 = 下层箱子的上半截，这一层不能再放东西。编号对应的坐标见下方清单。"
    );
    return R.layersSheet(models, { maxWidth: 1600, headerLines: headerLines });
  }

  function baseName(kind, scope) {
    var who =
      scope === "ship" && state.ship ? state.ship.name : state.model.name;
    return slug(who) + "_" + kind;
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 5000);
  }

  function exportPNG(kind, scope) {
    var sheet = sheetFor(kind, scope);
    var scale = 2;
    while (sheet.width * scale * sheet.height * scale > 110e6 && scale > 1) scale -= 0.5;
    var canvas = document.createElement("canvas");
    R.paintCanvas(canvas, sheet, T.sheet.bg, scale);
    canvas.toBlob(function (blob) {
      if (blob) download(blob, baseName(kind, scope) + ".png");
      else toast("PNG 生成失败，试试导出 SVG");
    }, "image/png");
    toast("已导出 " + sheet.width + "×" + sheet.height + " @" + scale + "x");
  }

  function exportSVG(kind, scope) {
    var sheet = sheetFor(kind, scope);
    var svg = R.toSVG(sheet, T.sheet.bg);
    download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), baseName(kind, scope) + ".svg");
    toast("已导出 SVG");
  }

  function exportJSON() {
    var data = {
      v: 1,
      name: state.model.name,
      dims: state.model.dims,
      max: state.model.max,
      crates: state.model.toJSON(),
    };
    var text = JSON.stringify(data, null, 2);
    download(new Blob([text], { type: "application/json" }), slug(state.model.name) + ".json");
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.dims) || data.dims.length !== 3) {
          throw new Error("缺少 dims 字段");
        }
        var dims = data.dims.map(function (v) {
          return Math.max(1, Math.round(Number(v)));
        });
        var def = {
          key: "c|" + dims.join("x"),
          name: data.name || "导入的网格",
          dims: dims,
          max: M.normalizeMax(data.max),
        };
        state.ship = null;
        el("ship").value = "";
        el("grid").innerHTML = "";
        el("grid").disabled = true;
        applyDef(def);
        state.model.load(data.crates || []);
        afterChange();
        toast("已导入 " + state.model.crates.length + " 件");
      } catch (e) {
        toast("导入失败：" + e.message);
      }
    };
    reader.readAsText(file);
  }

  function bindExport() {
    el("btnPNG").addEventListener("click", function () {
      exportPNG(el("expKind").value, el("expScope").value);
    });
    el("btnSVG").addEventListener("click", function () {
      exportSVG(el("expKind").value, el("expScope").value);
    });
    el("btnJSON").addEventListener("click", exportJSON);
    el("fileJSON").addEventListener("change", function () {
      if (this.files && this.files[0]) importJSON(this.files[0]);
      this.value = "";
    });
  }

  // ---------------------------------------------------------------- 杂项

  function toast(msg) {
    var t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      t.classList.remove("show");
    }, 2200);
  }

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
