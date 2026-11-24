import { z } from 'zod';
import { parseAllowlist } from '@app/core';

const Env = z.object({
  BLUEBUBBLES_URL: z.string().url(),
  BLUEBUBBLES_PASSWORD: z.string().min(1),
  BRIDGE_PORT: z.coerce.number().default(8787),
  // Comma-separated E.164 numbers allowed to talk to the assistant.
  ALLOWLIST: z.string().min(1),
  // Empty until the stack is deployed; the bridge then runs in local echo mode.
  INGRESS_URL: z.string().url().or(z.literal('')).default(''),
  OUTBOUND_QUEUE_URL: z.string().url().or(z.literal('')).default(''),
  BRIDGE_SHARED_SECRET: z.string().min(32),
  AWS_REGION: z.string().default('us-east-1'),
  // Named profile in ~/.aws/credentials holding the bridge's own key (see README). The root .env is shared
  // with deploy scripts, so this can't just be AWS_PROFILE.
  BRIDGE_AWS_PROFILE: z.string().optional(),
  // Optional: enables photo intake (images are copied to S3 for the agent).
  FILES_BUCKET: z.string().optional(),
});

export function loadConfig() {
  const env = Env.parse(process.env);
  // Set before any AWS client exists, so the SDK's default credential chain picks it up.
  if (env.BRIDGE_AWS_PROFILE) process.env.AWS_PROFILE = env.BRIDGE_AWS_PROFILE;
  return { ...env, allowlist: parseAllowlist(env.ALLOWLIST) };
}
export type Config = ReturnType<typeof loadConfig>;
