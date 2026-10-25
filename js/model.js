/* 数据模型：货箱规格、网格、占用判定、撤销用的序列化。
 *
 * 约定（与 docs/sc-cargo-grids.md 一致）：
 *   - 1 格 = 1.25 m = 1 SCU，Z 轴朝上
 *   - 货箱只绕竖直轴旋转 90°（宽长互换，高不变）
 *   - 不做支撑校验，网格体积内任意空位都能放
 *   - 货箱坐标是它的最小角：(x, y, z) 占 [x, x+w) × [y, y+l) × [z, z+h)
 */
(function (global) {
  "use strict";

  var CELL_M = 1.25;

  // 游戏内 7 种货箱，尺寸以格计（宽 w / 高 h / 长 l）
  var BOXES = [
    { scu: 32, w: 2, h: 2, l: 8 },
    { scu: 24, w: 2, h: 2, l: 6 },
    { scu: 16, w: 2, h: 2, l: 4 },
    { scu: 8, w: 2, h: 2, l: 2 },
    { scu: 4, w: 2, h: 1, l: 2 },
    { scu: 2, w: 1, h: 1, l: 2 },
    { scu: 1, w: 1, h: 1, l: 1 },
  ];

  var BY_SCU = {};
  BOXES.forEach(function (b) {
    BY_SCU[b.scu] = b;
  });

  function box(scu) {
    return BY_SCU[scu] || null;
  }

  /** 实际占格：yaw 只交换宽与长，高度不变。 */
  function foot(b, yaw) {
    return yaw ? { w: b.l, l: b.w, h: b.h } : { w: b.w, l: b.l, h: b.h };
  }

  function cellsFromMetres(m) {
    var v = Number(m);
    if (!isFinite(v) || v <= 0) return 0;
    return Math.max(0, Math.round(v / CELL_M));
  }

  /** 0×0×0 与 1.25³ 都是「未设置」哨兵值，统一折成 null。 */
  function normalizeMax(dims) {
    if (!dims || dims.length !== 3) return null;
    var d = dims.map(function (v) {
      return Math.max(0, Math.round(Number(v) || 0));
    });
    var sorted = d.slice().sort(function (a, b) {
      return a - b;
    });
    if (sorted[0] <= 0 || (sorted[0] === 1 && sorted[1] === 1 && sorted[2] === 1)) return null;
    return d;
  }

  /**
   * 单件上限比较。该字段的轴序在容器之间不一致，所以按排序后的三维比较，
   * 即「存在某种轴分配能放下」；真正摆放仍然只允许 yaw。
   */
  function fitsMax(scu, maxDims) {
    var b = box(scu);
    if (!b) return false;
    if (!maxDims) return true;
    var limit = maxDims.slice().sort(function (a, c) {
      return a - c;
    });
    var piece = [b.w, b.h, b.l].sort(function (a, c) {
      return a - c;
    });
    for (var i = 0; i < 3; i++) if (piece[i] > limit[i]) return false;
    return true;
  }

  /** 这个网格允许哪些箱型（既要不超单件上限，也要几何放得下）。 */
  function allowedScu(dims, maxDims) {
    var X = dims[0],
      Y = dims[1],
      Z = dims[2];
    return BOXES.filter(function (b) {
      if (!fitsMax(b.scu, maxDims)) return false;
      for (var yaw = 0; yaw < 2; yaw++) {
        var f = foot(b, yaw);
        if (f.w <= X && f.l <= Y && f.h <= Z) return true;
      }
      return false;
    }).map(function (b) {
      return b.scu;
    });
  }

  // ------------------------------------------------------------------ 模型

  function GridModel(def) {
    this.name = def.name || "网格";
    this.dims = [def.dims[0] | 0, def.dims[1] | 0, def.dims[2] | 0];
    this.max = def.max && def.max.length === 3 ? def.max.map(Number) : null;
    this.allowed = allowedScu(this.dims, this.max);

    this.crates = []; // {id, scu, x, y, z, yaw}
    this.byId = {};
    this.occ = new Int32Array(this.dims[0] * this.dims[1] * this.dims[2]);
    this.nextId = 1;
  }

  GridModel.prototype.idx = function (x, y, z) {
    return x + this.dims[0] * (y + this.dims[1] * z);
  };

  GridModel.prototype.capacity = function () {
    return this.dims[0] * this.dims[1] * this.dims[2];
  };

  GridModel.prototype._fill = function (cr, value) {
    var b = box(cr.scu);
    var f = foot(b, cr.yaw);
    for (var z = cr.z; z < cr.z + f.h; z++)
      for (var y = cr.y; y < cr.y + f.l; y++)
        for (var x = cr.x; x < cr.x + f.w; x++) this.occ[this.idx(x, y, z)] = value;
  };

  /** 能不能放。ignoreId 用于「移动自己」时忽略自身占格。 */
  GridModel.prototype.canPlace = function (scu, x, y, z, yaw, ignoreId) {
    var b = box(scu);
    if (!b) return { ok: false, why: "未知箱型" };
    if (this.allowed.indexOf(scu) < 0) return { ok: false, why: "该网格不允许 " + scu + " SCU" };
    var f = foot(b, yaw);
    if (x < 0 || y < 0 || z < 0) return { ok: false, why: "超出网格" };
    if (x + f.w > this.dims[0] || y + f.l > this.dims[1] || z + f.h > this.dims[2])
      return { ok: false, why: "超出网格" };
    for (var zz = z; zz < z + f.h; zz++)
      for (var yy = y; yy < y + f.l; yy++)
        for (var xx = x; xx < x + f.w; xx++) {
          var v = this.occ[this.idx(xx, yy, zz)];
          if (v && v !== ignoreId) return { ok: false, why: "与已有货箱重叠" };
        }
    return { ok: true };
  };

  GridModel.prototype.add = function (scu, x, y, z, yaw) {
    var res = this.canPlace(scu, x, y, z, yaw ? 1 : 0, 0);
    if (!res.ok) return res;
    var cr = { id: this.nextId++, scu: scu, x: x, y: y, z: z, yaw: yaw ? 1 : 0 };
    this.crates.push(cr);
    this.byId[cr.id] = cr;
    this._fill(cr, cr.id);
    return { ok: true, crate: cr };
  };

  GridModel.prototype.remove = function (id) {
    var cr = this.byId[id];
    if (!cr) return false;
    this._fill(cr, 0);
    delete this.byId[id];
    var i = this.crates.indexOf(cr);
    if (i >= 0) this.crates.splice(i, 1);
    return true;
  };

  GridModel.prototype.moveTo = function (id, x, y, z) {
    var cr = this.byId[id];
    if (!cr) return { ok: false, why: "货箱不存在" };
    var old = { x: cr.x, y: cr.y, z: cr.z };
    this._fill(cr, 0);
    var res = this.canPlace(cr.scu, x, y, z, cr.yaw, 0);
    if (!res.ok) {
      this._fill({ scu: cr.scu, x: old.x, y: old.y, z: old.z, yaw: cr.yaw }, cr.id);
      return res;
    }
    cr.x = x;
    cr.y = y;
    cr.z = z;
    this._fill(cr, cr.id);
    return { ok: true };
  };

  /** 转向：先试保持最小角，再试保持中心，都不行就放弃。 */
  GridModel.prototype.rotate = function (id) {
    var cr = this.byId[id];
    if (!cr) return { ok: false, why: "货箱不存在" };
    var yaw = cr.yaw ? 0 : 1;
    var b = box(cr.scu);
    if (b.w === b.l) return { ok: false, why: "这个箱型转不转一样" };
    var from = foot(b, cr.yaw);
    var to = foot(b, yaw);
    var dx = Math.floor((from.w - to.w) / 2);
    var dy = Math.floor((from.l - to.l) / 2);
    var tries = [
      [cr.x, cr.y],
      [cr.x + dx, cr.y + dy],
      [cr.x - dx, cr.y - dy],
    ];
    for (var i = 0; i < tries.length; i++) {
      var tx = tries[i][0],
        ty = tries[i][1];
      this._fill(cr, 0);
      if (this.canPlace(cr.scu, tx, ty, cr.z, yaw, 0).ok) {
        cr.x = tx;
        cr.y = ty;
        cr.yaw = yaw;
        this._fill(cr, cr.id);
        return { ok: true };
      }
      this._fill(cr, cr.id);
    }
    return { ok: false, why: "这里转不开" };
  };

  GridModel.prototype.clear = function () {
    this.crates = [];
    this.byId = {};
    this.occ.fill(0);
  };

  GridModel.prototype.findAt = function (x, y, z) {
    var d = this.dims;
    if (x < 0 || y < 0 || z < 0 || x >= d[0] || y >= d[1] || z >= d[2]) return null;
    var id = this.occ[this.idx(x, y, z)];
    return id ? this.byId[id] || null : null;
  };

  GridModel.prototype.filled = function () {
    var n = 0;
    for (var i = 0; i < this.occ.length; i++) if (this.occ[i]) n++;
    return n;
  };

  GridModel.prototype.counts = function () {
    var out = {};
    for (var i = 0; i < this.crates.length; i++) {
      var s = this.crates[i].scu;
      out[s] = (out[s] || 0) + 1;
    }
    return out;
  };

  /** 每层占格数，用于界面上的层指示。 */
  GridModel.prototype.perLayer = function () {
    var X = this.dims[0],
      Y = this.dims[1],
      Z = this.dims[2],
      plane = X * Y;
    var out = [];
    for (var z = 0; z < Z; z++) {
      var n = 0;
      for (var i = z * plane; i < (z + 1) * plane; i++) if (this.occ[i]) n++;
      out.push(n);
    }
    return out;
  };

  /** 按 层 → y → x → 大箱优先 排序，并补上序号与占格尺寸。 */
  GridModel.prototype.orderedCrates = function () {
    return this.crates
      .slice()
      .sort(function (a, b) {
        return a.z - b.z || a.y - b.y || a.x - b.x || b.scu - a.scu;
      })
      .map(function (c, i) {
        var f = foot(box(c.scu), c.yaw);
        return {
          no: i + 1,
          id: c.id,
          scu: c.scu,
          x: c.x,
          y: c.y,
          z: c.z,
          yaw: c.yaw,
          w: f.w,
          l: f.l,
          h: f.h,
        };
      });
  };

  GridModel.prototype.toJSON = function () {
    return this.crates.map(function (c) {
      return { scu: c.scu, x: c.x, y: c.y, z: c.z, yaw: c.yaw };
    });
  };

  /** 从 JSON 恢复。非法条目直接跳过而不是抛错，避免坏存档打不开。 */
  GridModel.prototype.load = function (list) {
    this.clear();
    this.nextId = 1;
    for (var i = 0; i < (list || []).length; i++) {
      var c = list[i];
      if (!c) continue;
      this.add(c.scu, c.x, c.y, c.z, c.yaw ? 1 : 0);
    }
    return this;
  };

  global.CGV = {
    CELL_M: CELL_M,
    BOXES: BOXES,
    box: box,
    foot: foot,
    cellsFromMetres: cellsFromMetres,
    normalizeMax: normalizeMax,
    fitsMax: fitsMax,
    allowedScu: allowedScu,
    GridModel: GridModel,
  };
})(typeof window !== "undefined" ? window : globalThis);
