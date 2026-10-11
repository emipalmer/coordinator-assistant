# NOTES

iMessage assistant for volunteer coordinators. Built at c0mpiled-15 (Penn State), 2026-10-11.

## Decisions
- **Coordinator-only.** The assistant only talks to allowlisted coordinator numbers. Allowlist is enforced three times: bridge inbound, ingress Lambda, bridge outbound.
- **No tunnel to the Mac.** Bridge POSTs signed (HMAC-SHA256 over `timestamp.body`, 5-min skew) requests to API Gateway and long-polls an outbound SQS FIFO queue.
- **Ingress/agent split.** API Gateway's 29s limit is shorter than a Bedrock tool loop, so ingress only verifies and enqueues to an inbound FIFO queue (group = coordinator number, dedup = iMessage guid).
- **BlueBubbles without Private API** (no SIP changes). Sends use `method: "apple-script"`. Bridge binds to 127.0.0.1 only.
- **Change streams run in the bridge** (always-on process), not Lambda, which can't hold a stream open.
- **Embeddings:** Titan Text Embeddings V2 on Bedrock.
- **Bridge AWS credentials** come from `aws login` on the Mac (short-lived, auto-rotating) via the SDK default chain.

## Setup (in order)
1. Mac: Messages signed into the bot Apple ID (`the bot Apple ID`); sleep disabled.
2. BlueBubbles server 1.9.9 (arm64 DMG), Full Disk Access + Accessibility, LAN-URL proxy mode, port 1234. Private API off.
3. `brew install awscli` → `aws login` → `aws configure set region us-east-1`. Bedrock: Anthropic use-case form.
4. Atlas M0 on AWS us-east-1, DB user, network access `0.0.0.0/0`.
5. `cp .env.example .env` and fill in. Store the bridge secret: `aws ssm put-parameter --name /coord/bridge-secret --type SecureString --value "$BRIDGE_SHARED_SECRET" --overwrite`.
6. `npx cdk bootstrap` (once), then `npm run deploy -w infra`; copy `IngressUrl` / `OutboundQueueUrl` from `cdk-outputs.json` into `.env`.
7. `npm run bridge`.

## Known gaps
- New AWS account was in "being verified" state at 3:30pm; Bedrock calls were denied until it cleared.
- Deployed with root credentials via `aws login` (hackathon only). Lambdas use least-privilege roles.
- Atlas network access is `0.0.0.0/0` because Lambda has no static IP. Production: VPC + NAT/PrivateLink.
- Bridge dedup set is in memory; a restart could re-forward a message BlueBubbles re-delivers (SQS FIFO dedup covers 5 minutes).
