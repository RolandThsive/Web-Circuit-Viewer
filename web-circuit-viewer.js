/*!
 * Web-Circuit-Viewer - a very small web viewer for KiCad PCB (.kicad_pcb) and schematic (.kicad_sch) files.
 * Copyright (C) 2026 RolandThsive (RO'H'BOTS). Licensed under the GNU GPL v3 or later, like KiCad itself
 * (see LICENSE). One file, no libraries. Draws on a <canvas>: zoom, pan, layer switches and part names on
 * hover. Text is drawn with KiCad's own stroke font (newstroke.js, next to this file).
 *
 * Use:
 *   <script src="https://RolandThsive.github.io/Web-Circuit-Viewer/web-circuit-viewer.js"></script>
 *   <web-circuit-viewer src="board.kicad_pcb" style="display:block;height:500px"></web-circuit-viewer>
 * or from a script:
 *   var v = WebCircuitViewer.mount(element, "board.kicad_sch", { frame, font, onLoad, onError, onLayers });
 *   v.load(url)  v.loadText(text, name)  v.fit()  v.flip()  v.focus("U2")  v.zoom(1.4)  v.setLayer("B.Cu", false)
 *   v.info()  v.render({ width, height, view, background, frame }) -> canvas   v.toBlob(canvas, type, quality)   v.destroy()
 */
(function () {
  "use strict";
  if (window.WebCircuitViewer) return;

  /* ================================================================== S-expression reader */
  // "(a b (c "d e") 1.5)"  ->  ["a", "b", ["c", "d e"], "1.5"]   (strings and words both become JS strings)
  function parse(src) {
    var i = 0, n = src.length, stack = [], cur = [], root = cur;
    while (i < n) {
      var c = src.charCodeAt(i);
      if (c === 40) { var a = []; cur.push(a); stack.push(cur); cur = a; i++; }
      else if (c === 41) { cur = stack.pop() || root; i++; }
      else if (c <= 32) i++;
      else if (c === 34) {
        var j = i + 1, s = "";
        for (;;) {
          var q = src.indexOf('"', j), b = src.indexOf("\\", j);
          if (q < 0) { s += src.slice(j); j = n; break; }
          if (b >= 0 && b < q) { s += src.slice(j, b); var e = src[b + 1]; s += e === "n" ? "\n" : e; j = b + 2; continue; }
          s += src.slice(j, q); j = q + 1; break;
        }
        cur.push(s); i = j;
      } else {
        var k = i;
        while (k < n) { var d = src.charCodeAt(k); if (d <= 32 || d === 40 || d === 41) break; k++; }
        cur.push(src.slice(i, k)); i = k;
      }
    }
    return root[0];
  }
  function all(node, name) { var o = []; if (node) for (var i = 1; i < node.length; i++) if (Array.isArray(node[i]) && node[i][0] === name) o.push(node[i]); return o; }
  function one(node, name) { if (node) for (var i = 1; i < node.length; i++) if (Array.isArray(node[i]) && node[i][0] === name) return node[i]; return null; }
  function num(v, d) { var f = parseFloat(v); return isNaN(f) ? (d || 0) : f; }
  function xy(node, name) { var a = one(node, name); return a ? [num(a[1]), num(a[2]), num(a[3])] : null; }
  function flag(node, name) {          // "hide" as a bare word or (hide yes)
    if (!node) return false;
    for (var i = 1; i < node.length; i++) {
      if (node[i] === name) return true;
      if (Array.isArray(node[i]) && node[i][0] === name) return node[i][1] !== "no";
    }
    return false;
  }
  function pts(node) { var p = one(node, "pts"), o = []; if (p) all(p, "xy").forEach(function (q) { o.push([num(q[1]), num(q[2])]); }); return o; }
  function strokeW(node, d) { var s = one(node, "stroke"), w = s ? one(s, "width") : one(node, "width"); var v = w ? num(w[1]) : 0; return v > 0 ? v : d; }
  function strokeColor(node) {
    var s = one(node, "stroke"), c = s && one(s, "color");
    if (!c) return null; var r = num(c[1]), g = num(c[2]), b = num(c[3]), a = num(c[4]);
    return (r || g || b || a) ? "rgba(" + r + "," + g + "," + b + "," + (a || 1) + ")" : null;
  }
  function rot(x, y, deg) {             // KiCad turns counter-clockwise on screen (y points down)
    if (!deg) return [x, y];
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [x * c + y * s, -x * s + y * c];
  }
  function arc3(a, m, b) {              // circle through start, mid, end -> centre, radius, angles, direction
    var ax = a[0], ay = a[1], bx = m[0], by = m[1], cx = b[0], cy = b[1];
    var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return null;
    var ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    var uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    var a0 = Math.atan2(ay - uy, ax - ux), a1 = Math.atan2(cy - uy, cx - ux), am = Math.atan2(by - uy, bx - ux);
    var ccw = ((am - a0 + 4 * Math.PI) % (2 * Math.PI)) > ((a1 - a0 + 4 * Math.PI) % (2 * Math.PI));
    return { x: ux, y: uy, r: Math.hypot(ax - ux, ay - uy), a0: a0, a1: a1, ccw: ccw };
  }
  function cleanText(s) { return String(s || "").replace(/~\{([^}]*)\}/g, "$1").replace(/[_^]\{([^}]*)\}/g, "$1"); }

  /* ================================================================== colours (KiCad's default look) */
  var PCB_COL = {
    bg: "#001023", "F.Cu": "#c83434", "B.Cu": "#4d7fc4", "In1.Cu": "#7fc87f", "In2.Cu": "#ce7d2c", "In3.Cu": "#4fcbcb", "In4.Cu": "#db628b",
    "F.SilkS": "#f2eda1", "B.SilkS": "#e8b2a7", "Edge.Cuts": "#d0d2cd", "F.Fab": "#afafaf", "B.Fab": "#585d84",
    "F.CrtYd": "#ff26e2", "B.CrtYd": "#26e9ff", "F.Mask": "rgba(216,100,255,.45)", "B.Mask": "rgba(2,255,238,.45)",
    "F.Paste": "rgba(180,160,154,.9)", "B.Paste": "rgba(0,194,194,.9)", "Dwgs.User": "#c2c2c2", "Cmts.User": "#5994dc",
    "Margin": "#ff26e2", pad: "#e3b72e", via: "#ececec", hole: "#1d1d1d", user: "#c2c2c2", frame: "#b04cb0", hover: "#ffffff"
  };
  var SCH_COL = {
    bg: "#f5f4ef", wire: "#009600", bus: "#0000c8", junction: "#009600", noconnect: "#0000c8", body: "#840000", bodyFill: "#ffffc2",
    pin: "#840000", pinName: "#006464", pinNum: "#a90000", ref: "#006464", value: "#006464", field: "#840084",
    label: "#000000", glabel: "#840000", hlabel: "#725600", note: "#0000c2", sheet: "#840000", sheetFill: "rgba(255,255,255,.6)",
    frame: "#840000", hover: "rgba(0,100,200,.18)"
  };
  // layers shown when a board opens (the others can be switched on)
  var PCB_DEFAULT_ON = /\.Cu$|SilkS|Silkscreen|Edge\.Cuts/;
  var PAPER = { A5: [210, 148], A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], A: [279.4, 215.9], B: [431.8, 279.4], C: [558.8, 431.8], D: [863.6, 558.8], E: [1117.6, 863.6] };

  /* ================================================================== display list
     Everything is turned into simple items in millimetres:  {k:"line"|"poly"|"circle"|"arc"|"text"|"pad"|...} */
  function lineItem(a, b, w, col, layer) { return { k: "line", a: a, b: b, w: w, c: col, L: layer }; }

  /* -------------------------------------------------------------- PCB */
  function buildPcb(root) {
    var items = [], parts = [], layersUsed = {}, edge = [];
    function use(L) { layersUsed[L] = 1; return L; }
    function colOf(L) { return PCB_COL[L] || (/\.Cu$/.test(L) ? PCB_COL["In1.Cu"] : PCB_COL.user); }
    function graphic(g, T, owner) {
      var t = g[0].replace(/^(gr|fp)_/, ""), L = (one(g, "layer") || [])[1];
      if (!L) return;
      var w = strokeW(g, 0.1), c = colOf(L), fill = one(g, "fill"), filled = fill && (fill[1] === "solid" || fill[1] === "yes" || (one(fill, "type") || [])[1] === "solid");
      use(L);
      var out;
      if (t === "line") out = lineItem(T(xy(g, "start")), T(xy(g, "end")), w, c, L);
      else if (t === "rect") {
        var s = xy(g, "start"), e = xy(g, "end");
        out = { k: "poly", p: [T([s[0], s[1]]), T([e[0], s[1]]), T([e[0], e[1]]), T([s[0], e[1]])], w: w, c: c, fill: filled, L: L };
      } else if (t === "circle") {
        var cc = T(xy(g, "center")), ee = T(xy(g, "end"));
        out = { k: "circle", x: cc[0], y: cc[1], r: Math.hypot(ee[0] - cc[0], ee[1] - cc[1]), w: w, c: c, fill: filled, L: L };
      } else if (t === "arc") {
        var A = arc3(T(xy(g, "start")), T(xy(g, "mid")), T(xy(g, "end")));
        if (A) { A.k = "arc"; A.w = w; A.c = c; A.L = L; out = A; }
      } else if (t === "poly") {
        out = { k: "poly", p: pts(g).map(T), w: w, c: c, fill: filled || !fill, L: L };
      } else if (t === "curve") {
        out = { k: "bezier", p: pts(g).map(T), w: w, c: c, L: L };
      }
      if (out) { items.push(out); if (L === "Edge.Cuts") edge.push(out); if (owner) owner.items.push(out); }
    }
    function textItem(g, s, T, angle, L, owner) {
      if (!L || flag(g, "hide")) return;
      var eff = one(g, "effects");
      if (eff && flag(eff, "hide")) return;
      var font = eff && one(eff, "font"), size = font && one(font, "size"), h = size ? num(size[1], 1) : 1;
      var thick = font && one(font, "thickness"), j = eff && one(eff, "justify"), at = xy(g, "at");
      var p = T([at[0], at[1]]);
      use(L);
      var it = { k: "text", x: p[0], y: p[1], s: cleanText(s), h: h, w: size ? num(size[2], h) : h, t: thick ? num(thick[1]) : 0,
        bold: thick && num(thick[1]) > h * 0.17, i: !!(font && flag(font, "italic")), a: angle,
        jx: j && j.indexOf("left") > 0 ? "left" : j && j.indexOf("right") > 0 ? "right" : "center",
        jy: j && j.indexOf("top") > 0 ? "top" : j && j.indexOf("bottom") > 0 ? "bottom" : "middle",
        mirror: !!(j && j.indexOf("mirror") > 0), c: colOf(L), L: L };   // KiCad: only the mirror flag mirrors, not the layer
      items.push(it); if (owner) owner.items.push(it);
    }
    function padLayers(list) {      // "*.Cu", "F&B.Cu" ... -> real layer names on this board
      var o = [];
      list.forEach(function (L) {
        if (L.indexOf("*") === 0 || L.indexOf("F&B") === 0) {
          var suf = L.replace(/^\*|^F&B/, "");
          Object.keys(boardLayers).forEach(function (bl) { if (bl.slice(-suf.length) === suf && (L[0] === "*" || /^[FB]\./.test(bl))) o.push(bl); });
        } else o.push(L);
      });
      return o;
    }
    var boardLayers = {};
    var lay = one(root, "layers");
    if (lay) for (var i = 1; i < lay.length; i++) if (Array.isArray(lay[i])) boardLayers[lay[i][1]] = lay[i][2];

    root.slice(1).forEach(function (g) {
      if (!Array.isArray(g)) return;
      var t = g[0];
      if (/^gr_(line|rect|circle|arc|poly|curve)$/.test(t)) graphic(g, function (p) { return [p[0], p[1]]; });
      else if (t === "gr_text") { var at = xy(g, "at"); textItem(g, g[1], function (p) { return p; }, at[2], (one(g, "layer") || [])[1]); }
      else if (t === "segment") {
        var L = (one(g, "layer") || [])[1]; use(L);
        items.push(lineItem(xy(g, "start"), xy(g, "end"), num((one(g, "width") || [])[1], 0.2), colOf(L), L));
      } else if (t === "arc") {
        var L2 = (one(g, "layer") || [])[1], A = arc3(xy(g, "start"), xy(g, "mid"), xy(g, "end")); use(L2);
        if (A) { A.k = "arc"; A.w = num((one(g, "width") || [])[1], 0.2); A.c = colOf(L2); A.L = L2; items.push(A); }
      } else if (t === "via") {
        var at2 = xy(g, "at");
        items.push({ k: "via", x: at2[0], y: at2[1], r: num((one(g, "size") || [])[1], 0.6) / 2, d: num((one(g, "drill") || [])[1], 0.3) / 2, L: "Vias" });
        use("Vias");
      } else if (t === "zone") {
        all(g, "filled_polygon").forEach(function (fp) {
          var L3 = (one(fp, "layer") || [])[1]; use(L3);
          items.push({ k: "poly", p: pts(fp), w: 0, c: colOf(L3), fill: true, zone: true, L: L3 });
        });
      } else if (t === "footprint" || t === "module") {
        var fat = xy(g, "at") || [0, 0, 0], fa = fat[2] || 0;
        var T = function (p) { var r = rot(p[0], p[1], fa); return [fat[0] + r[0], fat[1] + r[1]]; };
        var part = { ref: "", val: "", items: [], side: (one(g, "layer") || [])[1] };
        all(g, "property").forEach(function (pr) {
          if (pr[1] === "Reference") part.ref = pr[2]; if (pr[1] === "Value") part.val = pr[2];
          var a = xy(pr, "at"); if (a) textItem(pr, pr[2], T, a[2] || 0, (one(pr, "layer") || [])[1], part);
        });
        all(g, "fp_text").forEach(function (tx) {
          if (tx[1] === "reference") part.ref = part.ref || tx[2]; if (tx[1] === "value") part.val = part.val || tx[2];
          var a = xy(tx, "at"); textItem(tx, tx[2], T, a[2] || 0, (one(tx, "layer") || [])[1], part);
        });
        g.slice(1).forEach(function (c) { if (Array.isArray(c) && /^fp_(line|rect|circle|arc|poly|curve)$/.test(c[0])) graphic(c, T, part); });
        all(g, "pad").forEach(function (pd) {
          var pat = xy(pd, "at"), pos = T([pat[0], pat[1]]), sz = one(pd, "size"), dr = one(pd, "drill");
          var p = { k: "pad", x: pos[0], y: pos[1], a: pat[2] || 0, w: num(sz && sz[1], 1), h: num(sz && sz[2], 1), shape: pd[3], type: pd[2],
            rr: num((one(pd, "roundrect_rratio") || [])[1], 0.25), drill: 0, dw: 0, dh: 0 };
          if (dr) { var ov = dr[1] === "oval"; p.dw = num(dr[ov ? 2 : 1]); p.dh = ov ? num(dr[3], p.dw) : p.dw; p.drill = p.dw; }
          if (p.shape === "custom") {
            var prim = one(pd, "primitives");
            p.prim = [];
            if (prim) prim.slice(1).forEach(function (q) {
              if (!Array.isArray(q)) return;
              var local = function (v) { var r = rot(v[0], v[1], p.a); return [p.x + r[0], p.y + r[1]]; };
              if (q[0] === "gr_poly") p.prim.push({ k: "poly", p: pts(q).map(local), w: strokeW(q, 0) });
              else if (q[0] === "gr_circle") { var cc = local(xy(q, "center")), ee = local(xy(q, "end")); p.prim.push({ k: "circle", x: cc[0], y: cc[1], r: Math.hypot(ee[0] - cc[0], ee[1] - cc[1]) }); }
              else if (q[0] === "gr_rect") { var s = xy(q, "start"), e = xy(q, "end"); p.prim.push({ k: "poly", p: [[s[0], s[1]], [e[0], s[1]], [e[0], e[1]], [s[0], e[1]]].map(local), w: 0 }); }
              else if (q[0] === "gr_line") p.prim.push({ k: "line", a: local(xy(q, "start")), b: local(xy(q, "end")), w: strokeW(q, 0.1) });
            });
          }
          var Ls = padLayers((one(pd, "layers") || []).slice(1));
          var cu = Ls.filter(function (L) { return /\.Cu$/.test(L); });
          p.th = p.type === "thru_hole";
          cu.forEach(function (L) { use(L); var q = Object.assign({}, p, { L: L, c: p.th ? PCB_COL.pad : colOf(L) }); items.push(q); part.items.push(q); });
          if (!cu.length && p.drill) { var q2 = Object.assign({}, p, { L: "Edge.Cuts", c: PCB_COL.hole, holeOnly: true }); items.push(q2); }
          Ls.filter(function (L) { return /Mask|Paste/.test(L); }).forEach(function (L) { use(L); items.push(Object.assign({}, p, { L: L, c: colOf(L), drill: 0 })); });
        });
        parts.push(part);
      }
    });
    // drawing order: zones under tracks; back copper first, front copper on top; silkscreen and outline last
    function rank(it) {
      var L = it.L || "";
      if (L === "B.Cu") return 10 + (it.zone ? 0 : 1);
      if (/^In\d+\.Cu$/.test(L)) return 20 + (it.zone ? 0 : 1);
      if (L === "F.Cu") return 30 + (it.zone ? 0 : 1);
      if (/Mask/.test(L)) return 5;
      if (/Paste/.test(L)) return 34;
      if (L === "Vias") return 36;
      if (/^B\./.test(L)) return 37;
      if (/^F\./.test(L)) return 40;
      if (L === "Edge.Cuts") return 50;
      return 45;
    }
    items.sort(function (a, b) { return rank(a) - rank(b); });
    // seen from the back the sides swap: back copper and silkscreen on top
    function flipRank(it) { var L = it.L || ""; return rank(Object.assign({}, it, { L: /^F\./.test(L) ? "B" + L.slice(1) : /^B\./.test(L) ? "F" + L.slice(1) : L })); }
    var itemsBack = items.slice().sort(function (a, b) { return flipRank(a) - flipRank(b); });
    var bb = boxOf(edge.length ? edge : items);
    parts.forEach(function (p) { p.box = boxOf(p.items.filter(function (i) { return i.k !== "text"; })); });
    // the board's shape: the Edge.Cuts drawings chained into closed loops (for the see-through posters)
    function arcPts(A) {
      var n = Math.max(8, Math.ceil(Math.abs(sweep(A)) * A.r / 0.5)), out = [], d = sweep(A);
      for (var i = 0; i <= n; i++) { var a = A.a0 + d * i / n; out.push([A.x + A.r * Math.cos(a), A.y + A.r * Math.sin(a)]); }
      return out;
    }
    function sweep(A) { var d = A.a1 - A.a0; if (A.ccw) { while (d > 0) d -= 2 * Math.PI; } else { while (d < 0) d += 2 * Math.PI; } return d; }
    var loops = [], pieces = [], openChains = 0;
    edge.forEach(function (it) {
      if (it.k === "circle") { var c = []; for (var i = 0; i < 72; i++) c.push([it.x + it.r * Math.cos(i * Math.PI / 36), it.y + it.r * Math.sin(i * Math.PI / 36)]); loops.push(c); }
      else if (it.k === "poly") loops.push(it.p.slice());
      else if (it.k === "line") pieces.push([it.a, it.b]);
      else if (it.k === "arc") pieces.push(arcPts(it));
      else if (it.k === "bezier" && it.p.length === 4) { var q = []; for (var t = 0; t <= 16; t++) { var u = t / 16, v = 1 - u, P = it.p; q.push([v*v*v*P[0][0]+3*v*v*u*P[1][0]+3*v*u*u*P[2][0]+u*u*u*P[3][0], v*v*v*P[0][1]+3*v*v*u*P[1][1]+3*v*u*u*P[2][1]+u*u*u*P[3][1]]); } pieces.push(q); }
    });
    var near = function (a, b) { return Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02; };
    while (pieces.length) {
      var chain = pieces.shift(), grew = true;
      while (grew && !near(chain[0], chain[chain.length - 1])) {
        grew = false;
        for (var i = 0; i < pieces.length; i++) {
          var pc = pieces[i], end = chain[chain.length - 1];
          if (near(pc[0], end)) { chain = chain.concat(pc.slice(1)); pieces.splice(i, 1); grew = true; break; }
          if (near(pc[pc.length - 1], end)) { chain = chain.concat(pc.slice(0, -1).reverse()); pieces.splice(i, 1); grew = true; break; }
        }
      }
      if (chain.length > 2 && near(chain[0], chain[chain.length - 1])) loops.push(chain); else openChains++;
    }
    // fit to the real board shape: boxOf() counts an arc as its whole circle, which on boards whose edge is
    // made of partial arcs gives a box far bigger than the board, off to one side. The loops above follow the
    // arcs' true path, so when every edge piece closed into a loop, their points give the exact extent.
    if (loops.length && !openChains) {
      var ob = [Infinity, Infinity, -Infinity, -Infinity];
      loops.forEach(function (lp) { lp.forEach(function (q) {
        if (q[0] < ob[0]) ob[0] = q[0]; if (q[1] < ob[1]) ob[1] = q[1]; if (q[0] > ob[2]) ob[2] = q[0]; if (q[1] > ob[3]) ob[3] = q[1];
      }); });
      bb = ob;
    }
    var order = Object.keys(layersUsed).sort(function (a, b) { return layerSort(a) - layerSort(b); });
    return { kind: "pcb", items: items, itemsBack: itemsBack, parts: parts, box: bb, layers: order, paper: paperOf(root), title: one(root, "title_block"), outline: loops };
  }
  function layerSort(L) {
    var o = ["F.Cu", "In1.Cu", "In2.Cu", "In3.Cu", "In4.Cu", "B.Cu", "Vias", "F.SilkS", "B.SilkS", "Edge.Cuts", "F.Mask", "B.Mask", "F.Paste", "B.Paste", "F.Fab", "B.Fab", "F.CrtYd", "B.CrtYd"];
    var i = o.indexOf(L); return i < 0 ? 100 : i;
  }

  /* -------------------------------------------------------------- schematic */
  function buildSch(root) {
    var items = [], parts = [], libs = {};
    var ls = one(root, "lib_symbols");
    if (ls) all(ls, "symbol").forEach(function (s) { libs[s[1]] = s; });
    function textAt(s, x, y, h, angle, jx, jy, col, bold, italic) { items.push({ k: "text", x: x, y: y, s: cleanText(s), h: h, a: angle, jx: jx, jy: jy, c: col, bold: bold, i: italic }); }
    function effects(node) {
      var eff = one(node, "effects"), font = eff && one(eff, "font"), size = font && one(font, "size"), j = eff && one(eff, "justify");
      return { h: size ? num(size[1], 1.27) : 1.27, hide: flag(node, "hide") || (eff && flag(eff, "hide")),
        jx: j && j.indexOf("left") > 0 ? "left" : j && j.indexOf("right") > 0 ? "right" : "center",
        jy: j && j.indexOf("top") > 0 ? "top" : j && j.indexOf("bottom") > 0 ? "bottom" : "middle", bold: font && flag(font, "bold"), italic: font && flag(font, "italic") };
    }
    // readable text: 180 becomes 0 and 270 becomes 90, and the alignment flips with it
    function upright(angle, jx, jy) {
      var a = ((Math.round(angle) % 360) + 360) % 360;
      // KiCad stores the alignment already flipped for 180/270, so only the angle changes here
      if (a === 180 || a === 270) a -= 180;
      return [a, jx, jy];
    }
    // a field's angle is kept in the symbol's own frame: turn its reading direction with the symbol,
    // then draw it horizontal or reading upward, flipping left/right when the direction reversed
    function fieldOrient(stored, symAng, mir, jx) {
      var r = stored * Math.PI / 180, d = [Math.cos(r), -Math.sin(r)];
      d = rot(d[0], d[1], symAng);
      if (mir === "x") d[1] = -d[1]; if (mir === "y") d[0] = -d[0];
      var horiz = Math.abs(d[0]) >= Math.abs(d[1]), back = horiz ? d[0] < 0 : d[1] > 0;
      if (back) jx = jx === "left" ? "right" : jx === "right" ? "left" : jx;
      return [horiz ? 0 : 90, jx];
    }
    function libOf(id) {
      var s = libs[id];
      if (!s) return null;
      var ext = one(s, "extends");
      if (ext) { var base = Object.keys(libs).filter(function (k) { return k.split(":").pop() === ext[1]; })[0]; if (base) return { sym: libs[base], name: base.split(":").pop(), self: s }; }
      return { sym: s, name: id.split(":").pop(), self: s };
    }

    root.slice(1).forEach(function (g) {
      if (!Array.isArray(g)) return;
      var t = g[0];
      if (t === "wire" || t === "bus") {
        var p = pts(g), col = strokeColor(g) || (t === "bus" ? SCH_COL.bus : SCH_COL.wire), w = strokeW(g, t === "bus" ? 0.3 : 0.1524);
        for (var i = 1; i < p.length; i++) items.push(lineItem(p[i - 1], p[i], w, col));
      } else if (t === "polyline") {
        var pp = pts(g); items.push({ k: "poly", p: pp, w: strokeW(g, 0.1524), c: strokeColor(g) || SCH_COL.note, open: true });
      } else if (t === "junction") {
        var a = xy(g, "at"), dia = num((one(g, "diameter") || [])[1], 0); items.push({ k: "circle", x: a[0], y: a[1], r: (dia || 0.9144) / 2, c: SCH_COL.junction, fill: true, w: 0 });
      } else if (t === "no_connect") {
        var b = xy(g, "at"), s = 0.635;
        items.push(lineItem([b[0] - s, b[1] - s], [b[0] + s, b[1] + s], 0.1524, SCH_COL.noconnect));
        items.push(lineItem([b[0] - s, b[1] + s], [b[0] + s, b[1] - s], 0.1524, SCH_COL.noconnect));
      } else if (t === "bus_entry") {
        var c = xy(g, "at"), sz = xy(g, "size"); items.push(lineItem([c[0], c[1]], [c[0] + sz[0], c[1] + sz[1]], 0.1524, SCH_COL.wire));
      } else if (t === "label" || t === "global_label" || t === "hierarchical_label") {
        var at = xy(g, "at"), e = effects(g), u = upright(at[2] || 0, e.jx === "center" ? "left" : e.jx, e.jy === "middle" ? "bottom" : e.jy);
        var col2 = t === "label" ? SCH_COL.label : t === "global_label" ? SCH_COL.glabel : SCH_COL.hlabel;
        if (t === "label") textAt(g[1], at[0], at[1] - 0.25, e.h, u[0], u[1], "bottom", col2);
        else {
          // a box around the text, with a point on the connection side
          var txt = cleanText(g[1]), wlen = txt.length * e.h * 0.62 + e.h * 0.9, hh = e.h * 0.75, ang = at[2] || 0;
          var dir = (ang === 0) ? 1 : (ang === 180 ? -1 : 0), vert = ang === 90 || ang === 270;
          var sign = (ang === 0 || ang === 270) ? 1 : -1;
          var P = function (dx, dy) { return vert ? [at[0] + dy, at[1] - dx * (ang === 90 ? 1 : -1)] : [at[0] + dx * (dir || 1), at[1] + dy]; };
          items.push({ k: "poly", p: [P(0, 0), P(hh, -hh), P(wlen, -hh), P(wlen, hh), P(hh, hh)], w: 0.1524, c: col2, closed: true });
          var mid = P(hh * 0.9 + (wlen - hh) / 2, 0), u2 = upright(vert ? 90 : 0, "center", "middle");
          textAt(txt, mid[0], mid[1], e.h, u2[0], "center", "middle", col2);
          void sign;
        }
      } else if (t === "text") {
        var at3 = xy(g, "at"), e3 = effects(g), u3 = upright(at3[2] || 0, e3.jx === "center" ? "left" : e3.jx, e3.jy === "middle" ? "bottom" : e3.jy);
        String(g[1]).split("\n").forEach(function (line, k) {
          var off = rot(0, k * e3.h * 1.6, u3[0]);
          textAt(line, at3[0] + off[0], at3[1] + off[1], e3.h, u3[0], u3[1], u3[2], SCH_COL.note, e3.bold, e3.italic);
        });
      } else if (t === "rectangle" || t === "text_box") {
        var s2 = xy(g, "start") || xy(g, "at"), e4 = xy(g, "end") || (s2 && xy(g, "size") ? [s2[0] + xy(g, "size")[0], s2[1] + xy(g, "size")[1]] : null);
        if (s2 && e4) items.push({ k: "poly", p: [[s2[0], s2[1]], [e4[0], s2[1]], [e4[0], e4[1]], [s2[0], e4[1]]], w: strokeW(g, 0.1524), c: strokeColor(g) || SCH_COL.note, closed: true });
        if (t === "text_box") { var e5 = effects(g); textAt(g[1], s2[0] + 0.8, s2[1] + 0.8, e5.h, 0, "left", "top", SCH_COL.note); }
      } else if (t === "sheet") {
        var sa = xy(g, "at"), ss = xy(g, "size");
        items.push({ k: "poly", p: [[sa[0], sa[1]], [sa[0] + ss[0], sa[1]], [sa[0] + ss[0], sa[1] + ss[1]], [sa[0], sa[1] + ss[1]]], w: 0.3, c: SCH_COL.sheet, fill: SCH_COL.sheetFill, closed: true });
        all(g, "property").forEach(function (pr) { var pa = xy(pr, "at"), pe = effects(pr); if (!pe.hide) textAt(pr[2], pa[0], pa[1], pe.h, pa[2] || 0, "left", "bottom", SCH_COL.sheet); });
      } else if (t === "symbol") symbol(g);
    });

    function symbol(g) {
      var id = (one(g, "lib_name") || one(g, "lib_id") || [])[1], L = libOf(id);
      var at = xy(g, "at") || [0, 0, 0], ang = at[2] || 0, mir = (one(g, "mirror") || [])[1];
      var unit = num((one(g, "unit") || [])[1], 1), body = num((one(g, "body_style") || one(g, "convert") || [])[1], 1);
      // symbol drawings are y-up: flip, mirror, turn, then move into place
      var T = function (p) {
        var x = p[0], y = -p[1];
        var r = rot(x, y, ang); x = r[0]; y = r[1];
        if (mir === "x") y = -y; if (mir === "y") x = -x;
        return [at[0] + x, at[1] + y];
      };
      var part = { ref: "", val: "", items: [] };
      var start = items.length;
      if (L) {
        var sym = L.sym, pnHide = false, pnOff = 0.508, numHide = false, pnn = one(sym, "pin_names"), pnu = one(sym, "pin_numbers");
        if (pnn) { pnHide = flag(pnn, "hide"); var off = one(pnn, "offset"); if (off) pnOff = num(off[1]); }
        if (pnu) numHide = flag(pnu, "hide");
        all(sym, "symbol").forEach(function (sub) {
          var m = /_(\d+)_(\d+)$/.exec(sub[1]), su = m ? +m[1] : 0, sb = m ? +m[2] : 0;
          if ((su && su !== unit) || (sb && sb !== body)) return;
          sub.slice(1).forEach(function (q) {
            if (!Array.isArray(q)) return;
            var w = strokeW(q, 0.1524), fill = one(q, "fill"), ft = fill ? ((one(fill, "type") || [])[1] || fill[1]) : "none";
            var fc = ft === "background" ? SCH_COL.bodyFill : ft === "outline" ? SCH_COL.body : null;
            if (q[0] === "rectangle") {
              var s = xy(q, "start"), e = xy(q, "end");
              items.push({ k: "poly", p: [[s[0], s[1]], [e[0], s[1]], [e[0], e[1]], [s[0], e[1]]].map(T), w: w, c: SCH_COL.body, fill: fc, closed: true });
            } else if (q[0] === "polyline") {
              var p = pts(q).map(T); items.push({ k: "poly", p: p, w: w, c: SCH_COL.body, fill: fc, open: !fc });
            } else if (q[0] === "circle") {
              var c = T(xy(q, "center")); items.push({ k: "circle", x: c[0], y: c[1], r: num((one(q, "radius") || [])[1], 1), w: w, c: SCH_COL.body, fill: fc });
            } else if (q[0] === "arc" && one(q, "mid")) {
              var A = arc3(T(xy(q, "start")), T(xy(q, "mid")), T(xy(q, "end"))); if (A) { A.k = "arc"; A.w = w; A.c = SCH_COL.body; items.push(A); }
            } else if (q[0] === "bezier") {
              items.push({ k: "bezier", p: pts(q).map(T), w: w, c: SCH_COL.body });
            } else if (q[0] === "text") {
              var ta = xy(q, "at"), te = effects(q), tp = T([ta[0], ta[1]]), tu = fieldOrient(ta[2] || 0, ang, mir, te.jx);
              if (!te.hide) textAt(q[1], tp[0], tp[1], te.h, tu[0], tu[1], te.jy, SCH_COL.body);
            } else if (q[0] === "pin") pin(q, T, pnHide, pnOff, numHide);
          });
        });
      }
      all(g, "property").forEach(function (pr) {
        if (pr[1] === "Reference") part.ref = pr[2]; if (pr[1] === "Value") part.val = pr[2];
        var e = effects(pr), pa = xy(pr, "at");
        if (e.hide || !pa || /^#/.test(pr[2])) return;
        var u = fieldOrient(pa[2] || 0, ang, mir, e.jx);
        textAt(pr[2], pa[0], pa[1], e.h, u[0], u[1], e.jy, pr[1] === "Reference" ? SCH_COL.ref : pr[1] === "Value" ? SCH_COL.value : SCH_COL.field, e.bold, e.italic);
      });
      part.items = items.slice(start);
      part.box = boxOf(part.items.filter(function (i) { return i.k !== "text"; }));
      if (part.box) parts.push(part);

      function pin(q, T, nameHide, nameOff, numHideAll) {
        if (flag(q, "hide")) return;
        var pa = xy(q, "at"), len = num((one(q, "length") || [])[1], 2.54), pang = pa[2] || 0;
        var d = [Math.cos(pang * Math.PI / 180), Math.sin(pang * Math.PI / 180)];   // lib space (y up)
        var a = T([pa[0], pa[1]]), b = T([pa[0] + d[0] * len, pa[1] + d[1] * len]);
        items.push(lineItem(a, b, 0.1524, SCH_COL.pin));
        var sd = [b[0] - a[0], b[1] - a[1]], horiz = Math.abs(sd[0]) >= Math.abs(sd[1]), tAng = horiz ? 0 : 90;
        var nm = one(q, "name"), nb = one(q, "number"), ne = nm ? effects(nm) : null, nbe = nb ? effects(nb) : null;
        var name = nm && nm[1] !== "~" ? nm[1] : "", number = nb ? nb[1] : "";
        var ux = sd[0] / (len || 1), uy = sd[1] / (len || 1);
        if (name && !nameHide && !(ne && ne.hide)) {
          if (nameOff > 0) {
            var nx = b[0] + ux * nameOff, ny = b[1] + uy * nameOff;
            var jx = horiz ? (ux > 0 ? "left" : "right") : "center";
            if (!horiz) { jx = uy > 0 ? "right" : "left"; }
            textAt(name, nx, ny, ne.h, tAng, jx, "middle", SCH_COL.pinName);
          } else {
            var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, o = 0.5;
            textAt(name, horiz ? mx : mx - o, horiz ? my - o : my, ne.h, tAng, "center", "bottom", SCH_COL.pinName);
          }
        }
        if (number && !numHideAll && !(nbe && nbe.hide)) {
          var cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, o2 = 0.4;
          textAt(number, horiz ? cx : cx - o2, horiz ? cy - o2 : cy, nbe.h, tAng, "center", "bottom", SCH_COL.pinNum);
        }
      }
    }
    var paper = paperOf(root);
    var box = paper ? [0, 0, paper[0], paper[1]] : boxOf(items);
    return { kind: "sch", items: items, parts: parts, box: box, layers: [], paper: paper, title: one(root, "title_block") };
  }

  function paperOf(root) {
    var p = one(root, "paper"); if (!p) return null;
    if (p[1] === "User") return [num(p[2], 297), num(p[3], 210)];
    var s = PAPER[p[1]] || PAPER.A4; return flag(p, "portrait") ? [s[1], s[0]] : s.slice();
  }
  function boxOf(list) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    function add(x, y, r) { r = r || 0; if (x - r < b[0]) b[0] = x - r; if (y - r < b[1]) b[1] = y - r; if (x + r > b[2]) b[2] = x + r; if (y + r > b[3]) b[3] = y + r; }
    list.forEach(function (it) {
      if (it.k === "line") { add(it.a[0], it.a[1]); add(it.b[0], it.b[1]); }
      else if (it.k === "poly" || it.k === "bezier") it.p.forEach(function (p) { add(p[0], p[1]); });
      else if (it.k === "circle" || it.k === "arc" || it.k === "via") add(it.x, it.y, it.r);
      else if (it.k === "pad") add(it.x, it.y, Math.max(it.w, it.h) / 2);
      else if (it.k === "text") add(it.x, it.y);
    });
    return b[0] === Infinity ? null : b;
  }

  /* ================================================================== the page frame (border, zones, title block) */
  function frameItems(model) {
    var P = model.paper; if (!P) return [];
    var col = model.kind === "pcb" ? PCB_COL.frame : SCH_COL.frame, o = [], W = P[0], H = P[1], m = 10, m2 = 12, w = 0.15;
    function rect(x1, y1, x2, y2) { o.push({ k: "poly", p: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], w: w, c: col, closed: true }); }
    function txt(s, x, y, h, jx) { if (s) o.push({ k: "text", x: x, y: y, s: s, h: h, a: 0, jx: jx || "left", jy: "middle", c: col }); }
    rect(m, m, W - m, H - m); rect(m2, m2, W - m2, H - m2);
    var cols = Math.max(1, Math.round((W - 2 * m) / 50)), rows = Math.max(1, Math.round((H - 2 * m) / 50));
    for (var i = 0; i < cols; i++) {
      var x = m2 + (W - 2 * m2) * (i + 0.5) / cols;
      txt(String(i + 1), x, (m + m2) / 2, 1.3, "center"); txt(String(i + 1), x, H - (m + m2) / 2, 1.3, "center");
      if (i) { var xl = m2 + (W - 2 * m2) * i / cols; o.push(lineItem([xl, m], [xl, m2], w, col)); o.push(lineItem([xl, H - m2], [xl, H - m], w, col)); }
    }
    for (var j = 0; j < rows; j++) {
      var y = m2 + (H - 2 * m2) * (j + 0.5) / rows, ch = String.fromCharCode(65 + j);
      txt(ch, (m + m2) / 2, y, 1.3, "center"); txt(ch, W - (m + m2) / 2, y, 1.3, "center");
      if (j) { var yl = m2 + (H - 2 * m2) * j / rows; o.push(lineItem([m, yl], [m2, yl], w, col)); o.push(lineItem([W - m2, yl], [W - m, yl], w, col)); }
    }
    // title block
    var tb = model.title, get = function (n) { var v = tb && one(tb, n); return v ? v[1] : ""; };
    var x1 = W - m2 - 110, y1 = H - m2 - 32, x2 = W - m2, y2 = H - m2;
    rect(x1, y1, x2, y2);
    [y1 + 14, y1 + 20, y1 + 26].forEach(function (yy) { o.push(lineItem([x1, yy], [x2, yy], w, col)); });
    txt(get("company"), x1 + 1.5, y1 + 4, 1.6);
    var comments = tb ? all(tb, "comment").map(function (c) { return c[2]; }).filter(Boolean) : [];
    if (comments[0]) txt(comments[0], x1 + 1.5, y1 + 9, 1.4);
    txt("Title: " + get("title"), x1 + 1.5, y1 + 17, 2.0);
    txt("Size: " + (one(model._root, "paper") || [])[1], x1 + 1.5, y1 + 23, 1.4);
    txt("Date: " + get("date"), x1 + 28, y1 + 23, 1.4);
    txt("Rev: " + get("rev"), x2 - 20, y1 + 23, 1.4);
    txt(model.file || "", x1 + 1.5, y1 + 29, 1.4);
    txt("Web-Circuit-Viewer", x2 - 1.5, y1 + 29, 1.2, "right");
    return o;
  }

  /* ================================================================== drawing */
  function drawItem(ctx, it, s, model) {
    var minW = 1 / s;                            // never thinner than one screen pixel
    switch (it.k) {
      case "line":
        ctx.strokeStyle = it.c; ctx.lineWidth = Math.max(it.w, minW);
        ctx.beginPath(); ctx.moveTo(it.a[0], it.a[1]); ctx.lineTo(it.b[0], it.b[1]); ctx.stroke(); break;
      case "poly":
        if (!it.p.length) return;
        ctx.beginPath(); ctx.moveTo(it.p[0][0], it.p[0][1]);
        for (var i = 1; i < it.p.length; i++) ctx.lineTo(it.p[i][0], it.p[i][1]);
        if (!it.open) ctx.closePath();
        if (it.fill) { ctx.fillStyle = it.fill === true ? it.c : it.fill; ctx.fill(); }
        if (it.w || !it.fill) { ctx.strokeStyle = it.c; ctx.lineWidth = Math.max(it.w || 0, minW); ctx.stroke(); }
        break;
      case "bezier":
        if (it.p.length < 4) return;
        ctx.strokeStyle = it.c; ctx.lineWidth = Math.max(it.w, minW);
        ctx.beginPath(); ctx.moveTo(it.p[0][0], it.p[0][1]); ctx.bezierCurveTo(it.p[1][0], it.p[1][1], it.p[2][0], it.p[2][1], it.p[3][0], it.p[3][1]); ctx.stroke(); break;
      case "circle":
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, 2 * Math.PI);
        if (it.fill) { ctx.fillStyle = it.fill === true ? it.c : it.fill; ctx.fill(); }
        if (it.w || !it.fill) { ctx.strokeStyle = it.c; ctx.lineWidth = Math.max(it.w || 0, minW); ctx.stroke(); }
        break;
      case "arc":
        ctx.strokeStyle = it.c; ctx.lineWidth = Math.max(it.w, minW);
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r, it.a0, it.a1, it.ccw); ctx.stroke(); break;
      case "via":
        ctx.fillStyle = PCB_COL.via; ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, 2 * Math.PI); ctx.fill();
        hole(ctx, model, function () { ctx.beginPath(); ctx.arc(it.x, it.y, it.d, 0, 2 * Math.PI); ctx.fill(); }); break;
      case "pad": drawPad(ctx, it, model); break;
      case "text": drawText(ctx, it, s, model); break;
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // a drill hole: dark, or punched right through the picture (see-through posters)
  function hole(ctx, model, shape) {
    var punch = model && model._punch;
    ctx.save(); ctx.fillStyle = PCB_COL.hole; if (punch) ctx.globalCompositeOperation = "destination-out";
    shape(); ctx.restore();
  }
  function drawPad(ctx, p, model) {
    ctx.fillStyle = p.c;
    if (!p.holeOnly) {
      if (p.shape === "custom" && p.prim && p.prim.length) {
        p.prim.forEach(function (q) {
          ctx.beginPath();
          if (q.k === "poly") { ctx.moveTo(q.p[0][0], q.p[0][1]); q.p.forEach(function (v) { ctx.lineTo(v[0], v[1]); }); ctx.closePath(); ctx.fill(); if (q.w) { ctx.strokeStyle = p.c; ctx.lineWidth = q.w; ctx.stroke(); } }
          else if (q.k === "circle") { ctx.arc(q.x, q.y, q.r, 0, 2 * Math.PI); ctx.fill(); }
          else if (q.k === "line") { ctx.strokeStyle = p.c; ctx.lineWidth = q.w; ctx.lineCap = "round"; ctx.moveTo(q.a[0], q.a[1]); ctx.lineTo(q.b[0], q.b[1]); ctx.stroke(); }
        });
      }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-p.a * Math.PI / 180);
      ctx.beginPath();
      var w = p.w, h = p.h;
      if (p.shape === "circle") ctx.arc(0, 0, w / 2, 0, 2 * Math.PI);
      else if (p.shape === "oval") roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) / 2);
      else if (p.shape === "roundrect") roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * p.rr);
      else if (p.shape === "custom") { var a = Math.min(w, h) / 2; ctx.arc(0, 0, a, 0, 2 * Math.PI); }
      else ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fill();
      if (!p.th && !p.holeOnly) { ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 0.05; ctx.stroke(); }
      ctx.restore();
    }
    if (p.drill) hole(ctx, model, function () {
      ctx.translate(p.x, p.y); ctx.rotate(-p.a * Math.PI / 180);
      ctx.beginPath(); roundRect(ctx, -p.dw / 2, -p.dh / 2, p.dw, p.dh, Math.min(p.dw, p.dh) / 2); ctx.fill();
    });
  }
  /* ---- KiCad's own stroke font (newstroke), loaded from newstroke.js next to this script.
     Hershey encoding: the first two characters give the left/right bounds, then x,y pairs as
     (char - 'R') / 21, " R" lifts the pen; y gets KiCad's offset of -8. Sizes are in units of the text height. */
  var FONT = { ready: false, failed: false, glyphs: {}, ranges: null, space: 0.5, waiting: [] };
  var SCRIPT_DIR = (function () { try { return new URL(".", document.currentScript.src).href; } catch (e) { return ""; } })();
  function loadFont(onReady) {
    if (FONT.ready) return;
    if (onReady) FONT.waiting.push(onReady);
    if (FONT.loading || FONT.failed) return;
    FONT.loading = true;
    var done = function () {
      if (!window.WCV_FONT) { FONT.failed = true; return; }
      FONT.ranges = window.WCV_FONT.map(function (r) { return [r[0], r[1].split("\n")]; });
      FONT.space = glyphOf(32).w; FONT.ready = true;
      FONT.waiting.forEach(function (f) { f(); }); FONT.waiting = [];
    };
    if (window.WCV_FONT) { done(); return; }
    var sc = document.createElement("script"); sc.src = SCRIPT_DIR + "newstroke.js";
    sc.onload = done; sc.onerror = function () { FONT.failed = true; };
    document.head.appendChild(sc);
  }
  function glyphOf(cp) {
    var g = FONT.glyphs[cp]; if (g) return g;
    var src = null;
    for (var i = 0; i < FONT.ranges.length; i++) { var r = FONT.ranges[i]; if (cp >= r[0] && cp < r[0] + r[1].length) { src = r[1][cp - r[0]]; break; } }
    if (src == null) return cp === 63 ? { w: 0.5, p: [] } : glyphOf(63);
    var x0 = (src.charCodeAt(0) - 82) / 21, x1 = (src.charCodeAt(1) - 82) / 21, strokes = [], cur = [];
    for (var k = 2; k + 1 < src.length; k += 2) {
      if (src[k] === " " && src[k + 1] === "R") { if (cur.length) strokes.push(cur); cur = []; continue; }
      cur.push([(src.charCodeAt(k) - 82) / 21 - x0, (src.charCodeAt(k + 1) - 82 - 8) / 21]);
    }
    if (cur.length) strokes.push(cur);
    g = { w: x1 - x0, p: strokes }; FONT.glyphs[cp] = g; return g;
  }
  function lineWidth(line, w) {           // advance of one line, in mm (KiCad: glyph width + 0.2 em between glyphs, space = width of ' ')
    var x = 0;
    for (var i = 0; i < line.length; i++) { var cp = line.codePointAt(i); if (cp > 0xffff) i++; x += (cp === 32 ? FONT.space : glyphOf(cp).w) * w; }
    return x;
  }
  function drawText(ctx, t, s, model) {
    if (!t.s || t.h * s < 2.5) return;              // too small to read at this zoom: skip it
    ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(-(t.a || 0) * Math.PI / 180);
    if (t.mirror) ctx.scale(-1, 1);          // the flipped view mirrors the whole drawing, text included, by itself
    if (!FONT.ready) {                              // the font is still on its way: a plain font for now
      var em = t.h / 0.72;
      ctx.font = (t.bold ? "bold " : "") + em + "px Arial, Helvetica, sans-serif";
      ctx.fillStyle = t.c; ctx.textAlign = t.jx || "center"; ctx.textBaseline = t.jy === "top" ? "top" : t.jy === "bottom" ? "alphabetic" : "middle";
      ctx.fillText(t.s.split("\n")[0], 0, 0); ctx.restore(); return;
    }
    var h = t.h, w = t.w || h, lines = t.s.split("\n"), pitch = h * 1.55, tilt = t.i ? 1 / 8 : 0;
    var th = t.t || (t.bold ? h / 5 : h / 8);
    ctx.strokeStyle = t.c; ctx.lineWidth = Math.max(th, 1 / s); ctx.lineCap = "round"; ctx.lineJoin = "round";
    // vertical: bottom = baseline on the anchor, middle = anchor in the middle of the (first) line, top = line hangs below
    var y0 = t.jy === "top" ? h : t.jy === "bottom" ? 0 : h / 2;
    if (lines.length > 1) y0 -= (t.jy === "top" ? 0 : t.jy === "bottom" ? (lines.length - 1) * pitch : (lines.length - 1) * pitch / 2);
    ctx.beginPath();
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li], lw = lineWidth(line, w) - 0.2 * w, x = t.jx === "left" ? 0 : t.jx === "right" ? -lw : -lw / 2, y = y0 + li * pitch;
      for (var i = 0; i < line.length; i++) {
        var cp = line.codePointAt(i); if (cp > 0xffff) i++;
        if (cp === 32) { x += FONT.space * w; continue; }
        var g = glyphOf(cp);
        for (var a = 0; a < g.p.length; a++) {
          var st = g.p[a];
          for (var b = 0; b < st.length; b++) {
            var px = x + (st[b][0] - st[b][1] * tilt) * w, py = y + st[b][1] * h;
            if (b) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
        }
        x += g.w * w;
      }
    }
    ctx.stroke(); ctx.restore();
  }

  /* ================================================================== the viewer */
  var CSS = ".wcv{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;font:13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}" +
    ".wcv canvas{display:block;width:100%;height:100%;cursor:grab}.wcv canvas.drag{cursor:grabbing}" +
    ".wcv-bar{position:absolute;right:10px;bottom:10px;display:flex;gap:6px;z-index:2}.wcv .wcv-zoom{top:10px;bottom:auto}" +
    ".wcv .wcv-bar button,.wcv .wcv-lay button{font:inherit;font-size:13px;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.92);color:#333;border-radius:8px;min-width:34px;height:32px;padding:0 9px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.2);" +
    // a page's own button styles (blog themes) must not reach in here: fixed size, one line, no extras
    "margin:0;width:auto;max-width:none;line-height:1;letter-spacing:normal;text-transform:none;text-indent:0;white-space:nowrap;box-sizing:border-box;vertical-align:middle;-webkit-appearance:none;appearance:none}" +
    ".wcv .wcv-bar button:hover{background:#fff}.wcv .wcv-bar button.on{background:#333;color:#fff;border-color:#333}" +
    ".wcv-lay{position:absolute;right:10px;bottom:50px;z-index:2;background:rgba(255,255,255,.95);border-radius:10px;padding:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-height:calc(100% - 70px);overflow:auto;display:none;min-width:150px}" +
    ".wcv-lay.open{display:block}.wcv-lay label{display:flex;align-items:center;gap:7px;padding:3px 4px;cursor:pointer;color:#333;white-space:nowrap}" +
    ".wcv-lay i{width:14px;height:14px;border-radius:3px;display:inline-block;border:1px solid rgba(0,0,0,.25)}" +
    ".wcv-lay .wcv-row{display:flex;gap:6px;margin-top:6px}.wcv .wcv-lay .wcv-row button{height:26px;font-size:12px;flex:1 0 auto;padding:0 8px}" +
    ".wcv-tip{position:absolute;z-index:3;pointer-events:none;background:rgba(20,20,20,.88);color:#fff;padding:4px 9px;border-radius:7px;font-size:12.5px;white-space:nowrap;display:none}" +
    ".wcv-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font-size:14px;text-align:center;padding:20px;pointer-events:none}";
  function addCss() { if (document.getElementById("wcv-css")) return; var s = document.createElement("style"); s.id = "wcv-css"; s.textContent = CSS; document.head.appendChild(s); }

  function mount(host, url, opts) {
    addCss(); opts = opts || {};
    if (opts.font !== false) loadFont(function () { draw(); });
    var box = document.createElement("div"); box.className = "wcv";
    var cv = document.createElement("canvas"), ctx = cv.getContext("2d");
    var bar = document.createElement("div"); bar.className = "wcv-bar";
    var zoomBar = document.createElement("div"); zoomBar.className = "wcv-bar wcv-zoom";      // − and + sit top right
    var tip = document.createElement("div"); tip.className = "wcv-tip";
    var msg = document.createElement("div"); msg.className = "wcv-msg"; msg.textContent = "Loading…";
    var lay = document.createElement("div"); lay.className = "wcv-lay";
    box.appendChild(cv); box.appendChild(bar); box.appendChild(zoomBar); box.appendChild(lay); box.appendChild(tip); box.appendChild(msg);
    host.appendChild(box);
    var model = null, frame = [], view = { s: 1, x: 0, y: 0 }, on = {}, hover = null, raf = 0, dead = false;
    var pendingKind = null;        // "pcb" | "sch" from the file name, so the right background shows while it loads

    function btn(label, title, fn, where) { var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", fn); (where || bar).appendChild(b); return b; }
    btn("−", "Zoom out", function () { zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.4); }, zoomBar);
    btn("+", "Zoom in", function () { zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.4); }, zoomBar);
    var layBtn = btn("Layers", "Show or hide layers", function () { lay.classList.toggle("open"); });
    var flipBtn = btn("Flip", "Look at the board from the other side", function () { flip(); });
    btn("Fit", "Show everything", function () { fit(); }).dataset.act = "fit";

    function size() {
      var r = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
      return r;
    }
    function sgn() { return model && model.flipped ? -1 : 1; }
    // turn the board over: mirrored left-right, the other side's copper and silkscreen on top, same point in the middle
    function flip() {
      if (!model || model.kind !== "pcb") return;
      var w = cv.clientWidth, cx = (w / 2 - view.x) / (sgn() * view.s);
      model.flipped = !model.flipped;
      view.x = w / 2 - sgn() * cx * view.s;
      flipBtn.classList.toggle("on", model.flipped); flipBtn.textContent = model.flipped ? "Front" : "Flip";
      flipBtn.title = model.flipped ? "Back to the front side" : "Look at the board from the other side";
      draw();
    }
    function fit() {
      if (!model) return;
      view = fitView(cv.clientWidth || 600, cv.clientHeight || 400);
      lastW = cv.clientWidth; lastH = cv.clientHeight; draw();
    }
    // put a point of the drawing (mm) in the middle, at a zoom (px per mm)
    function center(x, y, sc) {
      if (!model) return;
      var w = cv.clientWidth, h = cv.clientHeight; sc = sc || view.s;
      view = { s: sc, x: w / 2 - sgn() * x * sc, y: h / 2 - y * sc }; draw();
    }
    // zoom to one part (by reference, e.g. "U2") and point it out
    function focus(ref) {
      if (!model) return false;
      var p = model.parts.filter(function (q) { return q.ref === ref && q.box; })[0]; if (!p) return false;
      var b = p.box, w = cv.clientWidth, h = cv.clientHeight, bw = (b[2] - b[0]) || 1, bh = (b[3] - b[1]) || 1;
      var sc = Math.min(w / (bw * 6), h / (bh * 6), model.kind === "pcb" ? 60 : 20);
      view = { s: sc, x: w / 2 - sgn() * (b[0] + b[2]) / 2 * sc, y: h / 2 - (b[1] + b[3]) / 2 * sc };
      hover = p; draw(); return true;
    }
    function zoomAt(px, py, f) {
      var s2 = Math.max(0.05, Math.min(view.s * f, 2000));
      view.x = px - (px - view.x) * (s2 / view.s); view.y = py - (py - view.y) * (s2 / view.s); view.s = s2; draw();
    }
    function draw() { if (!raf) raf = requestAnimationFrame(paint); }
    function paint() {
      raf = 0; if (dead) return;
      var r = size();
      scene(ctx, cv.clientWidth, cv.clientHeight, view, r, { background: "auto", frame: frame, hover: hover });
    }
    // draws the model into any 2d context: the screen (paint) or a poster (render)
    // W, H in css px, v = {s, x, y}, r = device pixels per css px; o.background: "auto" | "transparent" | css colour
    function scene(c, W, H, v, r, o) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W * r, H * r);
      if (o.background !== "transparent") {
        c.fillStyle = o.background && o.background !== "auto" ? o.background : ((model ? model.kind : pendingKind) === "sch" ? SCH_COL.bg : PCB_COL.bg);
        c.fillRect(0, 0, W * r, H * r);
      }
      if (!model) return;
      model._punch = o.background === "transparent";
      c.setTransform(sgn() * v.s * r, 0, 0, v.s * r, v.x * r, v.y * r);
      c.lineCap = "round"; c.lineJoin = "round";
      var s = v.s, xa = -v.x / (sgn() * s), xb = (W - v.x) / (sgn() * s);
      var x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y0 = -v.y / s, y1 = y0 + H / s;
      (o.frame || []).forEach(function (it) { drawItem(c, it, s, model); });
      var pcb = model.kind === "pcb", list = model.flipped ? model.itemsBack : model.items;
      if (pcb && o.board && model.outline && model.outline.length) {        // the board itself, holes and cut-outs left open
        c.fillStyle = o.board === true ? PCB_COL.bg : o.board; c.beginPath();
        model.outline.forEach(function (lp) { lp.forEach(function (q, i) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.closePath(); });
        c.fill("evenodd");
      }
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (pcb && it.L && !on[it.L]) continue;
        var bb = it._bb || (it._bb = boxOf([it]));
        if (bb && (bb[2] < x0 || bb[0] > x1 || bb[3] < y0 || bb[1] > y1)) continue;     // off screen
        if (pcb && !it.zone && it.k !== "text") c.globalAlpha = 0.92; else c.globalAlpha = 1;
        drawItem(c, it, s, model);
      }
      c.globalAlpha = 1;
      var hv = o.hover;
      if (hv && hv.box) {
        var hb = hv.box, m = 0.4;
        c.lineWidth = 1.5 / s; c.strokeStyle = pcb ? PCB_COL.hover : "#0064c8"; c.setLineDash([4 / s, 3 / s]);
        if (!pcb) { c.fillStyle = SCH_COL.hover; c.fillRect(hb[0] - m, hb[1] - m, hb[2] - hb[0] + 2 * m, hb[3] - hb[1] + 2 * m); }
        c.strokeRect(hb[0] - m, hb[1] - m, hb[2] - hb[0] + 2 * m, hb[3] - hb[1] + 2 * m); c.setLineDash([]);
      }
    }
    // the view that shows everything in a W x H box (what Fit does), with a margin as a fraction of the box
    function fitView(W, H, margin) {
      var b = model.box || (model.kind === "pcb" ? [0, 0, 100, 100] : [0, 0, 297, 210]);
      var pad = margin != null ? margin : (model.kind === "pcb" ? 0.08 : 0.02);
      var bw = (b[2] - b[0]) * (1 + 2 * pad) || 1, bh = (b[3] - b[1]) * (1 + 2 * pad) || 1, sc = Math.min(W / bw, H / bh);
      return { s: sc, x: W / 2 - sgn() * (b[0] + b[2]) / 2 * sc, y: H / 2 - (b[1] + b[3]) / 2 * sc };
    }
    /* a poster: the drawing rendered into a new canvas of width x height pixels.
       o.view: "fit" (default, everything, with o.margin) or "current" (what is on screen now);
       o.background: "auto" (KiCad's) | "transparent" | a css colour;  o.frame: page frame on/off (schematics: on);
       o.board: with a transparent background the board's own shape is still filled (true, default) in KiCad's dark
       colour, or a css colour, or false for nothing but copper and silkscreen.
       Returns the canvas; toBlob(canvas, "image/webp", 0.92) makes the file. */
    function render(o) {
      o = o || {};
      if (!model) return null;
      var W = Math.max(16, Math.round(o.width || 1600)), H = Math.max(16, Math.round(o.height || Math.round(W / 1.4142)));
      var out = document.createElement("canvas"); out.width = W; out.height = H;
      var c = out.getContext("2d"), v;
      if (o.view === "current") {                      // the same picture as the screen, scaled to the poster
        var k = Math.min(W / cv.clientWidth, H / cv.clientHeight);
        v = { s: view.s * k, x: view.x * k + (W - cv.clientWidth * k) / 2, y: view.y * k + (H - cv.clientHeight * k) / 2 };
      } else v = fitView(W, H, o.margin);
      var fr = o.frame === true ? frameItems(model) : o.frame === false ? [] : frame;
      scene(c, W, H, v, 1, { background: o.background || "auto", frame: fr, hover: null, board: o.board != null ? o.board : o.background === "transparent" });
      return out;
    }
    function toBlob(canvas, type, quality) {
      return new Promise(function (ok, fail) { canvas.toBlob(function (b) { b ? ok(b) : fail(new Error("no image")); }, type || "image/png", quality); });
    }

    // ---- pointer: drag to move, wheel / pinch to zoom, hover for the part's name
    var ptrs = {}, drag = null, pinch = null;
    cv.addEventListener("wheel", function (e) { e.preventDefault(); var r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    cv.addEventListener("pointerdown", function (e) {
      ptrs[e.pointerId] = e; try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      var ids = Object.keys(ptrs);
      if (ids.length === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      else if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: view.s, vx: view.x, vy: view.y }; drag = null; }
    });
    cv.addEventListener("pointermove", function (e) {
      var r = cv.getBoundingClientRect();
      if (ptrs[e.pointerId]) {
        ptrs[e.pointerId] = e; var ids = Object.keys(ptrs);
        if (pinch && ids.length === 2) {
          var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          var mx = (a.clientX + b.clientX) / 2 - r.left, my = (a.clientY + b.clientY) / 2 - r.top, s2 = Math.max(0.05, Math.min(pinch.s * d / pinch.d, 2000));
          view.x = mx - (mx - pinch.vx) * (s2 / pinch.s); view.y = my - (my - pinch.vy) * (s2 / pinch.s); view.s = s2; draw(); return;
        }
        if (drag) { cv.classList.add("drag"); view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; tip.style.display = "none"; draw(); return; }
      }
      if (e.pointerType === "mouse") hoverAt(e.clientX - r.left, e.clientY - r.top);
    });
    function up(e) { delete ptrs[e.pointerId]; if (!Object.keys(ptrs).length) { drag = null; pinch = null; cv.classList.remove("drag"); } }
    cv.addEventListener("pointerup", function (e) {
      var wasTap = drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5 && e.pointerType !== "mouse";
      up(e);
      if (wasTap) { var r = cv.getBoundingClientRect(); hoverAt(e.clientX - r.left, e.clientY - r.top); }
    });
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", function () { if (hover) { hover = null; tip.style.display = "none"; draw(); } });
    cv.addEventListener("dblclick", function (e) { var r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 2); });
    function hoverAt(px, py) {
      if (!model) return;
      var x = (px - view.x) / (sgn() * view.s), y = (py - view.y) / view.s, best = null, ba = Infinity;
      model.parts.forEach(function (p) {
        var b = p.box; if (!b || !p.ref || /^#/.test(p.ref)) return;
        if (model.kind === "pcb" && p.items.length && !p.items.some(function (i) { return on[i.L]; })) return;
        if (x >= b[0] - 0.3 && x <= b[2] + 0.3 && y >= b[1] - 0.3 && y <= b[3] + 0.3) { var a = (b[2] - b[0]) * (b[3] - b[1]); if (a < ba) { ba = a; best = p; } }
      });
      if (best !== hover) { hover = best; draw(); }
      if (best) {
        tip.textContent = best.ref + (best.val && best.val !== best.ref ? "  ·  " + best.val : "");
        tip.style.display = "block";
        var tw = tip.offsetWidth, bw = box.clientWidth;
        tip.style.left = Math.min(px + 14, bw - tw - 6) + "px"; tip.style.top = Math.max(6, py - 30) + "px";
      } else tip.style.display = "none";
    }

    // ---- the layer list (boards only)
    function buildLayers() {
      lay.innerHTML = "";
      if (!model || model.kind !== "pcb") { lay.classList.remove("open"); layBtn.style.display = "none"; flipBtn.style.display = "none"; return; }   // a schematic has no layers: close the box too
      layBtn.style.display = ""; flipBtn.style.display = ""; flipBtn.classList.remove("on"); flipBtn.textContent = "Flip";
      model.layers.forEach(function (L) {
        var lab = document.createElement("label"), cb = document.createElement("input"), sw = document.createElement("i");
        cb.type = "checkbox"; cb.checked = !!on[L];
        sw.style.background = L === "Vias" ? PCB_COL.via : (PCB_COL[L] || PCB_COL.user);
        cb.addEventListener("change", function () { on[L] = cb.checked; draw(); if (opts.onLayers) opts.onLayers(Object.assign({}, on)); });
        lab.appendChild(cb); lab.appendChild(sw); lab.appendChild(document.createTextNode(L === "Vias" ? "Vias" : L.replace(".SilkS", ".Silkscreen")));
        lay.appendChild(lab);
      });
      var row = document.createElement("div"); row.className = "wcv-row";
      [["Front", /^F\.|Edge|Vias/], ["Back", /^B\.|Edge|Vias/], ["All", /./]].forEach(function (x) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = x[0];
        b.addEventListener("click", function () { model.layers.forEach(function (L) { on[L] = x[1].test(L); }); buildLayers(); lay.classList.add("open"); draw(); if (opts.onLayers) opts.onLayers(Object.assign({}, on)); });
        row.appendChild(b);
      });
      lay.appendChild(row);
    }

    var loadNo = 0;
    function load(u) {
      var my = ++loadNo;                      // a slower, older load must not overwrite a newer one
      pendingKind = /\.kicad_sch(\?|#|$)/i.test(u) ? "sch" : /\.kicad_pcb(\?|#|$)/i.test(u) ? "pcb" : null;
      box.style.background = pendingKind === "sch" ? SCH_COL.bg : PCB_COL.bg;       // the same colour as the drawing, so nothing flashes
      msg.style.display = ""; msg.textContent = "Loading…"; model = null; hover = null; draw();
      return fetch(u).then(function (r) { if (!r.ok) throw new Error("the file answered " + r.status); return r.text(); })
        .then(function (txt) { if (my === loadNo) loadText(txt, decodeURIComponent(String(u).split("/").pop().split("?")[0])); })
        .catch(function (e) { if (my === loadNo) fail(e); });
    }
    function fail(e) { msg.style.display = ""; msg.textContent = "Couldn't open this file (" + e.message + ")."; if (opts.onError) opts.onError(e); }
    // the file's text (from a drop or a file picker); name is only shown in the title block
    function loadText(txt, name) {
      if (dead) return;
      loadNo++;
      pendingKind = /\.kicad_sch$/i.test(name || "") ? "sch" : /\.kicad_pcb$/i.test(name || "") ? "pcb" : pendingKind;
      try {
        var root = parse(txt);
        if (!root) throw new Error("not a KiCad file");
        model = root[0] === "kicad_pcb" ? buildPcb(root) : root[0] === "kicad_sch" ? buildSch(root) : null;
        if (!model) throw new Error("not a KiCad board or schematic");
      } catch (e) { model = null; fail(e); return; }
      model._root = root; model.file = name || ""; pendingKind = model.kind; box.style.background = model.kind === "sch" ? SCH_COL.bg : PCB_COL.bg;
      frame = (opts.frame === false || (opts.frame !== true && model.kind === "pcb")) ? [] : frameItems(model);
      on = {}; model.layers.forEach(function (L) { on[L] = PCB_DEFAULT_ON.test(L) || L === "Vias"; });
      buildLayers(); msg.style.display = "none"; fit();
      if (opts.onLoad) opts.onLoad(info());
    }
    // what is loaded: for a page around the viewer
    function info() {
      if (!model) return null;
      var tb = model.title, get = function (n) { var v = tb && one(tb, n); return v ? v[1] : ""; };
      return { kind: model.kind, file: model.file, title: get("title"), rev: get("rev"), date: get("date"), company: get("company"),
        layers: model.layers.slice(), on: Object.assign({}, on), flipped: !!model.flipped, box: model.box ? model.box.slice() : null,
        parts: model.parts.filter(function (p) { return p.ref && !/^#/.test(p.ref); }).map(function (p) { return { ref: p.ref, value: p.val }; }) };
    }
    function setLayer(L, show) { if (L in on) { on[L] = !!show; buildLayers(); draw(); } }
    // when the box changes size (full screen, phone rotation, a resized window) the drawing keeps the same
    // point in its middle and grows or shrinks with the box, so a fitted board stays fitted
    var lastW = 0, lastH = 0;
    function resized() {
      var w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (model && lastW && lastH && (w !== lastW || h !== lastH)) {
        var cx = (lastW / 2 - view.x) / (sgn() * view.s), cy = (lastH / 2 - view.y) / view.s;     // world point in the middle
        var f = Math.min(w / lastW, h / lastH);
        view.s *= f; view.x = w / 2 - sgn() * cx * view.s; view.y = h / 2 - cy * view.s;
      }
      if (model && !lastW) { lastW = w; lastH = h; fit(); return; }
      lastW = w; lastH = h; draw();
    }
    var ro = window.ResizeObserver ? new ResizeObserver(resized) : null;
    if (ro) ro.observe(box); else window.addEventListener("resize", resized);
    if (url) load(url);
    return {
      load: load, loadText: loadText, fit: fit, flip: flip, focus: focus, center: center, render: render, toBlob: toBlob, info: info, setLayer: setLayer,
      zoom: function (f) { zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, f); }, element: box, canvas: cv,
      destroy: function () { dead = true; if (ro) ro.disconnect(); box.remove(); }
    };
  }

  // the font can be fetched early (for example while the file is still downloading)
  function preloadFont() { loadFont(); }

  /* ================================================================== <web-circuit-viewer src="..."> */
  if (window.customElements && !customElements.get("web-circuit-viewer")) {
    customElements.define("web-circuit-viewer", class extends HTMLElement {
      static get observedAttributes() { return ["src"]; }
      connectedCallback() { if (!this._v) { this._v = mount(this, this.getAttribute("src") || "", {}); } }
      attributeChangedCallback(n, o, v) { if (this._v && o !== v && v) this._v.load(v); }
      disconnectedCallback() { if (this._v) { this._v.destroy(); this._v = null; } }
    });
  }

  window.WebCircuitViewer = { mount: mount, parse: parse, preloadFont: preloadFont, version: "1.2.1" };
})();
