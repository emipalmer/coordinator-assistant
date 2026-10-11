import { describe, expect, it } from 'vitest';
import { formatValue, niceScale, renderChartSvg, validateSpec } from './charts.js';

describe('niceScale', () => {
  it('rounds the axis max to a clean step', () => {
    expect(niceScale(52.5)).toEqual({ max: 60, step: 20 });
    expect(niceScale(7)).toEqual({ max: 8, step: 2 });
    expect(niceScale(0)).toEqual({ max: 1, step: 1 });
  });
});

describe('formatValue', () => {
  it('compacts thousands and applies units', () => {
    expect(formatValue(1826.48, '$')).toBe('$1.8K');
    expect(formatValue(12.5, 'h')).toBe('12.5h');
    expect(formatValue(12000)).toBe('12K');
  });
});

describe('validateSpec', () => {
  const base = { kind: 'column' as const, title: 't', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] };
  it('accepts a well-formed spec', () => expect(validateSpec(base)).toBeNull());
  it('rejects mismatched lengths, too many series, negatives', () => {
    expect(validateSpec({ ...base, series: [{ name: 's', values: [1] }] })).toMatch(/1 values for 2 labels/);
    expect(validateSpec({ ...base, series: Array(4).fill({ name: 's', values: [1, 2] }) })).toMatch(/1 to 3 series/);
    expect(validateSpec({ ...base, series: [{ name: 's', values: [1, -2] }] })).toMatch(/negative/);
  });
});

describe('renderChartSvg', () => {
  it('produces well-formed SVG with escaped text for each kind', () => {
    for (const kind of ['column', 'bar', 'line'] as const) {
      const svg = renderChartSvg({ kind, title: 'Hours <by> month & more', labels: ['Jul', 'Aug', 'Sep'], series: [{ name: 'Hours', values: [10, 0, 52.5] }], unit: 'h' });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('Hours &lt;by&gt; month &amp; more');
      expect(svg).not.toContain('NaN');
    }
  });
  it('shows a legend only for multiple series', () => {
    const one = renderChartSvg({ kind: 'line', title: 't', labels: ['a', 'b'], series: [{ name: 'Alpha', values: [1, 2] }] });
    const two = renderChartSvg({ kind: 'line', title: 't', labels: ['a', 'b'], series: [{ name: 'Alpha', values: [1, 2] }, { name: 'Beta', values: [2, 1] }] });
    expect(one).not.toContain('>Alpha<');
    expect(two).toContain('>Alpha<');
  });
});
