# Web-Circuit-Viewer

A very small web viewer for KiCad boards (`.kicad_pcb`) and schematics (`.kicad_sch`), made for the
[RO'H'BOTS](https://ro-h-bots.blogspot.com) blog. No libraries: the viewer (about 16 KB gzipped) plus KiCad's
own stroke font (`newstroke.js`, about 16 KB gzipped), fetched from the same folder.

**Use it online:** https://RolandThsive.github.io/Web-Circuit-Viewer/WebUI/ — open a `.kicad_pcb` or `.kicad_sch`
(nothing is uploaded), look around, and make posters of it. A link can open files directly:
`WebUI/?pcb=<url>&sch=<url>`.

What it does

- Boards: copper tracks, vias, pads (with drill holes), filled zones, silkscreen, outline and the other layers.
  A **Layers** button switches layers on and off (Front / Back / All shortcuts).
- Schematics: symbols, pins with names and numbers, wires, buses, junctions, no-connects, labels, notes,
  the page frame and the title block.
- Zoom (wheel, − / + top right, pinch, double-click), pan (drag), **Fit**, **Flip** (the board seen from the back: mirrored,
  the back copper and silkscreen on top, back-side text readable).
- Hover a part (tap on a phone) to see its reference and value, for example `U2 · DRV8833PWP`.
- Posters: `render()` draws the circuit into a picture of any size (the page's Poster panel: large, square,
  wide or custom, which starts at the blog poster's 1430 × 1016; WebP / PNG / JPEG; everything or the current view; see-through background with the board's shape kept
  and the holes punched through).
- Text is drawn with KiCad's own stroke font (newstroke), so boards and schematics look as they do in KiCad.
  Until the font file has arrived (or if it cannot be fetched) a plain font stands in.

What it does not do (on purpose, to stay small): 3D, hierarchical sheet navigation, net highlighting,
measuring, printing, custom colour themes. The font covers Latin, Greek, Cyrillic, punctuation, currency,
Ω and other letterlike symbols, arrows, maths, ⌀ and geometric shapes; other characters show as "?"
(add a range in `tools/make_font.py` to cover more).

## Use

```html
<script src="https://RolandThsive.github.io/Web-Circuit-Viewer/web-circuit-viewer.js"></script>
<web-circuit-viewer src="TheMainBoard.kicad_pcb" style="display:block;height:600px"></web-circuit-viewer>
```

or from a script:

```js
var v = WebCircuitViewer.mount(document.getElementById("box"), "TheMainBoard.kicad_sch");
v.load("other.kicad_pcb");   // show another file in the same box
v.fit();                     // show everything
v.destroy();
```

`WebCircuitViewer.mount(element, url, { frame, font, onLoad, onError, onLayers })` returns a viewer with
`load(url)`, `loadText(text, name)`, `fit()`, `flip()`, `focus("U2")`, `zoom(1.4)`, `setLayer("B.Cu", false)`, `info()`,
`render({ width, height, view: "fit"|"current", background: "auto"|"transparent"|colour, frame, board })` → canvas,
`toBlob(canvas, type, quality)` and `destroy()`. – `frame` draws the page border
and title block (on for schematics, off for boards unless asked); `font: false` keeps the plain font and skips the
font file. `WebCircuitViewer.preloadFont()` fetches the font early. When the box changes size (full screen, a
phone turning) the drawing keeps its middle and scale, so a fitted board stays fitted.

The file is fetched with `fetch`, so it has to be on the same site or on a site that allows cross-origin
reads (GitHub Pages does).

## Files

- `web-circuit-viewer.js` – the viewer.
- `WebUI/` – the Web Circuit Viewer page (index.html, WebUI.css, WebUI.js, webui.json with the examples and poster
  sizes, logo.svg) and `BloggerPage.html`, the page that embeds it in the blog.
- `newstroke.js` – the font, built from KiCad's `common/newstroke_font.cpp` by `tools/make_font.py`.
- `test/` – a test page (`index.html`, shows the Thermometer board and schematic from the blog site) and the
  screenshot script.

Tested with KiCad 9 files (format 20260206 / 20260306).

## Licence

GNU General Public License v3.0 or later, the same licence as KiCad. See `LICENSE`.
Copyright (C) 2026 RolandThsive. The newstroke font is by Vladimir Uryvaev and the KiCad developers (CC0 1.0).
