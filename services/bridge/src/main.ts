import { createServer } from 'node:http';
import { createLogger, isAllowlisted, sign, SIGNATURE_HEADER, TIMESTAMP_HEADER, type InboundMessage } from '@app/core';
import { loadConfig } from './config.js';
import { createBlueBubbles } from './bluebubbles.js';
import { parseWebhook } from './webhook.js';
import { startOutboundPoller } from './outbound.js';

const log = createLogger({ svc: 'bridge' });
const cfg = loadConfig();
const bb = createBlueBubbles(cfg.BLUEBUBBLES_URL, cfg.BLUEBUBBLES_PASSWORD);
const webhookPath = '/bluebubbles';
const webhookUrl = `http://localhost:${cfg.BRIDGE_PORT}${webhookPath}`;

// BlueBubbles can re-deliver; remember recent guids so the agent never sees a message twice.
const seen = new Set<string>();
function firstTime(guid: string) {
  if (seen.has(guid)) return false;
  seen.add(guid);
  if (seen.size > 1000) seen.delete(seen.values().next().value!);
  return true;
}

async function forward(msg: InboundMessage) {
  if (!cfg.INGRESS_URL) {
    // Local echo mode: lets us prove the iMessage legs before AWS is deployed.
    await bb.sendText(msg.chatGuid, `echo (local): ${msg.text}`);
    return;
  }
  const body = JSON.stringify(msg);
  const ts = String(Date.now());
  const res = await fetch(cfg.INGRESS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: sign(cfg.BRIDGE_SHARED_SECRET, ts, body) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ingress ${res.status}: ${await res.text()}`);
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== webhookPath) {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    // Ack immediately; BlueBubbles doesn't need to wait on AWS.
    res.writeHead(200).end();
    try {
      const body = JSON.parse(raw);
      log.debug('webhook raw', { body });
      const parsed = parseWebhook(body);
      if (!parsed.ok) return log.debug('webhook skipped', { reason: parsed.reason });
      const msg = parsed.message;
      if (!isAllowlisted(msg.from, cfg.allowlist)) return log.warn('dropped non-allowlisted sender');
      if (!firstTime(msg.messageId)) return;
      log.info('inbound', { messageId: msg.messageId, from: msg.from, len: msg.text.length, attachments: msg.attachments.length });
      await forward(msg);
    } catch (err) {
      log.error('webhook handling failed', { err });
    }
  });
});

async function ensureWebhook() {
  const hooks = await bb.listWebhooks();
  if (hooks.some((h) => h.url === webhookUrl)) return;
  await bb.addWebhook(webhookUrl, ['new-message']);
  log.info('registered BlueBubbles webhook', { webhookUrl });
}

// Bind to loopback only: BlueBubbles runs on this Mac, and nothing else should reach the bridge.
server.listen(cfg.BRIDGE_PORT, '127.0.0.1', async () => {
  log.info('bridge listening', { port: cfg.BRIDGE_PORT, mode: cfg.INGRESS_URL ? 'aws' : 'local-echo' });
  await ensureWebhook().catch((err) => log.error('webhook registration failed', { err }));
  if (cfg.OUTBOUND_QUEUE_URL) startOutboundPoller(cfg, bb, log);
});

