export type NameMatch<T> = { kind: 'one'; item: T } | { kind: 'many'; items: T[] } | { kind: 'none' };

/**
 * Resolve a name the coordinator typed ("Sam", "maria g") against volunteer names.
 * Exact full-name match wins; otherwise every token must prefix a token of the candidate name.
 */
export function matchName<T extends { name: string }>(query: string, candidates: T[]): NameMatch<T> {
  const q = tokens(query);
  if (q.length === 0) return { kind: 'none' };
  const exact = candidates.filter((c) => tokens(c.name).join(' ') === q.join(' '));
  if (exact.length === 1) return { kind: 'one', item: exact[0]! };
  const hits = candidates.filter((c) => {
    const ct = tokens(c.name);
    return q.every((t) => ct.some((w) => w.startsWith(t)));
  });
  if (hits.length === 1) return { kind: 'one', item: hits[0]! };
  if (hits.length > 1) return { kind: 'many', items: hits };
  return { kind: 'none' };
}

const tokens = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
