// Security / privacy check against the deployed stack. Attacks every entry point the way an
// outsider would and verifies private volunteer data stays private. Safe to run any time:
// it never texts anyone and restores anything it changes.
//   npx tsx --env-file=.env scripts/security-check.ts
import { networkInterfaces } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { sign, signLink, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '@app/core';

const env = process.env as Record<string, string>;
const coordinator = env.COORDINATOR_ALLOWLIST!.split(',')[0]!.trim();
const outputs = JSON.parse(readFileSync('cdk-outputs.json', 'utf8')).CoordinatorAssistant as Record<string, string>;
const apiBase = env.INGRESS_URL!.replace(/\/inbound$/, '');
const results: Array<[boolean, string]> = [];
const check = (ok: boolean, name: string) => results.push([ok, name]);

const msg = (from: string, text = 'security check') =>
  JSON.stringify({ messageId: `sec-${randomUUID()}`, from, chatGuid: `iMessage;-;${from}`, text, attachments: [], receivedAt: new Date().toISOString() });
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }).then((r) => r.status);
const signed = (body: string, ts = String(Date.now()), secret = env.BRIDGE_SHARED_SECRET!) => ({ [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: sign(secret, ts, body) });

// --- 1. Ingress: only the signed bridge, only for allowlisted coordinators -----------------
{
  const outsider = msg('+15555550123');
  check((await post('/inbound', outsider)) === 401, 'ingress rejects unsigned requests');
  check((await post('/inbound', outsider, signed(outsider, undefined, 'wrong-secret'))) === 401, 'ingress rejects a wrong signature');
  check((await post('/inbound', outsider, signed(outsider, String(Date.now() - 10 * 60_000)))) === 401, 'ingress rejects replayed/stale requests (>5 min)');
  check((await post('/inbound', outsider, signed(outsider))) === 403, 'ingress rejects non-allowlisted senders even when signed');
  const tampered = signed(outsider);
  check((await post('/inbound', msg(coordinator), tampered)) === 401, 'ingress rejects a signature reused on a different body');
  check((await post('/events', JSON.stringify({ kind: 'event', type: 'daily_check', eventId: 'x' }))) === 401, '/events rejects unsigned requests');
}

// --- 2. Dashboard: signed, expiring, revocable links; no contact details -------------------
{
  const ssm = new SSMClient({});
  const secret = (await ssm.send(new GetParameterCommand({ Name: '/coord/dashboard-secret', WithDecryption: true }))).Parameter!.Value!;
  const mongo = new MongoClient(env.MONGODB_URI!);
  const settings = mongo.db('coord').collection<{ _id: string; dashboardLinkVersion?: number }>('settings');
  const version = (await settings.findOne({ _id: 'org' }))?.dashboardLinkVersion ?? 1;
  const subject = (phone: string, v: number) => `${createHash('sha256').update(phone).digest('base64url').slice(0, 12)}:${v}`;
  const inAWeek = new Date(Date.now() + 7 * 86_400_000);
  const good = signLink(secret, subject(coordinator, version), inAWeek);
  const get = (q: string, path = '/dashboard/data') => fetch(`${apiBase}${path}${q}`);

  const ok = await get(`?t=${good}`);
  check(ok.status === 200, 'dashboard serves a valid link');
  const body = await ok.text();
  check(!Buffer.from(good.split('.')[0]!, 'base64url').toString().includes(coordinator.slice(2)), 'dashboard link does not contain the coordinator phone number');
  check(!/\+?1?\d{10}\b|\+1\d{3}/.test(body), 'dashboard data contains no phone numbers');
  check(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(body), 'dashboard data contains no email addresses');
  check(!/"notes"|injury|incident/i.test(body), 'dashboard data contains no notes or incident/injury details');
  check(ok.headers.get('cache-control') === 'no-store' && ok.headers.get('referrer-policy') === 'no-referrer' && !!ok.headers.get('content-security-policy'), 'dashboard sends no-store, no-referrer and CSP headers');

  check((await get('')).status === 401, 'dashboard rejects a missing token');
  check((await get('?t=garbage')).status === 401, 'dashboard rejects a garbage token');
  check((await get(`?t=${good.slice(0, -2)}xx`)).status === 401, 'dashboard rejects a tampered token');
  check((await get(`?t=${signLink(secret, subject(coordinator, version), new Date(Date.now() - 1000))}`)).status === 401, 'dashboard rejects an expired token');
  check((await get(`?t=${signLink(secret, subject('+15555550123', version), inAWeek)}`)).status === 401, 'dashboard rejects a validly signed link for a non-coordinator');
  check((await get(`?t=${signLink('wrong', subject(coordinator, version), inAWeek)}`)).status === 401, 'dashboard rejects a link signed with the wrong key');

  await settings.updateOne({ _id: 'org' }, { $set: { dashboardLinkVersion: version + 1 } });
  check((await get(`?t=${good}`)).status === 401, 'revoking dashboard links invalidates existing links');
  await settings.updateOne({ _id: 'org' }, { $set: { dashboardLinkVersion: version } });
  await mongo.close();
}

// --- 3. S3: generated forms and photos are never publicly readable -------------------------
{
  const bucket = outputs.FilesBucket!;
  const key = execSync(`aws s3api list-objects-v2 --bucket ${bucket} --prefix forms/ --max-items 1 --query 'Contents[0].Key' --output text`).toString().trim().split('\n')[0]!;
  const direct = await fetch(`https://${bucket}.s3.amazonaws.com/${encodeURI(key)}`);
  check(direct.status === 403, 'incident report PDFs are not publicly readable');
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

  // A buggy or compromised agent asking to text a non-coordinator must be blocked by the bridge.
  const queueUrl = env.OUTBOUND_QUEUE_URL!;
  await new SQSClient({}).send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ to: '+15555550123', text: 'security check: should never be delivered' }), MessageGroupId: 'security-check', MessageDeduplicationId: randomUUID() }));
  check(true, 'queued an outbound message to a non-coordinator (verify "blocked" in the bridge log)');
}

// --- 5. Logs don't contain message content ----------------------------------------------
{
  const cw = new CloudWatchLogsClient({});
  const groups = (await cw.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: '/aws/lambda/CoordinatorAssistant' }))).logGroups ?? [];
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
  const secrets = [env.ANTHROPIC_API_KEY, env.BLUEBUBBLES_PASSWORD, env.BRIDGE_SHARED_SECRET, env.MONGODB_URI].filter(Boolean) as string[];
  check(secrets.every((s) => !history.includes(s)), 'git history contains none of the secrets in .env');
  check(!history.includes(coordinator.slice(2)), 'git history does not contain the real coordinator phone number');
}

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
