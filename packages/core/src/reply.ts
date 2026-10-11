const DRAFT = /\[\[draft\]\]([\s\S]*?)\[\[\/draft\]\]/g;

/**
 * Split the model's reply into iMessage bubbles, in reading order. Volunteer-facing drafts get
 * their own bubble so the coordinator can long-press -> copy -> forward without editing, and each
 * draft lands right under the line that introduces it.
 */
export function splitReply(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(DRAFT)) {
    out.push(text.slice(last, m.index));
    out.push(m[1]!);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out.map((s) => s.replace(/\n{3,}/g, '\n\n').trim()).filter(Boolean);
}
