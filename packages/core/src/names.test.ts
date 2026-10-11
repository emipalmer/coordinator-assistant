import { describe, expect, it } from 'vitest';
import { matchName } from './names.js';

const people = [{ name: 'Sam Rivera' }, { name: 'Maria Gonzalez' }, { name: 'Maria Chen' }, { name: 'Samantha Lee' }];

describe('matchName', () => {
  it('resolves an unambiguous first name prefix', () => {
    expect(matchName('maria g', people)).toEqual({ kind: 'one', item: people[1] });
  });
  it('reports ambiguity instead of guessing', () => {
    expect(matchName('Maria', people).kind).toBe('many');
    expect(matchName('Sam', people).kind).toBe('many'); // Sam Rivera and Samantha Lee
  });
  it('prefers an exact full name', () => {
    expect(matchName('sam rivera', people)).toEqual({ kind: 'one', item: people[0] });
  });
  it('returns none for unknown names', () => {
    expect(matchName('Zed', people).kind).toBe('none');
  });
});
