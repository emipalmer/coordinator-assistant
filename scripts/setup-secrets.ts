// Push secrets from .env into SSM Parameter Store (SecureString), where the Lambdas read them.
// Prints parameter names only, never values. Safe to re-run after changing any key in .env.
//
//   npm run secrets                         # sync .env -> SSM; create internal keys if missing
//   npm run secrets -- --rotate-bridge      # also mint a new BRIDGE_SHARED_SECRET (written to .env + SSM)
//   npm run secrets -- --rotate-state       # new OAuth-state signing key (pending connect links stop working)
//   npm run secrets -- --rotate-token-key   # new refresh-token encryption key (Google must be reconnected)
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { GetParameterCommand, ParameterNotFound, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { PARAMS } from '@app/core';

const ssm = new SSMClient({});
const args = new Set(process.argv.slice(2));
const env = process.env;
const done: string[] = [];
const skipped: string[] = [];

const put = async (name: string, value: string) => {
  await ssm.send(new PutParameterCommand({ Name: name, Type: 'SecureString', Overwrite: true, Value: value }));
  done.push(name);
};
const exists = (name: string) =>
  ssm.send(new GetParameterCommand({ Name: name })).then(() => true, (err) => {
    if (err instanceof ParameterNotFound) return false;
    throw err;
  });

/** Replace (or append) KEY=value in .env without touching other lines. */
function writeEnv(key: string, value: string) {
  const text = readFileSync('.env', 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync('.env', re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`, { mode: 0o600 });
}

// Bridge <-> ingress HMAC secret: lives in both .env (bridge) and SSM (ingress), so they must match.
let bridge = env.BRIDGE_SHARED_SECRET ?? '';
if (args.has('--rotate-bridge') || bridge.length < 32) {
  bridge = randomBytes(32).toString('base64url');
  writeEnv('BRIDGE_SHARED_SECRET', bridge);
  console.log('Minted a new BRIDGE_SHARED_SECRET and wrote it to .env (restart the bridge).');
}
await put(PARAMS.bridgeSecret, bridge);

if (env.MONGODB_URI) await put(PARAMS.mongoUri, env.MONGODB_URI);
else skipped.push(`${PARAMS.mongoUri} (MONGODB_URI empty)`);

if (env.ANTHROPIC_API_KEY) await put(PARAMS.anthropicKey, env.ANTHROPIC_API_KEY);
else skipped.push(`${PARAMS.anthropicKey} (ANTHROPIC_API_KEY empty)`);

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) await put(PARAMS.googleClient, JSON.stringify({ id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }));
else skipped.push(`${PARAMS.googleClient} (GOOGLE_CLIENT_ID/SECRET empty)`);

if (env.CANVAS_FEED_URL) await put(PARAMS.canvas, JSON.stringify({ feedUrl: env.CANVAS_FEED_URL }));
else skipped.push(`${PARAMS.canvas} (CANVAS_FEED_URL empty)`);

// Internal keys only ever live in SSM. Created once; rotated only on request because rotation has side effects.
if (args.has('--rotate-state') || !(await exists(PARAMS.stateSecret))) await put(PARAMS.stateSecret, randomBytes(32).toString('base64url'));
if (args.has('--rotate-token-key') || !(await exists(PARAMS.tokenKey))) {
  await put(PARAMS.tokenKey, randomBytes(32).toString('hex'));
  if (args.has('--rotate-token-key')) console.log('Token key rotated: text the assistant "connect Google" to reconnect.');
}

console.log(`\nStored in SSM:\n${done.map((n) => `  ${n}`).join('\n')}`);
if (skipped.length) console.log(`\nSkipped:\n${skipped.map((n) => `  ${n}`).join('\n')}`);
console.log('\nLambdas cache secrets per container; redeploy (npm run deploy) or wait ~15 min for new values to take effect.');
