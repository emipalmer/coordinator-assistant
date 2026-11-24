import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ASSISTANT_NAME, CATEGORY_NAMES, MAX_MEMORIES, type OwnerProfile } from '@app/core';
import { defineTool } from './registry.js';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const isZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const savePreferences = defineTool({
  name: 'save_preferences',
  description:
    `Save how the owner likes ${ASSISTANT_NAME} to work: name, timezone (IANA, e.g. America/New_York), reply length, emoji, morning briefing, Canvas deadline nudges, their usual day (for meeting suggestions), weather place, which calendar each event category goes on, how many capybara pics a day, and how many pep talks a day. Only the fields given are changed. Call as answers arrive; set setupComplete when the setup questions are done.`,
  input: z.object({
    name: z.string().min(1).max(60).optional(),
    timezone: z.string().refine(isZone, 'not an IANA timezone').optional(),
    replyLength: z.enum(['brief', 'detailed']).optional(),
    emoji: z.boolean().optional(),
    morningBriefing: z.boolean().optional().describe('Whether to send the 8am briefing (calendar, Canvas due dates, important mail)'),
    deadlineNudges: z.boolean().optional().describe('Texts 8pm the night before and 3 hours before Canvas deadlines (on unless turned off)'),
    dayStart: HHMM.optional().describe('When their day usually starts, "HH:mm"'),
    dayEnd: HHMM.optional().describe('When they usually wind down, "HH:mm"'),
    weatherPlace: z.string().min(2).max(100).optional().describe('e.g. "State College, PA"'),
    calendarFor: z
      .record(z.enum(CATEGORY_NAMES), z.string().min(1).max(300))
      .optional()
      .describe('Category -> calendar id (from list_calendars), e.g. {"work":"abc@group.calendar.google.com"}. Use "primary" to reset one.'),
    capysPerDay: z.number().int().min(0).max(12).optional().describe('Capybara pics a day at random times between 10am and 9pm (default 3, 0 = off)'),
    pepTalksPerDay: z.number().int().min(0).max(6).optional().describe('Encouraging texts a day at random times between 9:30am and 8pm, sometimes with an upcoming-event heads-up (default 2, 0 = off)'),
    setupComplete: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const { name, timezone, setupComplete, calendarFor, ...prefs } = input;
    const set: Record<string, unknown> = Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== undefined).map(([k, v]) => [`prefs.${k}`, v]));
    for (const [cat, id] of Object.entries(calendarFor ?? {})) set[`prefs.calendarFor.${cat}`] = id;
    if (name) set.name = name;
    if (timezone) set.timezone = timezone;
    if (setupComplete) set.onboardedAt = new Date();
    const hasPrefs = Object.keys(set).some((k) => k.startsWith('prefs.'));
    await ctx.c.profiles.updateOne(
      { _id: ctx.owner },
      {
        ...(Object.keys(set).length && { $set: set }),
        // Only seed an empty prefs object when no prefs.* path is being set (Mongo rejects the overlap).
        $setOnInsert: { createdAt: new Date(), ...(!hasPrefs && { prefs: {} }) },
      },
      { upsert: true },
    );
    return { ok: true, content: JSON.stringify({ saved: input }) };
  },
});

export const remember = defineTool({
  name: 'remember',
  description:
    'Save a durable fact the owner wants remembered across conversations (people, places, routines, preferences: "my advisor is Dr. Lee", "I work Tue/Thu 4-8"). One fact per call, in third person, short. Not for one-off tasks or anything sensitive like passwords or ID numbers.',
  input: z.object({ fact: z.string().min(3).max(300) }),
  async run(ctx, input) {
    const profile = await ctx.c.profiles.findOne({ _id: ctx.owner }, { projection: { memories: 1 } });
    if ((profile?.memories?.length ?? 0) >= MAX_MEMORIES) return { ok: false, content: `Memory is full (${MAX_MEMORIES}). Ask which old facts to forget.` };
    const id = randomBytes(3).toString('hex');
    await ctx.c.profiles.updateOne(
      { _id: ctx.owner },
      { $push: { memories: { id, text: input.fact, at: new Date() } }, $setOnInsert: { createdAt: new Date(), prefs: {} } },
      { upsert: true },
    );
    return { ok: true, content: JSON.stringify({ remembered: input.fact, id }) };
  },
});

export const forget = defineTool({
  name: 'forget',
  description: 'Remove a remembered fact by its id (ids are listed with each memory in the system prompt).',
  input: z.object({ id: z.string().regex(/^[a-f0-9]{6}$/) }),
  async run(ctx, input) {
    const r = await ctx.c.profiles.updateOne({ _id: ctx.owner }, { $pull: { memories: { id: input.id } } });
    return { ok: true, content: r.modifiedCount ? 'Forgotten.' : 'No memory with that id.' };
  },
});

export const PROFILE_TOOLS = [savePreferences, remember, forget];

/** Stable per owner, so it can live in the cached system prompt. */
export function profileBlock(p: OwnerProfile | null): string {
  const lines = [
    p?.name && `- Their name is ${p.name}.`,
    p?.prefs?.replyLength === 'brief' && '- Keep replies very short: a sentence or two unless they ask for more.',
    p?.prefs?.replyLength === 'detailed' && '- They like fuller replies with the key details spelled out.',
    p?.prefs?.emoji === false && '- No emoji.',
    p?.prefs?.emoji === true && '- A friendly emoji now and then is welcome.',
    (p?.prefs?.dayStart || p?.prefs?.dayEnd) && `- Their usual day: ${p.prefs.dayStart ?? '?'} to ${p.prefs.dayEnd ?? '?'}. Don't suggest plans outside it unless they ask.`,
    p?.prefs?.weatherPlace && `- Weather location: ${p.prefs.weatherPlace}.`,
    p?.prefs?.deadlineNudges === false && '- Canvas deadline nudges are off.',
    p?.prefs?.pepTalksPerDay !== undefined && (p.prefs.pepTalksPerDay === 0 ? '- Pep talks are off.' : `- Pep talks: ${p.prefs.pepTalksPerDay} a day.`),
    p?.prefs?.capysPerDay !== undefined && (p.prefs.capysPerDay === 0 ? '- Daily capybara pics are off.' : `- Capybara pics: ${p.prefs.capysPerDay} a day.`),
    p?.prefs?.calendarFor &&
      Object.keys(p.prefs.calendarFor).length &&
      `- Calendars by category: ${Object.entries(p.prefs.calendarFor).map(([k, v]) => `${k} -> ${v}`).join(', ')}.`,
  ].filter(Boolean);
  const mem = (p?.memories ?? []).map((m) => `- [${m.id}] ${m.text}`);
  return [
    lines.length ? `\nAbout the owner:\n${lines.join('\n')}` : '',
    mem.length ? `\nThings they asked you to remember (id in brackets, for forget):\n${mem.join('\n')}` : '',
  ].join('\n');
}

/** First-conversation setup, injected into the user turn until setup is complete. */
export function setupContext(p: OwnerProfile | null): string {
  if (p?.onboardedAt) return '';
  return `[Context: the owner hasn't set you up yet. If their message needs something done, do it first. Then (or right away if they just said hi) introduce yourself in one line as ${ASSISTANT_NAME} and run a quick setup, one or two questions per message, each as lettered options with a skip choice. Cover: what to call them (open question), their timezone (offer Eastern first as the default), reply length, emoji, their usual day (roughly when they're up and when they wind down, so you don't suggest 7am meetings), the 8am morning briefing, Canvas deadline nudges (8pm the night before and 3 hours before), and finally whether to connect Google Calendar and Gmail now (if yes, call connect_google and send the link). Save answers with save_preferences as they come; on the last one set setupComplete. If they want to skip setup, save setupComplete with whatever you have.]\n`;
}
