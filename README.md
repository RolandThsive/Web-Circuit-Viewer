# Web-Circuit-Viewer

A very small web viewer for KiCad boards (`.kicad_pcb`) and schematics (`.kicad_sch`), made for the
[RO'H'BOTS](https://ro-h-bots.blogspot.com) blog. One file, no libraries, about 15 KB gzipped.

What it does

- Boards: copper tracks, vias, pads (with drill holes), filled zones, silkscreen, outline and the other layers.
  A **Layers** button switches layers on and off (Front / Back / All shortcuts).
- Schematics: symbols, pins with names and numbers, wires, buses, junctions, no-connects, labels, notes,
  the page frame and the title block.
- Zoom (wheel, buttons, pinch, double-click), pan (drag), **Fit**.
- Hover a part (tap on a phone) to see its reference and value, for example `U2 · DRV8833PWP`.
- Text is drawn in a plain font, not KiCad's stroke font.

What it does not do (on purpose, to stay small): 3D, hierarchical sheet navigation, net highlighting,
measuring, printing, KiCad's exact stroke font, custom colour themes.

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

`WebCircuitViewer.mount(element, url, { frame: true|false })` – `frame` draws the page border and title block
(on for schematics, off for boards unless asked).

The file is fetched with `fetch`, so it has to be on the same site or on a site that allows cross-origin
reads (GitHub Pages does).

## Files

- `web-circuit-viewer.js` – the viewer.
- `test/` – a test page (`index.html`, shows the Thermometer board and schematic from the blog site) and the
  screenshot script.

Tested with KiCad 9 files (format 20260206 / 20260306).

## Licence

GNU General Public License v3.0 or later, the same licence as KiCad. See `LICENSE`.
Copyright (C) 2026 RolandThsive.
