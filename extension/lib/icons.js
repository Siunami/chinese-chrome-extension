// The app's icons, drawn rather than typed.
//
// These used to be characters — a full-width ＋, a ✕, and 🕘, which the platform
// renders as a colour emoji at whatever size and baseline it likes — so three
// controls sitting together in the tutor's header were three different sizes,
// weights and colour systems. One 16px grid, stroked in the current colour,
// means a row of buttons looks like a row of buttons.
//
// Stroke, width and linecaps are set in CSS (`fill: none; stroke: currentColor`)
// wherever an icon is used, so an icon inherits the colour of the control it
// sits in, including on hover.

const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  plus: [['path', { d: 'M8 3.4v9.2M3.4 8h9.2' }]],
  clock: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M8 4.9V8.2l2.2 1.3' }]],
  close: [['path', { d: 'M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2' }]],
  back: [['path', { d: 'M9.6 3.6L5.2 8l4.4 4.4' }]],
  image: [
    ['rect', { x: 2.6, y: 3.2, width: 10.8, height: 9.6, rx: 1.8 }],
    ['circle', { cx: 5.9, cy: 6.4, r: 1 }],
    ['path', { d: 'M13.4 10.1L10.3 7 4 12.8' }],
  ],
  chat: [['path', {
    d: 'M13.4 9a2 2 0 0 1-2 2H6.2l-3.6 2.5V4.4a2 2 0 0 1 2-2h6.8a2 2 0 0 1 2 2z',
  }]],
  // Something needs attention. A triangle rather than a circle: it reads as a
  // warning at 14px where an (!) in a circle reads as "more information".
  warn: [
    ['path', { d: 'M8 2.6L14.2 13H1.8z' }],
    ['path', { d: 'M8 6.4v3.1' }],
    ['path', { d: 'M8 11.4v0.1' }],
  ],
};

export function icon(name, size = 15) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of PATHS[name]) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  return svg;
}
