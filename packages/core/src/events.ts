import { z } from 'zod';

/**
 * Non-message triggers for the agent. They reach the inbound queue only from EventBridge Scheduler
 * (morning briefing) and the ticker Lambda (reminders, deadline nudges, pep talks); ingress accepts only iMessages.
 */
const base = { kind: z.literal('event'), eventId: z.string().max(200) };

export const AgentEvent = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('morning_briefing') }),
  z.object({ ...base, type: z.literal('pep_talk'), to: z.string() }),
  z.object({
    ...base,
    type: z.literal('reminder'),
    to: z.string(),
    items: z.array(z.object({ id: z.string(), text: z.string().max(500), due: z.string() })).min(1).max(20),
  }),
  z.object({
    ...base,
    type: z.literal('deadline_nudge'),
    to: z.string(),
    items: z
      .array(z.object({ id: z.string(), title: z.string().max(300), course: z.string().max(120).optional(), due: z.string(), which: z.enum(['night', 'soon']) }))
      .min(1)
      .max(20),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
