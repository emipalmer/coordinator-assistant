import { z } from 'zod';

/** Non-coordinator triggers for the agent: the morning schedule and database changes. */
export const AgentEvent = z.discriminatedUnion('type', [
  z.object({ kind: z.literal('event'), type: z.literal('daily_check'), eventId: z.string() }),
  z.object({ kind: z.literal('event'), type: z.literal('assignment_cancelled'), eventId: z.string(), assignmentId: z.string().regex(/^[a-f0-9]{24}$/) }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
