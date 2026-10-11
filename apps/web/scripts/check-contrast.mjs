// WCAG 2.1 relative-luminance contrast check for the console palette.
// Verifies the claims written into app.css rather than trusting arithmetic.

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const T = {
  card: '#ffffff', app: '#fbf8f3', canvas: '#f1ece2', sunken: '#f2ede4',
  sidebarBg: '#2a5e4b', sidebarActive: '#356b57', sidebarInk: '#dcebe3',
  ink: '#2b3b33', ink2: '#58685f', ink3: '#5f6e65', white: '#ffffff',
  green: '#2b7a5c', greenDim: '#e9f4ee',
  orange: '#d4764b', orangeStrong: '#b85633', orangeInk: '#a64d29', orangeDim: '#fdf0e9',
  tanChip: '#f0e8da',
};

// [label, foreground, background, minimum]
// 4.5 = normal text, 3.0 = large/bold text and UI component boundaries.
const CHECKS = [
  ['body ink on card', T.ink, T.card, 4.5],
  ['body ink on app bg', T.ink, T.app, 4.5],
  ['secondary ink on card', T.ink2, T.card, 4.5],
  ['muted hint on card', T.ink3, T.card, 4.5],
  ['muted hint on app bg', T.ink3, T.app, 4.5],
  ['muted hint on sunken', T.ink3, T.sunken, 4.5],
  ['green text on card', T.green, T.card, 4.5],
  ['green text on green-dim pill', T.green, T.greenDim, 4.5],
  ['orange text on card', T.orangeInk, T.card, 4.5],
  ['orange text on orange-dim pill', T.orangeInk, T.orangeDim, 4.5],
  ['orange text on app bg', T.orangeInk, T.app, 4.5],
  ['white on orange CTA', T.white, T.orangeStrong, 4.5],
  ['secondary ink on tan chip', T.ink2, T.tanChip, 4.5],
  ['sidebar ink on sidebar', T.sidebarInk, T.sidebarBg, 4.5],
  ['sidebar ink on active tab', T.sidebarInk, T.sidebarActive, 4.5],
  ['white on sidebar', T.white, T.sidebarBg, 4.5],
  ['green mark vs card (non-text)', T.green, T.card, 3.0],
  ['orange mark vs card (non-text)', T.orange, T.card, 3.0],
  ['orange mark vs app bg (non-text)', T.orange, T.app, 3.0],
];

let fails = 0;
for (const [label, fg, bg, min] of CHECKS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`);
}
console.log(`\n${CHECKS.length - fails}/${CHECKS.length} pass`);
process.exit(fails ? 1 : 0);
