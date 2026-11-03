#!/usr/bin/env python3
"""Builds newstroke.js (the KiCad stroke font for Web-Circuit-Viewer) from KiCad's common/newstroke_font.cpp.

    python3 -I tools/make_font.py path/to/newstroke_font.cpp > newstroke.js

Glyph index in KiCad's table = code point - 32. Only the ranges below are kept (about 16 KB gzipped);
anything else is drawn as "?" by the viewer. Add a range here to cover more characters."""
import json, re, sys
RANGES = [(0x20, 0x24F), (0x370, 0x3FF), (0x400, 0x45F), (0x2010, 0x205E), (0x2070, 0x20BF), (0x2100, 0x214F),
          (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2300, 0x233F), (0x25A0, 0x25FF), (0x2600, 0x2642)]
src = open(sys.argv[1], encoding="utf-8").read()
body = src[src.index("newstroke_font[] ="):]
glyphs = [re.sub(r"\\(.)", lambda m: m.group(1), g) for g in re.findall(r'"((?:[^"\\]|\\.)*)"', body)]
out = [[a, "\n".join(glyphs[a - 32:b - 32 + 1])] for a, b in RANGES]
sys.stdout.write("/*! newstroke.js - the KiCad stroke font (newstroke, by Vladimir Uryvaev and the KiCad developers,\n"
 " * CC0 1.0 / GPL-compatible) in Hershey encoding, for Web-Circuit-Viewer. Covers Latin, Greek, Cyrillic,\n"
 " * punctuation, currency, letterlike (ohm), arrows, maths, diameter and geometric shapes; other characters\n"
 " * fall back to \"?\". Generated from KiCad's common/newstroke_font.cpp by tools/make_font.py. */\n")
sys.stdout.write("window.WCV_FONT=" + json.dumps(out, separators=(",", ":")) + ";\n")
