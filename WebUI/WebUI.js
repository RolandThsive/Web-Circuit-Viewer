/* WebUI.js - the Web Circuit Viewer page: files in, the viewer (../web-circuit-viewer.js) in the middle, posters out.
   Everything happens in the browser; no file leaves it. Settings and examples come from webui.json. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var cfg = { examples: [], posterSizes: [{ name: "Custom", custom: true, "default": true, width: 1430, height: 1016 }], links: {} };
  var viewer = null;                       // the WebCircuitViewer instance
  var open = { pcb: null, sch: null };     // the two files that can be open at once: { name, text, url }
  var shown = null;                        // "pcb" | "sch"
  var poster = { size: 0, w: 1430, h: 1016, fmt: "image/webp", view: "fit", quality: 1 };
  var EXT = { "image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg" };

  // ---- small helpers
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 1800); }
  function baseName(n) { return String(n || "").split(/[\\\/]/).pop().replace(/\.(kicad_pcb|kicad_sch)$/i, ""); }
  function kindOf(name) { return /\.kicad_sch$/i.test(name) ? "sch" : /\.kicad_pcb$/i.test(name) ? "pcb" : ""; }
  function label(k) { return k === "sch" ? "Schematic" : "PCB"; }

  // ---- tooltips (data-tip), like the other tools
  var pop = null;
  document.addEventListener("mouseover", function (e) {
    var t = e.target.closest && e.target.closest("[data-tip]"); if (!t) return;
    if (!pop) { pop = el("div", "popover"); document.body.appendChild(pop); }
    pop.textContent = t.getAttribute("data-tip"); pop.hidden = false;
    var r = t.getBoundingClientRect(); pop.style.left = Math.min(r.left, window.innerWidth - 320) + "px"; pop.style.top = (r.bottom + 8) + "px";
  });
  document.addEventListener("mouseout", function (e) { if (pop && e.target.closest && e.target.closest("[data-tip]")) pop.hidden = true; });

  // ---- the viewer
  function mountViewer() {
    viewer = WebCircuitViewer.mount($("viewer"), "", {
      onLoad: function (info) {
        $("empty-note").hidden = true;
        $("btn-shot").disabled = false; $("btn-fit").disabled = false; $("btn-poster").disabled = false; $("btn-preview").disabled = false;
        $("part-search").disabled = !info.parts.length;
        $("frame").disabled = info.kind !== "sch";
        var badge = $("file-badge"); badge.hidden = false;
        badge.innerHTML = ""; badge.appendChild(el("b", null, info.title || baseName(info.file)));
        badge.appendChild(document.createTextNode((info.rev ? " · rev " + info.rev : "") + (info.date ? " · " + info.date : "") + " · " + info.parts.length + " parts"));
        if (!$("poster-name").value || $("poster-name").dataset.auto === "1") {
          $("poster-name").value = baseName(info.file) + "_" + label(info.kind); $("poster-name").dataset.auto = "1";
        }
        fillParts(info.parts);
        $("poster-preview").hidden = true;
      },
      onError: function (e) { toast("Couldn't open it: " + e.message); }
    });
  }

  // ---- opening files
  // one board and one schematic can be open: a new file takes the place of the open one of its kind
  function take(name, text, url, quiet) {
    var k = kindOf(name);
    if (!k) { toast(name + " is not a .kicad_pcb or .kicad_sch"); return; }
    open[k] = { name: name, text: text, url: url || "" };
    if (!quiet) show(k);
  }
  function show(k) {
    if (!open[k]) return;
    shown = k;
    if ($("poster-name").dataset.auto !== "0") $("poster-name").value = "";    // a name typed by hand stays
    viewer.loadText(open[k].text, open[k].name);
    drawSwitch();
  }
  // the Board / Schematic switch only works once both are open; until then it just shows which one this is
  function drawSwitch() {
    var both = !!(open.pcb && open.sch);
    [].forEach.call(document.querySelectorAll("#kind-switch button"), function (b) {
      b.disabled = !both; b.classList.toggle("on", b.dataset.kind === shown);
      b.setAttribute("data-tip", both ? (b.dataset.kind === "pcb" ? "The board (.kicad_pcb)" : "The schematic (.kicad_sch)") : "Open both a board and a schematic to switch between them");
    });
  }
  // a pick or a drop is one set: at most one board and one schematic (the first of each kind is used)
  function readFiles(list) {
    var pick = {}, extra = [];
    [].forEach.call(list, function (f) {
      var k = kindOf(f.name);
      if (!k) toast(f.name + " is not a KiCad board or schematic");
      else if (pick[k]) extra.push(f.name);
      else pick[k] = f;
    });
    if (extra.length) toast("One board and one schematic at a time: " + extra.join(", ") + " left out");
    var kinds = ["pcb", "sch"].filter(function (k) { return pick[k]; });
    var read = kinds.map(function (k) {
      return new Promise(function (ok) { var rd = new FileReader(); rd.onload = function () { take(pick[k].name, rd.result, "", true); ok(); }; rd.onerror = function () { toast("Couldn't read " + pick[k].name); ok(); }; rd.readAsText(pick[k]); });
    });
    if (kinds.length) Promise.all(read).then(function () { show(open[kinds[0]] ? kinds[0] : kinds[kinds.length - 1]); });
  }
  function fetchFile(url) {
    var name = decodeURIComponent(url.split("/").pop().split("?")[0]);
    toast("Loading " + name + "…");
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (t) { take(name, t, url, true); }).catch(function () { toast("Couldn't load " + name); });
  }
  // opens a board and/or schematic as one set, replacing what is open, and shows the board first
  function fetchSet(pcb, sch) {
    var jobs = [pcb && fetchFile(pcb), sch && fetchFile(sch)].filter(Boolean);
    if (!jobs.length) return Promise.resolve();
    open.pcb = open.sch = null;                       // a new set: nothing of the old one stays behind
    return Promise.all(jobs).then(function () { if (open.pcb) show("pcb"); else if (open.sch) show("sch"); else drawSwitch(); });
  }
  $("file-input").addEventListener("change", function () { readFiles(this.files); this.value = ""; });
  var dz = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); if (ev === "drop" || e.target === document.documentElement) dz.classList.remove("over"); }); });
  document.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });
  $("kind-switch").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b && !b.disabled) show(b.dataset.kind); });

  // ---- parts: a list with a search; clicking one zooms the viewer to it
  var allParts = [];
  function fillParts(list) {
    allParts = list.slice().sort(function (a, b) { return a.ref.localeCompare(b.ref, undefined, { numeric: true }); });
    $("part-count").textContent = allParts.length ? allParts.length + " parts" : "";
    $("part-search").value = ""; drawParts("");
  }
  function drawParts(q) {
    var ul = $("parts"); ul.innerHTML = ""; q = q.trim().toLowerCase();
    var hit = allParts.filter(function (p) { return !q || p.ref.toLowerCase().indexOf(q) === 0 || (p.value || "").toLowerCase().indexOf(q) > -1; });
    hit.slice(0, 80).forEach(function (p) {
      var li = el("li"); li.appendChild(el("b", null, p.ref)); li.appendChild(el("span", null, p.value || ""));
      li.title = "Show " + p.ref; li.addEventListener("click", function () { viewer.focus(p.ref); }); ul.appendChild(li);
    });
    if (hit.length > 80) ul.appendChild(el("li", "more", "… and " + (hit.length - 80) + " more, type to narrow it down"));
    if (!hit.length && q) ul.appendChild(el("li", "more", "No part called that"));
  }
  $("part-search").addEventListener("input", function () { drawParts(this.value); });
  $("part-search").addEventListener("keydown", function (e) { if (e.key === "Enter") { var first = $("parts").querySelector("li:not(.more)"); if (first) first.click(); } });

  // ---- full screen and a quick screenshot of the view
  var wrap = $("canvas-wrap");
  $("btn-fullscreen").addEventListener("click", function () {
    if (document.fullscreenElement) document.exitFullscreen(); else (wrap.requestFullscreen || wrap.webkitRequestFullscreen).call(wrap);
  });
  $("btn-fit").addEventListener("click", function () { viewer.fit(); });
  $("btn-shot").addEventListener("click", function () {
    var c = viewer.render({ width: viewer.canvas.width, height: viewer.canvas.height, view: "current", frame: $("frame").checked });
    if (c) save(c, "image/png", 1, ($("poster-name").value || "circuit") + "_view");
  });

  // ---- the poster maker
  function buildSizes() {
    var seg = $("size-seg"); seg.innerHTML = "";
    cfg.posterSizes.forEach(function (p, i) {
      var b = el("button", i === poster.size ? "on" : "", p.name); b.type = "button"; b.dataset.i = i;
      if (p.tip) b.setAttribute("data-tip", p.tip); else if (p.width) b.setAttribute("data-tip", p.width + " × " + p.height + " px");
      b.addEventListener("click", function () { poster.size = i; buildSizes(); sizeChanged(); }); seg.appendChild(b);
    });
    var p = cfg.posterSizes[poster.size], custom = isCustom(p);
    $("custom-size").hidden = !custom;
    if (!custom) { poster.w = p.width; poster.h = p.height; }       // the custom boxes keep their own numbers
    else {                                             // the boxes start at the preset's own size (the blog poster)
      if (!$("size-w").value) $("size-w").value = p.width || 1430;
      if (!$("size-h").value) $("size-h").value = p.height || 1016;
      readCustom(p);
    }
    $("size-note").textContent = poster.w + " × " + poster.h + " px";
  }
  // a preset is the custom one when it says so, or (older webui.json) when it has no size of its own
  function isCustom(p) { return !!(p.custom || !p.width); }
  function readCustom(p) {
    poster.w = Math.max(16, Math.min(8192, +$("size-w").value || p.width || 1430));
    poster.h = Math.max(16, Math.min(8192, +$("size-h").value || p.height || 1016));
  }
  function sizeChanged() {
    var p = cfg.posterSizes[poster.size];
    if (isCustom(p)) readCustom(p);
    $("size-note").textContent = poster.w + " × " + poster.h + " px";
  }
  ["size-w", "size-h"].forEach(function (id) { $(id).addEventListener("input", sizeChanged); });
  $("fmt-seg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    poster.fmt = b.dataset.fmt;
    [].forEach.call($("fmt-seg").children, function (x) { x.classList.toggle("on", x === b); });
    $("ext-note").textContent = EXT[poster.fmt]; $("quality-row").hidden = poster.fmt === "image/png";
    var tr = $("transparent"); tr.disabled = poster.fmt === "image/jpeg"; if (tr.disabled) tr.checked = false;
  });
  $("view-seg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return; poster.view = b.dataset.view;
    [].forEach.call($("view-seg").children, function (x) { x.classList.toggle("on", x === b); });
  });
  $("quality").addEventListener("input", function () { poster.quality = this.value / 100; $("quality-out").textContent = this.value; });
  $("poster-name").addEventListener("input", function () { this.dataset.auto = "0"; });
  function posterCanvas(w, h) {
    return viewer.render({ width: w, height: h, view: poster.view, background: $("transparent").checked && poster.fmt !== "image/jpeg" ? "transparent" : "auto",
      frame: $("frame").disabled ? false : $("frame").checked, margin: 0.05 });
  }
  function save(canvas, type, quality, name) {
    return viewer.toBlob(canvas, type, quality).then(function (blob) {
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + EXT[type];
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return blob;
    });
  }
  $("btn-preview").addEventListener("click", function () {
    var k = Math.min(1, 560 / poster.w), c = posterCanvas(Math.round(poster.w * k), Math.round(poster.h * k));
    if (!c) return;
    $("poster-img").src = c.toDataURL("image/png"); $("poster-preview").hidden = false;
    $("poster-size").textContent = "Preview of " + poster.w + " × " + poster.h + " px";
  });
  $("btn-poster").addEventListener("click", function () {
    var btn = $("btn-poster"); btn.disabled = true; $("poster-note").textContent = "Drawing…";
    setTimeout(function () {
      try {
        var c = posterCanvas(poster.w, poster.h), name = ($("poster-name").value || "circuit").replace(/[\\\/:*?"<>|]+/g, "_");
        save(c, poster.fmt, poster.quality, name).then(function (blob) {
          $("poster-note").textContent = "Saved " + name + EXT[poster.fmt] + " (" + poster.w + " × " + poster.h + ", " + Math.round(blob.size / 1024) + " KB)";
        }).catch(function (e) { $("poster-note").textContent = "Couldn't make it: " + e.message; }).then(function () { btn.disabled = false; });
      } catch (e) { $("poster-note").textContent = "Couldn't make it: " + e.message; btn.disabled = false; }
    }, 30);
  });

  // ---- start
  mountViewer();
  WebCircuitViewer.preloadFont();
  fetch("webui.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (c) { Object.assign(cfg, c); }).catch(function () {}).then(function () {
    var d = -1; cfg.posterSizes.forEach(function (p, i) { if (p["default"] && d < 0) d = i; });
    poster.size = d < 0 ? 0 : d;
    buildSizes();
    var ex = $("examples");
    cfg.examples.forEach(function (x) {
      var b = el("button", "glass-btn", x.name); b.type = "button";
      b.setAttribute("data-tip", "Opens " + [x.pcb && "the board", x.sch && "the schematic"].filter(Boolean).join(" and ") + " from the blog's site");
      b.addEventListener("click", function () { fetchSet(x.pcb, x.sch); });
      ex.appendChild(b);
    });
    if (!cfg.examples.length) ex.hidden = true;
    var L = cfg.links || {};
    if (L.repository) $("btn-repo").href = L.repository;
    var home = L.blogHome || "/"; $("nav-home").href = home;
    $("nav-back").href = home; $("nav-back").addEventListener("click", function (e) { if (history.length > 1 && document.referrer) { e.preventDefault(); history.back(); } });
    $("foot").innerHTML = 'Viewer: <a href="' + (L.repository || "#") + '" target="_blank" rel="noopener">Web-Circuit-Viewer</a> ' + (window.WebCircuitViewer.version || "") +
      ' · GPL-3.0-or-later · KiCad’s newstroke font · runs in your browser, nothing is uploaded';
    // a link can open files: ?pcb=<url>&sch=<url> (or ?file=<url> for either one)
    var q = new URLSearchParams(location.search), f = q.get("file") || "";
    fetchSet(q.get("pcb") || (kindOf(f) === "pcb" ? f : ""), q.get("sch") || (kindOf(f) === "sch" ? f : ""));
  });
})();
