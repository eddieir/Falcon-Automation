"use strict";
/** Geometry of the two video formats. Every rectangle is in output pixels. */

const rect = (x, y, w, h) => ({ x, y, w, h });

const WIDE = {
  name: "wide",
  size: { w: 1920, h: 1080 },
  seconds: [90, 120],
  header: { rect: rect(48, 20, 1824, 112), titleSize: 56, subSize: 28 },
  label: { h: 34, size: 20 },
  slots: {
    app: rect(48, 176, 864, 486),
    dashSummary: rect(960, 176, 912, 160),
    dashLocator: rect(960, 380, 912, 251),
    terminal: rect(48, 674, 1824, 250),
    caption: rect(48, 940, 1824, 124),
    body: rect(48, 150, 1824, 774),
    bodyLeft: rect(48, 150, 900, 774),
    bodyRight: rect(972, 150, 900, 774),
    bodyTop: rect(48, 150, 1824, 500),
    hero: rect(48, 150, 1824, 774),
    terminalWide: rect(48, 150, 1824, 774),
    locBig: rect(48, 176, 1100, 302),
    sideCard: rect(1176, 150, 696, 500),
    bottomLeft: rect(48, 674, 1100, 250),
    bottomRight: rect(1176, 674, 696, 250),
  },
  terminal: { headSize: 20, size: 20, lineH: 26, rows: 7 },
  caption: { size: 38 },
  card: { size: 28, headSize: 20 },
  crop: { dashLocator: { w: 1200, h: 330 } },
};

const PORTRAIT = {
  name: "portrait",
  size: { w: 1080, h: 1350 },
  seconds: [45, 60],
  header: { rect: rect(40, 26, 1000, 150), titleSize: 54, subSize: 30 },
  label: { h: 34, size: 22 },
  slots: {
    app: rect(90, 214, 900, 506),
    dashSummary: rect(40, 764, 1000, 175),
    dashLocator: rect(40, 214, 1000, 275),
    bottomCard: rect(40, 950, 1000, 236),
    body: rect(40, 190, 1000, 990),
    caption: rect(40, 1196, 1000, 132),
  },
  terminal: { headSize: 22, size: 22, lineH: 30, rows: 10 },
  caption: { size: 40 },
  card: { size: 30, headSize: 22 },
  crop: { dashLocator: { w: 1200, h: 330 } },
};

module.exports = { WIDE, PORTRAIT, rect };
