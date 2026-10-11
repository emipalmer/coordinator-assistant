// Dependency-free SVG charts. Same output feeds the iMessage PNG (via resvg) and any HTML page.
// Specs follow the reference data-viz palette: thin marks, 4px rounded data ends, hairline grid,
// text in ink tokens (never series color), legend only for 2+ series.

export type ChartKind = 'column' | 'bar' | 'line';

export interface ChartSpec {
  kind: ChartKind;
  title: string;
  subtitle?: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  unit?: string; // e.g. "h" or "$"
}

export interface ChartTheme {
  surface: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  grid: string;
  axis: string;
  series: string[];
  font: string;
}

/** Light theme from the validated reference palette; PNGs in iMessage are always light. */
export const LIGHT_THEME: ChartTheme = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  inkMuted: '#8a8984',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  // First three slots validate all-pairs; charts are capped at three series.
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  font: 'Inter',
};

export const MAX_SERIES = 3;
export const MAX_POINTS = 24;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Clean axis maximum and tick step (1/2/2.5/5 x 10^n). */
export function niceScale(max: number, targetTicks = 4): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 1 };
  const raw = max / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { max: Math.ceil(max / step) * step, step };
}

/** Compact tick/value text: 950, 1.2K, $3.4K. */
export function formatValue(v: number, unit?: string): string {
  const abs = Math.abs(v);
  const n = abs >= 1000 ? `${(v / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K` : String(Math.round(v * 10) / 10);
  if (unit === '$') return `$${n}`;
  return unit ? `${n}${unit === 'h' ? 'h' : ` ${unit}`}` : n;
}

export function validateSpec(spec: ChartSpec): string | null {
  if (!spec.labels.length) return 'no data points';
  if (spec.labels.length > MAX_POINTS) return `too many points (max ${MAX_POINTS})`;
  if (!spec.series.length || spec.series.length > MAX_SERIES) return `1 to ${MAX_SERIES} series`;
  for (const s of spec.series) {
    if (s.values.length !== spec.labels.length) return `series "${s.name}" has ${s.values.length} values for ${spec.labels.length} labels`;
    if (s.values.some((v) => !Number.isFinite(v) || v < 0)) return `series "${s.name}" has negative or invalid values`;
  }
  if (spec.kind === 'bar' && spec.series.length > 1) return 'horizontal bar charts take one series';
  return null;
}

/** Rounded data end, square at the baseline (vertical column). */
function columnPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Rounded data end on the right (horizontal bar). */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

export function renderChartSvg(spec: ChartSpec, theme: ChartTheme = LIGHT_THEME, width = 800): string {
  const err = validateSpec(spec);
  if (err) throw new Error(`Invalid chart: ${err}`);
  return spec.kind === 'bar' ? barChart(spec, theme, width) : xyChart(spec, theme, width);
}

function header(spec: ChartSpec, t: ChartTheme, width: number) {
  const parts = [`<rect width="${width}" height="100%" fill="${t.surface}"/>`];
  parts.push(`<text x="32" y="44" font-size="22" font-weight="600" fill="${t.ink}">${esc(spec.title)}</text>`);
  if (spec.subtitle) parts.push(`<text x="32" y="70" font-size="14" fill="${t.inkSecondary}">${esc(spec.subtitle)}</text>`);
  return parts;
}

function legend(spec: ChartSpec, t: ChartTheme, y: number) {
  if (spec.series.length < 2) return [];
  let x = 32;
  return spec.series.flatMap((s, i) => {
    const out = [
      `<rect x="${x}" y="${y - 9}" width="12" height="12" rx="3" fill="${t.series[i]}"/>`,
      `<text x="${x + 18}" y="${y + 1}" font-size="13" fill="${t.inkSecondary}">${esc(s.name)}</text>`,
    ];
    x += 18 + s.name.length * 7.5 + 24;
    return out;
  });
}

function xyChart(spec: ChartSpec, t: ChartTheme, width: number) {
  const height = 460;
  const top = spec.subtitle ? 100 : 80;
  const legendY = top + 4;
  const plotTop = top + (spec.series.length > 1 ? 34 : 14);
  const left = 64;
  const right = width - 32;
  const bottom = height - 56;
  const all = spec.series.flatMap((s) => s.values);
  const { max, step } = niceScale(Math.max(...all));
  const y = (v: number) => bottom - (v / max) * (bottom - plotTop);
  const band = (right - left) / spec.labels.length;
  const cx = (i: number) => left + band * i + band / 2;

  const parts = header(spec, t, width);
  parts.push(...legend(spec, t, legendY));
  for (let v = 0; v <= max + 1e-9; v += step) {
    const yy = y(v);
    parts.push(`<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" stroke="${v === 0 ? t.axis : t.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${left - 10}" y="${yy + 4}" font-size="12" text-anchor="end" fill="${t.inkMuted}">${formatValue(v, spec.unit)}</text>`);
  }
  // Thin x labels when crowded so they never collide.
  const every = Math.ceil(spec.labels.length / Math.floor((right - left) / 56));
  spec.labels.forEach((l, i) => {
    if (i % every !== 0 && i !== spec.labels.length - 1) return;
    parts.push(`<text x="${cx(i)}" y="${bottom + 22}" font-size="12" text-anchor="middle" fill="${t.inkSecondary}">${esc(l)}</text>`);
  });

  if (spec.kind === 'column') {
    const n = spec.series.length;
    const groupW = Math.min(band * 0.7, n * 24 + (n - 1) * 2);
    const w = (groupW - (n - 1) * 2) / n;
    spec.series.forEach((s, si) =>
      s.values.forEach((v, i) => {
        if (v <= 0) return;
        const x = cx(i) - groupW / 2 + si * (w + 2);
        parts.push(`<path d="${columnPath(x, y(v), w, bottom - y(v))}" fill="${t.series[si]}"><title>${esc(`${spec.labels[i]}: ${formatValue(v, spec.unit)}`)}</title></path>`);
      }),
    );
    // Label only the peak and the latest value of the first series.
    const s0 = spec.series[0]!.values;
    const peak = s0.indexOf(Math.max(...s0));
    for (const i of new Set([peak, s0.length - 1])) {
      if (s0[i]! <= 0) continue;
      const x = cx(i) - groupW / 2 + w / 2;
      parts.push(`<text x="${x}" y="${y(s0[i]!) - 8}" font-size="12" font-weight="600" text-anchor="middle" fill="${t.ink}">${formatValue(s0[i]!, spec.unit)}</text>`);
    }
  } else {
    spec.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${cx(i)},${y(v)}`).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="${t.series[si]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
      const last = s.values.length - 1;
      parts.push(`<circle cx="${cx(last)}" cy="${y(s.values[last]!)}" r="5" fill="${t.series[si]}" stroke="${t.surface}" stroke-width="2"/>`);
      parts.push(`<text x="${cx(last) - 8}" y="${y(s.values[last]!) - 12}" font-size="12" font-weight="600" text-anchor="end" fill="${t.ink}">${formatValue(s.values[last]!, spec.unit)}</text>`);
    });
  }
  return wrap(parts, width, height, t);
}

function barChart(spec: ChartSpec, t: ChartTheme, width: number) {
  const values = spec.series[0]!.values;
  const rowH = 36;
  const top = spec.subtitle ? 100 : 80;
  const height = top + values.length * rowH + 32;
  const labelW = Math.min(220, Math.max(...spec.labels.map((l) => l.length)) * 7.5 + 16);
  const left = 32 + labelW;
  const right = width - 96;
  const { max } = niceScale(Math.max(...values));
  const parts = header(spec, t, width);
  parts.push(`<line x1="${left}" x2="${left}" y1="${top}" y2="${top + values.length * rowH}" stroke="${t.axis}" stroke-width="1"/>`);
  values.forEach((v, i) => {
    const yy = top + i * rowH + (rowH - 20) / 2;
    const w = (v / max) * (right - left);
    parts.push(`<text x="${left - 12}" y="${yy + 14}" font-size="13" text-anchor="end" fill="${t.inkSecondary}">${esc(spec.labels[i]!)}</text>`);
    if (w > 0) parts.push(`<path d="${barPath(left, yy, w, 20)}" fill="${t.series[0]}"><title>${esc(`${spec.labels[i]}: ${formatValue(v, spec.unit)}`)}</title></path>`);
    parts.push(`<text x="${left + w + 8}" y="${yy + 14}" font-size="13" font-weight="600" fill="${t.ink}">${formatValue(v, spec.unit)}</text>`);
  });
  return wrap(parts, width, height, t);
}

function wrap(parts: string[], width: number, height: number, t: ChartTheme) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${t.font}, -apple-system, Helvetica, Arial, sans-serif">${parts.join('')}</svg>`;
}
