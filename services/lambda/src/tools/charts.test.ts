import { describe, expect, it } from 'vitest';
import { periodKeys } from './charts.js';

describe('periodKeys', () => {
  it('lists every month start in range, so empty months chart as zero', () => {
    expect(periodKeys('2026-07-15', '2026-10-11', 'month')).toEqual(['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
  });
  it('lists Sunday-start weeks', () => {
    expect(periodKeys('2026-10-01', '2026-10-11', 'week')).toEqual(['2026-09-27', '2026-10-04', '2026-10-11']);
  });
});
