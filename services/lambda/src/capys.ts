import type { Logger } from '@app/core';
import type { CapyDoc, Collections } from './db.js';
import { linkTo, putFile, type StoredFile } from './files.js';

// The capybara stash: S3 `stash/` plus a `capys` row per picture. Stocked automatically from capy.lol
// (a free, curated capybara photo API) by the ticker; the owner can add their own by texting them in.
const CAPY_API = 'https://api.capy.lol/v1';
export const STASH_TARGET = 200;
const PER_TICK = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const CAPTIONS = [
  'capy break',
  'your scheduled capybara has arrived',
  'pov: you are a capybara and nothing is wrong',
  'capybara check-in',
  'this one is simply vibing',
  'mandatory capy break, doctor’s orders',
  'he’s just like you fr',
  'sending a capybara bc you deserve it',
  'capy delivery',
  'be calm like this capybara',
  'one (1) capybara for you',
  'current mood tbh',
  'the capybara says you’re doing great',
  'capybara intermission',
  'quick capy before you get back to it',
];
export const randomCaption = () => CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)]!;

interface CapyLolItem { index: number; width: number; height: number; alt?: string }
let catalog: CapyLolItem[] | undefined;
let full = false;

const fetchOk = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'StarAssistant/1.0 (personal hobby project)' } });
  if (!res.ok) throw new Error(`capy.lol ${res.status}`);
  return res;
};

/** Add a few capy.lol pictures per call until the stash reaches its target. Returns how many were added. */
export async function stockStash(c: Collections, log: Logger): Promise<number> {
  if (full) return 0;
  const have = await c.capys.distinct('_id', { source: 'capy.lol' });
  if (have.length >= STASH_TARGET) {
    full = true;
    return 0;
  }
  if (!catalog) {
    const body = (await (await fetchOk(`${CAPY_API}/capybaras?take=2000&from=0`)).json()) as { data?: CapyLolItem[] };
    // Tiny or unknown-size images look bad on a phone.
    catalog = (body.data ?? []).filter((i) => Number.isInteger(i.index) && i.width >= 400 && i.height >= 400);
  }
  const taken = new Set(have);
  const fresh = catalog.filter((i) => !taken.has(`capy-${i.index}`));
  let added = 0;
  // Stay well inside the ticker's timeout; the rest comes next minute.
  const stopAt = Date.now() + 20_000;
  for (let n = 0; n < PER_TICK && fresh.length && Date.now() < stopAt; n++) {
    const item = fresh.splice(Math.floor(Math.random() * fresh.length), 1)[0]!;
    try {
      const res = await fetchOk(`${CAPY_API}/capybara/${item.index}`);
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      const ext = TYPES[type];
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!ext || bytes.length > MAX_BYTES) continue;
      const key = `stash/capy-${item.index}.${ext}`;
      await putFile(key, bytes, type);
      await c.capys.updateOne(
        { _id: `capy-${item.index}` },
        { $setOnInsert: { key, source: 'capy.lol', addedAt: new Date(), sends: 0, ...(item.alt && { alt: item.alt.slice(0, 300) }) } },
        { upsert: true },
      );
      added++;
    } catch (err) {
      log.warn('capy stock failed', { index: item.index, err });
    }
  }
  if (!fresh.length) full = true;
  return added;
}

/** A picture sent least often so far (random among those), counted as sent. */
export async function pickCapy(c: Collections, now: Date): Promise<CapyDoc | null> {
  const [doc] = await c.capys
    .aggregate<CapyDoc>([{ $match: { removedAt: { $exists: false } } }, { $sort: { sends: 1 } }, { $limit: 40 }, { $sample: { size: 1 } }])
    .toArray();
  if (!doc) return null;
  await c.capys.updateOne({ _id: doc._id }, { $inc: { sends: 1 }, $set: { lastSentAt: now } });
  return doc;
}

export const capyFile = (doc: CapyDoc): Promise<StoredFile> => linkTo(doc.key, `capybara.${doc.key.split('.').pop() ?? 'jpg'}`);

export const stashSize = (c: Collections) => c.capys.countDocuments({ removedAt: { $exists: false } });

/** How a sent picture is noted in the conversation, so "aww" or "not that one again" has context. */
export const sentNote = (doc: CapyDoc) => `[sent capybara pic ${doc._id}${doc.alt ? `: ${doc.alt.slice(0, 160)}` : ''}]`;
