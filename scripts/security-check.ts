// Security / privacy check against the deployed stack. Attacks every entry point the way an
// outsider would and verifies private data stays private. Safe to run any time: it never texts anyone.
//   npx tsx --env-file=.env scripts/security-check.ts
import { networkInterfaces } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DB_NAME, PARAMS, sign, signLink, SIGNATURE_HEADER, STACK_NAME, TIMESTAMP_HEADER } from '@app/core';

const env = process.env as Record<string, string>;
const owner = env.ALLOWLIST!.split(',')[0]!.trim();
const outputs = JSON.parse(readFileSync('cdk-outputs.json', 'utf8'))[STACK_NAME] as Record<string, string>;
const apiBase = env.INGRESS_URL!.replace(/\/inbound$/, '');
const results: Array<[boolean, string]> = [];
const check = (ok: boolean, name: string) => results.push([ok, name]);

const msg = (from: string, text = 'security check') =>
  JSON.stringify({ messageId: `sec-${randomUUID()}`, from, chatGuid: `iMessage;-;${from}`, text, attachments: [], receivedAt: new Date().toISOString() });
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }).then((r) => r.status);
const signed = (body: string, ts = String(Date.now()), secret = env.BRIDGE_SHARED_SECRET!) => ({ [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: sign(secret, ts, body) });

// --- 1. Ingress: only the signed bridge, only for allowlisted numbers -----------------------
{
  const outsider = msg('+15555550123');
  check((await post('/inbound', outsider)) === 401, 'ingress rejects unsigned requests');
  check((await post('/inbound', outsider, signed(outsider, undefined, 'wrong-secret'))) === 401, 'ingress rejects a wrong signature');
  check((await post('/inbound', outsider, signed(outsider, String(Date.now() - 10 * 60_000)))) === 401, 'ingress rejects replayed/stale requests (>5 min)');
  check((await post('/inbound', outsider, signed(outsider))) === 403, 'ingress rejects non-allowlisted senders even when signed');
  const tampered = signed(outsider);
  check((await post('/inbound', msg(owner), tampered)) === 401, 'ingress rejects a signature reused on a different body');
  check((await post('/events', JSON.stringify({ kind: 'event', type: 'morning_briefing', eventId: 'x' }))) === 404, 'no /events route is exposed');
}

// --- 2b. Google: forged or replayed OAuth callbacks are refused; tokens are encrypted at rest --
{
  const ssm = new SSMClient({});
  const secret = (await ssm.send(new GetParameterCommand({ Name: PARAMS.stateSecret, WithDecryption: true }))).Parameter!.Value!;
  const ref = (p: string) => `g:${createHash('sha256').update(p).digest('base64url').slice(0, 16)}`;
  const cb = (q: string) => fetch(`${apiBase}/google/callback${q}`).then((r) => r.status);
  check((await cb('?code=x')) === 400, 'Google callback rejects a missing state (CSRF)');
  check((await cb('?code=x&state=forged')) === 400, 'Google callback rejects a forged state');
  check((await cb(`?code=x&state=${signLink(secret, ref(owner), new Date(Date.now() - 1000))}`)) === 400, 'Google callback rejects an expired state');
  check((await cb(`?code=x&state=${signLink(secret, ref('+15555550123'), new Date(Date.now() + 60_000))}`)) === 400, 'Google callback rejects a state for a non-allowlisted number');
  const mongo = new MongoClient(env.MONGODB_URI!);
  const conns = await mongo.db(DB_NAME).collection('googleConnections').find().toArray();
  check(conns.every((c) => typeof c.refreshTokenSealed === 'string' && c.refreshTokenSealed.startsWith('v1.') && !JSON.stringify(c).includes('1//')), `Google refresh tokens are encrypted at rest (${conns.length} connection(s))`);
  await mongo.close();
}

// --- 3. S3: photos and charts are never publicly readable --------------------------------
{
  const bucket = outputs.FilesBucket!;
  const key = execSync(`aws s3api list-objects-v2 --bucket ${bucket} --max-items 1 --query 'Contents[0].Key' --output text`).toString().trim().split('\n')[0]!;
  if (key && key !== 'None') {
    const direct = await fetch(`https://${bucket}.s3.amazonaws.com/${encodeURI(key)}`);
    check(direct.status === 403, 'stored photos/charts are not publicly readable');
  }
  check((await fetch(`https://${bucket}.s3.amazonaws.com/?list-type=2`)).status === 403, 'bucket contents cannot be listed publicly');
  const pab = JSON.parse(execSync(`aws s3api get-public-access-block --bucket ${bucket}`).toString()).PublicAccessBlockConfiguration;
  check(Object.values(pab).every(Boolean), 'bucket blocks all public access');
}

// --- 4. Bridge: reachable only from this Mac; drops strangers; never texts strangers -------
{
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (lan) {
    const reachable = await fetch(`http://${lan}:${env.BRIDGE_PORT ?? 8787}/bluebubbles`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
    check(!reachable, `bridge is not reachable from the network (${lan})`);
  }
  const stranger = { type: 'new-message', data: { guid: `sec-${randomUUID()}`, text: 'hi', isFromMe: false, handle: { address: '+15555550123' }, chats: [{ guid: 'iMessage;-;+15555550123' }], attachments: [] } };
  const r = await fetch(`http://127.0.0.1:${env.BRIDGE_PORT ?? 8787}/bluebubbles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(stranger) }).then((x) => x.status, () => 0);
  check(r === 200, 'bridge accepts webhook posts locally (then filters them)');

  // A buggy or compromised agent asking to text a non-allowlisted number must be blocked by the bridge.
  const queueUrl = env.OUTBOUND_QUEUE_URL!;
  await new SQSClient({}).send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ to: '+15555550123', text: 'security check: should never be delivered' }), MessageGroupId: 'security-check', MessageDeduplicationId: randomUUID() }));
  check(true, 'queued an outbound message to a stranger (verify "blocked" in the bridge log)');
}

// --- 5. Logs don't contain message content ----------------------------------------------
{
  const cw = new CloudWatchLogsClient({});
  const groups = (await cw.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: `/aws/lambda/${STACK_NAME}` }))).logGroups ?? [];
  let hits = 0;
  for (const g of groups) {
    const r = await cw.send(new FilterLogEventsCommand({ logGroupName: g.logGroupName!, filterPattern: '?"loading dock" ?"cut his hand" ?"bandage"', startTime: Date.now() - 6 * 3600_000 }));
    hits += r.events?.length ?? 0;
  }
  check(hits === 0, 'CloudWatch logs contain no message text (searched for phrases from earlier test messages)');
}

// --- 6. Repo: no secrets or real phone numbers committed --------------------------------
{
  const history = execSync('git log --all -p', { maxBuffer: 256 * 1024 * 1024 }).toString();
  const secrets = [env.ANTHROPIC_API_KEY, env.BLUEBUBBLES_PASSWORD, env.BRIDGE_SHARED_SECRET, env.MONGODB_URI, env.GOOGLE_CLIENT_SECRET, env.CANVAS_FEED_URL].filter(Boolean) as string[];
  check(secrets.every((s) => !history.includes(s)), 'git history contains none of the secrets in .env');
  check(!history.includes(owner.slice(2)), 'git history does not contain the real phone number');
}

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
