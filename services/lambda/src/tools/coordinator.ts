import { z } from 'zod';
import type { CoordinatorProfile } from '@app/core';
import { defineTool, type ToolContext } from './registry.js';

export async function getProfile(ctx: Pick<ToolContext, 'c' | 'coordinator'>): Promise<CoordinatorProfile | null> {
  return ctx.c.coordinators.findOne({ _id: ctx.coordinator });
}

export const savePreferences = defineTool({
  name: 'save_preferences',
  description:
    'Save how this coordinator likes Tari to work: their name, reply length, the tone of drafted volunteer messages, emoji, the 8am daily check, and how drafts are signed. Call as answers arrive; set setupComplete when the setup questions are done.',
  input: z.object({
    name: z.string().min(1).optional(),
    replyLength: z.enum(['brief', 'detailed']).optional(),
    draftTone: z.enum(['warm', 'professional', 'casual']).optional(),
    emoji: z.boolean().optional(),
    dailyCheck: z.boolean().optional().describe('Whether to send the 8am birthdays/check-ins text'),
    draftSignOff: z.string().max(40).optional().describe('How drafts end, e.g. "- Pat" or empty for none'),
    setupComplete: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const { name, setupComplete, ...prefs } = input;
    const set: Record<string, unknown> = Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== undefined).map(([k, v]) => [`prefs.${k}`, v]));
    if (name) set.name = name;
    if (setupComplete) set.onboardedAt = new Date();
    const hasPrefs = Object.keys(set).some((k) => k.startsWith('prefs.'));
    await ctx.c.coordinators.updateOne(
      { _id: ctx.coordinator },
      {
        ...(Object.keys(set).length && { $set: set }),
        // Only seed an empty prefs object when no prefs.* path is being set (Mongo rejects the overlap).
        $setOnInsert: { createdAt: new Date(), ...(!hasPrefs && { prefs: {} }) },
      },
      { upsert: true },
    );
    // Forms use the coordinator name on the "reported by" line.
    if (name) await ctx.c.settings.updateOne({ _id: 'org' }, { $set: { coordinatorName: name } }, { upsert: true });
    return { ok: true, content: JSON.stringify({ saved: input }) };
  },
});

/** Stable per coordinator, so it can live in the cached system prompt. */
export function preferencesBlock(p: CoordinatorProfile | null): string {
  if (!p?.onboardedAt) return '';
  const lines = [
    p.name && `- The coordinator's name is ${p.name}.`,
    p.prefs?.replyLength === 'brief' && '- Keep replies very short: a sentence or two unless they ask for more.',
    p.prefs?.replyLength === 'detailed' && '- They like fuller replies with the key details spelled out.',
    p.prefs?.draftTone && `- Write volunteer drafts in a ${p.prefs?.draftTone} tone.`,
    p.prefs?.emoji === false && '- No emoji, in replies or drafts.',
    p.prefs?.emoji === true && '- A friendly emoji now and then is welcome, mostly in drafts.',
    p.prefs?.draftSignOff && `- End drafts with "${p.prefs?.draftSignOff}".`,
  ].filter(Boolean);
  return lines.length ? `\nThis coordinator's preferences:\n${lines.join('\n')}\n` : '';
}

/** First-conversation setup, injected into the user turn until setup is complete. */
export function setupContext(p: CoordinatorProfile | null): string {
  if (p?.onboardedAt) return '';
  return `[Context: this coordinator hasn't set up Tari yet. If their message needs something done, do it first. Then (or right away if they just said hi) welcome them in one line as Tari and run a quick setup, one or two questions per message, each as lettered options with a skip choice. Cover: what to call them (open question), reply length, tone for volunteer drafts (list Warm first and mark it as the default), emoji, the 8am birthdays/check-ins text, how drafts should be signed, and (last, optional) whether to connect Google Calendar and Gmail drafts now (if yes, call connect_google and send the link). Save answers with save_preferences as they come; on the last one set setupComplete. If they want to skip setup, save setupComplete with whatever you have.]\n`;
}
