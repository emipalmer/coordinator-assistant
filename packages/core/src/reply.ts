const DRAFT = /\[\[draft\]\]([\s\S]*?)\[\[\/draft\]\]/g;

/**
 * Split the model's reply into iMessage bubbles. Volunteer-facing drafts get their own bubble
 * so the coordinator can long-press -> copy -> forward without editing.
 */
export function splitReply(text: string): string[] {
  const drafts = [...text.matchAll(DRAFT)].map((m) => m[1]!.trim()).filter(Boolean);
  const main = text.replace(DRAFT, '').replace(/\n{3,}/g, '\n\n').trim();
  return [main, ...drafts].filter(Boolean);
}
