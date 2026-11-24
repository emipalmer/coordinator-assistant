import { describe, expect, it } from 'vitest';
import { htmlToText, truncate } from './text.js';

describe('htmlToText', () => {
  it('keeps paragraphs and list items, drops tags and scripts', () => {
    const t = htmlToText('<p>Read <b>ch. 4</b></p><script>alert(1)</script><ul><li>Q1</li><li>Q2</li></ul>');
    expect(t).toBe('Read ch. 4\n- Q1\n- Q2');
  });
  it('decodes entities and keeps link targets', () => {
    expect(htmlToText('Tom &amp; Jerry&#39;s <a href="https://x.edu/a">rubric</a>')).toBe("Tom & Jerry's rubric (https://x.edu/a)");
  });
});

describe('truncate', () => {
  it('marks cut text', () => {
    expect(truncate('abcdef', 3)).toBe('abc… [truncated, 3 more chars]');
    expect(truncate('abc', 3)).toBe('abc');
  });
});
