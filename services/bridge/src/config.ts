import { z } from 'zod';
import { parseAllowlist } from '@app/core';

const Env = z.object({
  BLUEBUBBLES_URL: z.string().url(),
  BLUEBUBBLES_PASSWORD: z.string().min(1),
  BRIDGE_PORT: z.coerce.number().default(8787),
  COORDINATOR_ALLOWLIST: z.string().min(1),
  // Empty until the stack is deployed; the bridge then runs in local echo mode.
  INGRESS_URL: z.string().url().or(z.literal('')).default(''),
  OUTBOUND_QUEUE_URL: z.string().url().or(z.literal('')).default(''),
  BRIDGE_SHARED_SECRET: z.string().min(32),
  AWS_REGION: z.string().default('us-east-1'),
});

export function loadConfig() {
  const env = Env.parse(process.env);
  return { ...env, allowlist: parseAllowlist(env.COORDINATOR_ALLOWLIST) };
}
export type Config = ReturnType<typeof loadConfig>;
