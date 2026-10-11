# Tari: a volunteer coordinator's assistant

Tari is a warm, iMessage-based assistant for nonprofit volunteer coordinators. On first contact it runs a short setup (lettered-option questions, so answering is one tap of a letter) and adapts to the coordinator's preferences. The coordinator texts it like a colleague ("Add Taylor, free Saturday mornings, loves animals", "Sam cut his hand on the dock yesterday") and it keeps the roster, logs hours, fills out forms, and drafts the messages volunteers should receive.

It only ever talks to the coordinator. When a volunteer should hear something (a birthday wish, a check-in, a shift invite), the assistant texts the coordinator a **draft** in its own bubble to forward. The coordinator stays the human in the loop.

## What it does

| Ask by text | What happens |
|---|---|
| "Add Taylor Brooks, birthday March 4, free Saturday mornings" | Volunteer created, profile embedded for semantic search |
| "Saturday pantry yesterday: Sam 4h, Maria 3h" | Hours logged; asks "which Maria?" instead of guessing |
| "Who could cover Saturday? Need someone strong" | Atlas Vector Search over volunteer notes + availability filter |
| "Sam cut his hand on the loading dock…" | Incident report pre-filled from the message; asks only what's missing; PDF sent back |
| "Hours report for September for the board" | Impact PDF: hours, volunteers, shifts, dollar value at a configurable rate (default $36.14/h, Independent Sector 2026) |
| "Send me an onboarding packet for Jordan" | Pre-filled packet PDF with guardian consent page for minors |
| *(photo of a signed form)* | Claude vision reads name + signed sections, marks paperwork received |
| "Graph our hours by month" | Chart image rendered in AWS (no third-party chart service) |
| "Send me the dashboard" | Private, expiring link to a live dashboard (design in progress) |
| "Calendar invite for Saturday pantry" | `.ics` with a day-before reminder, plus a draft note to forward |
| *(8am daily)* | Birthdays and volunteers we haven't seen in 45+ days, each with a drafted message |
| *(a volunteer drops out)* | Change stream fires → ranked backfill candidates + drafted invite |

## Architecture

```
 iPhone (coordinator)
      │ iMessage
      ▼
 Mac mini ─ Messages.app + BlueBubbles server (no Private API, no SIP changes)
      │ webhook on 127.0.0.1
      ▼
 Bridge (TypeScript, on the Mac)            no inbound tunnel: the Mac only makes outbound calls
   ├─ POST signed (HMAC) ──────────────► API Gateway ─► Ingress Lambda ─► SQS FIFO (inbound)
   ├─ long-poll ◄────────────────────── SQS FIFO (outbound) ◄──────────────────┐
   ├─ uploads photos ──────────────────► S3 (private)                          │
   └─ MongoDB change stream on assignments ─► POST /events ─► same queue       │
                                                                               │
 EventBridge Scheduler (8am ET) ──────────────────────────► SQS FIFO (inbound) │
                                                                 │             │
                                                                 ▼             │
                                       Agent Lambda: Claude tool loop ─────────┘
                                         ├─ 20 tools, every input validated with zod
                                         ├─ MongoDB Atlas: volunteers, shifts, assignments,
                                         │   attendance, conversations, formSubmissions
                                         │   + Atlas Vector Search (Titan Text Embeddings V2)
                                         ├─ Bedrock: Titan embeddings, Claude (Converse API)
                                         └─ S3: generated PDFs / .ics (1-hour presigned links)
```

**Why this shape**
- **Ingress/agent split.** A tool loop can outlast API Gateway's 29s limit, so ingress only verifies and enqueues. FIFO ordering per coordinator keeps a conversation consistent; the iMessage guid is the dedup id.
- **Proactive work is just another turn.** The morning check and cancellation alerts enter the same queue as a synthetic message, so the coordinator can reply to them naturally ("send Maria's tomorrow instead").
- **Forms are data.** A form is a `FormTemplate` (fields, types, `requiredWhen` conditions, prefills). A pure engine validates answers and decides what to ask next. Adding a form means adding a template.
- **Change streams live on the bridge**, the one always-on process. The resume token is stored in Atlas, so restarts don't miss cancellations.

## Guardrails
- Allowlisted coordinator numbers only, enforced at the bridge (in and out) and in the ingress Lambda. Unsigned requests get 401, unknown senders 403.
- The assistant never contacts volunteers; it writes drafts.
- Every model-supplied tool input is parsed with zod before it touches the database.
- Names are resolved strictly: ambiguous names prompt a question, never a guess.
- No SSNs or government IDs; W-4/I-9/background checks are out of scope.
- Secrets live in SSM Parameter Store (SecureString) and a gitignored `.env`; generated files sit in a private S3 bucket.
- Dashboard links are signed, expire in 7 days, carry no phone number, can be revoked by text ("revoke dashboard links"), and are served with no-store / no-referrer / CSP headers. The dashboard data has no contact details, notes, or incident details.
- Drafts for one volunteer never include another volunteer's private details (health, contact, birthday, paperwork, why someone dropped out).
- API Gateway is rate-limited; SQS queues are encrypted and SSL-only; logs record ids and sizes, never message text.
- `npm run security-check` attacks every entry point (28 checks: forged/stale/replayed signatures, strangers, dashboard token tampering/expiry/revocation, public S3 access, network reachability of the bridge, log contents, committed secrets).
- **Demo data is synthetic** (`scripts/seed.ts`, fictional 555-01xx numbers).

## Repo layout
```
packages/core/     pure logic + tests: schemas, phone allowlist, signing, dates/timezones,
                   name matching, retention, reply splitting, forms engine, PDF + .ics rendering
services/lambda/   ingress + agent handlers, tools/, Mongo, Bedrock/Claude loop, S3
services/bridge/   BlueBubbles webhook receiver, SQS poller, photo upload, change-stream watcher
infra/             CDK app (API Gateway, Lambda, SQS FIFO, Scheduler, S3, IAM)
scripts/           seed, demo helpers (cancel a shift, fake signed form)
```

## Running it
See [NOTES.md](NOTES.md) for setup from zero (BlueBubbles, Bedrock, Atlas, CDK) and known gaps.

```
npm install
npm test                                       # 44 unit tests
npm run deploy -w infra                        # CDK
npm run seed                                   # synthetic data + vector index
npm run bridge:forever                         # on the Mac running BlueBubbles (auto-restarts)
```
