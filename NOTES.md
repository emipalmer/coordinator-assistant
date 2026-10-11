# NOTES

iMessage assistant for volunteer coordinators. Built at c0mpiled-15 (Penn State), 2026-10-11.

## Decisions
- **Coordinator-only.** The assistant only talks to allowlisted coordinator numbers. Allowlist is enforced three times: bridge inbound, ingress Lambda, bridge outbound.
- **No tunnel to the Mac.** Bridge POSTs signed (HMAC-SHA256 over `timestamp.body`, 5-min skew) requests to API Gateway and long-polls an outbound SQS FIFO queue.
- **Ingress/agent split.** API Gateway's 29s limit is shorter than a Bedrock tool loop, so ingress only verifies and enqueues to an inbound FIFO queue (group = coordinator number, dedup = iMessage guid).
- **BlueBubbles without Private API** (no SIP changes). Sends use `method: "apple-script"`. Bridge binds to 127.0.0.1 only.
- **Change streams run in the bridge** (always-on process), not Lambda, which can't hold a stream open.
- **Embeddings:** Titan Text Embeddings V2 on Bedrock.
- **Proactive work reuses the conversation path.** The daily check (EventBridge Scheduler → inbound SQS FIFO directly, 8am ET) and cancellation alerts become synthetic turns in the coordinator's conversation, so the coordinator can reply to them naturally.
- **Cancellations are a separate `assignments` collection** so the change stream matches one field flip (`status → cancelled`). The resume token lives in `streamState`, so a bridge restart replays missed cancellations.
- **Backfill = vector search on the shift's needs + availability filter** (day and part of day in the org timezone), relaxing to day-only if fewer than 2 match.
- **Model:** Claude Sonnet 5.5 at medium effort; system prompt and tools are prompt-cached (the system prompt carries the date, not the clock time, to keep the cache warm).
- **Bridge AWS credentials** come from `aws login` on the Mac (short-lived, auto-rotating) via the SDK default chain.

## Setup (in order)
1. Mac: Messages signed into the bot Apple ID (`the bot Apple ID`); sleep disabled.
2. BlueBubbles server 1.9.9 (arm64 DMG), Full Disk Access + Accessibility, LAN-URL proxy mode, port 1234. Private API off.
3. `brew install awscli` → `aws login` → `aws configure set region us-east-1`. Bedrock: Anthropic use-case form.
4. Atlas M0 on AWS us-east-1, DB user, network access `0.0.0.0/0`.
5. `cp .env.example .env` and fill in. Store the bridge secret: `aws ssm put-parameter --name /coord/bridge-secret --type SecureString --value "$BRIDGE_SHARED_SECRET" --overwrite`.
6. `npx cdk bootstrap` (once), then `npm run deploy -w infra`; copy `IngressUrl` / `OutboundQueueUrl` from `cdk-outputs.json` into `.env`.
7. `npm run bridge`.

## Google (optional)
1. Google Cloud project "Tari": enable Calendar API + Gmail API.
2. Google Auth Platform: External audience, **Testing** status, add the coordinator's Google account as a test user.
3. Web OAuth client, redirect URI = stack output `GoogleRedirectUri`.
4. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`, then `npx tsx --env-file=.env scripts/store-google-client.ts`.
5. Text Tari "connect Google". In Testing status, Google shows an unverified-app screen and refresh tokens expire after 7 days (Tari asks to reconnect).

## Gotchas hit
- BlueBubbles resolves `localhost` webhooks to IPv6; the bridge listens on 127.0.0.1 only, so the webhook must be registered as `http://127.0.0.1:...`.
- Atlas connection string: replace `<db_password>` including the angle brackets.
- Editors with `.env` open can overwrite lines written by scripts; close the tab after editing.

## Known gaps
- Google app is in Testing mode (unverified, 7-day tokens). Production needs Google verification for the Gmail compose scope.
- New AWS account was in "being verified" state at 3:30pm. Titan embeddings worked by ~3:55pm, but Claude on Bedrock still needs the Anthropic use-case form, so the agent runs on the Anthropic API (`LLM_PROVIDER=anthropic`) until then. Same tool loop; switching is an env change + redeploy.
- All events and messages share one FIFO group (the first coordinator). Fine for one coordinator; multiple coordinators would need per-coordinator event fan-out.
- Deployed with root credentials via `aws login` (hackathon only). Lambdas use least-privilege roles.
- Atlas network access is `0.0.0.0/0` because Lambda has no static IP. Production: VPC + NAT/PrivateLink.
- Bridge dedup set is in memory; a restart could re-forward a message BlueBubbles re-delivers (SQS FIFO dedup covers 5 minutes).
