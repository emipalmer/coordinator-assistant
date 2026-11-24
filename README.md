# Personal iMessage assistant

Star, a personal assistant you text over iMessage. It runs your Google Calendar (recurring classes, color-coded categories, meeting-time suggestions) and Google Tasks, searches and reads Gmail and writes drafts (it can never send), keeps track of Penn State Canvas due dates and nudges you before them, texts you reminders, checks the weather, remembers facts you tell it, and sends a briefing every morning at 8am ET.

Forked from Tari (c0mpiled-15). It deploys as its own stack (`PersonalAssistant`, SSM `/assistant/*`, Mongo database `assistant`), so the original `CoordinatorAssistant` stack is untouched.

## What it does

| Text it | What happens |
|---|---|
| "What's on tomorrow?" | Events across every calendar you have shown in Google Calendar |
| "Dentist Thursday 3pm, remind me an hour before" | Color-coded event (appointment) with a popup reminder; flags overlaps or a packed day |
| *(screenshot of your LionPATH schedule)* | One repeating event per class, through the last day of classes |
| "When can I meet my group this week?" | 3 open times from all your calendars, ready to paste into the group chat |
| "Remind me at 9 to submit the lab" / "every Sunday at 6 remind me to do laundry" | Star texts you then (repeats daily, weekdays, or weekly) |
| "Add buy a charger to my list" | Google Tasks to-do |
| "Do I need a jacket?" | Weather for State College (or anywhere) |
| "Move my 1:1 with Sam to 4" | Finds the event and moves it (keeps its length) |
| "Any emails from my professor this week?" | Gmail search; it reads the ones that matter |
| "Draft a reply saying I'll be there" | Threaded reply saved in Gmail Drafts. Never sent |
| "What's due this week?" / "Anything for STAT 200?" | Canvas assignments and course events from your calendar feed |
| "Put my Canvas deadlines on my calendar" | DUE: events with reminders, skipping ones already added |
| "Remember my advisor is Dr. Lee" | Saved; used in later conversations ("forget that" removes it) |
| *(photo of a flyer or syllabus)* | Reads it and offers to add the dates |
| *(8pm the night before, and 3h before a Canvas deadline)* | Heads-up text; reply "done" and it stops nudging. Quiet 11pm-8am |
| *(3 times a day, random, 10am-9pm)* | A capybara pic from Star's own stash (stocked automatically from capy.lol). "Send me a capybara", "5 a day", "stop the capybaras", "not that one again" all work; text it a capybara photo to add your own |
| *(2 times a day, random, 9:30am-8pm)* | A short encouraging text that knows what your day looks like; if something starts within 3 hours, a heads-up about it follows in its own bubble. "More pep talks" / "stop the motivational texts" |
| *(8am daily)* | Weather, today's events, Canvas due in the next 3 days, tasks due, important unread mail |

## Architecture

```
 iPhone (you, allowlisted number)
      │ iMessage
      ▼
 Mac ─ Messages.app (bot Apple ID) + BlueBubbles server (no Private API)
      │ webhook on 127.0.0.1:8787
      ▼
 Bridge (services/bridge)                   no inbound tunnel: the Mac only makes outbound calls
   ├─ POST signed (HMAC) ─────────► API Gateway /inbound ─► Ingress Lambda ─► SQS FIFO (inbound)
   ├─ long-poll ◄───────────────── SQS FIFO (outbound) ◄──────────────────────────┐
   └─ uploads photos ─────────────► S3 (private, 30-day expiry)                  │
                                                                                  │
 EventBridge Scheduler (8am ET) ─────────────────────────► SQS FIFO (inbound)    │
 EventBridge Scheduler (every min) ─► Ticker Lambda ─ due reminders / nudges ─► ┘ │
                                                               ▼                  │
                                     Agent Lambda: Claude tool loop ──────────────┘
                                       ├─ Google Calendar / Tasks / Gmail (OAuth, refresh token AES-GCM sealed)
                                       ├─ Canvas Calendar Feed (.ics link), Open-Meteo weather (no key)
                                       └─ MongoDB Atlas: conversation, profile + memories, reminders,
                                          Canvas deadlines (done / nudged), Google link
```

## Guardrails
- Allowlisted numbers only, enforced at the bridge (in and out) and in the ingress Lambda. Unsigned requests get 401, unknown senders 403.
- Google scopes: `calendar.events`, `calendar.calendarlist.readonly`, `calendar.freebusy`, `tasks`, `gmail.readonly`, `gmail.compose`. There's no send or modify scope, so it can't send or delete mail. Events are created with `sendUpdates=none`, and it never invites anyone.
- Canvas is read-only: Star only downloads your Calendar Feed. The feed link is stored in SSM like a password.
- The system prompt treats email, event, and Canvas content as untrusted data. Only you can trigger actions.
- Secrets live in SSM SecureString (`/assistant/*`) and a gitignored `.env`. Logs record ids and sizes, never message text.
- `npm run security-check` probes the deployed entry points (signatures, replay, strangers, OAuth state forgery, public S3, bridge reachability, committed secrets).

## Setup

Prereqs: the BlueBubbles server is running on this Mac (port 1234, Private API off), Messages is signed into the bot Apple ID, and you text it from the number in `ALLOWLIST`.

1. **AWS:** `aws login`, then `aws configure set region us-east-1`.
2. **Keys** (see "Rotating keys" below): fill in `.env`, then run `npm run secrets`.
3. **Deploy:** `npm run deploy`. Copy `IngressUrl`, `OutboundQueueUrl` and `FilesBucket` from `cdk-outputs.json` into `.env`.
4. **Google:** create the OAuth client using `GoogleRedirectUri` from `cdk-outputs.json` (see below), put the ID and secret in `.env`, then run `npm run secrets` again.
5. **Bridge AWS key:** `sh scripts/bridge-key.sh`, then set `BRIDGE_AWS_PROFILE=star-bridge` in `.env`. The bridge gets its own key that never expires and can only pick up replies and upload photos. Without it, the bridge uses your `aws login` session and stops sending replies when that expires.
6. **Bridge:** `npm run bridge:forever`.
7. Text the assistant "hi". It runs a short setup and offers the Google link.

### Google Cloud (one time)
1. Create a new project in console.cloud.google.com and enable the **Google Calendar API**, **Google Tasks API** and **Gmail API**.
2. Google Auth Platform → Branding: app name = the assistant's name, with your email as support and developer contact.
3. Audience: **External**, then **Publish app** (In production). Don't submit for verification. You'll click through an "unverified app" warning once (Advanced → Continue). Refresh tokens no longer expire every 7 days the way they do in Testing.
4. Data access: add the six scopes listed under Guardrails.
5. Clients → Create client → **Web application**. Authorized redirect URI = `GoogleRedirectUri`.

### Canvas
Penn State doesn't let students create API tokens, so Star reads your personal calendar feed instead: psu.instructure.com → **Calendar** → **Calendar Feed** (bottom right) → copy the link into `CANVAS_FEED_URL`, then run `npm run secrets`.

That gives due dates (assignments, quizzes, graded discussions) and course events across all your courses, including new ones right away. It can't see grades, announcements, or whether something was submitted. Treat the link like a password: anyone with it can read your Canvas calendar. Optional: everything else works without it.

### Rotating keys
| Key | Where to make a new one | Then |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | `npm run secrets`, revoke the old key |
| `MONGODB_URI` | Atlas → Database Access: new user, *readWrite@assistant* | `npm run secrets`, delete the old user once nothing uses it |
| `BLUEBUBBLES_PASSWORD` *(optional: only used on this Mac, LAN-only)* | BlueBubbles → Settings → Server password | update `.env`, restart the bridge |
| Bridge AWS key (`star-bridge` profile) | `sh scripts/bridge-key.sh` (makes a new key, deletes the old one) | restart the bridge |
| `BRIDGE_SHARED_SECRET` | `npm run secrets -- --rotate-bridge` | restart the bridge |
| `GOOGLE_CLIENT_SECRET` | Cloud console → Clients → add a secret | `npm run secrets`, disable the old secret |
| `CANVAS_FEED_URL` | Canvas → Calendar → Calendar Feed → Reset | `npm run secrets` |

Lambdas cache secrets per warm container. Run `npm run deploy` (or wait about 15 minutes) for a new value to take effect.

## Commands
```
npm test                 # unit tests
npm run deploy           # CDK deploy, writes cdk-outputs.json
npm run secrets          # .env -> SSM
npm run bridge:forever   # on the Mac running BlueBubbles (auto-restarts)
npm run say -- "what's due this week?"   # test turn without iMessage
npm run security-check
```

## Repo layout
```
packages/core/     pure logic + tests: schemas, allowlist, signing, dates/timezones, reply splitting,
                   charts, MIME for Gmail drafts, token sealing, HTML-to-text, deployment names (params.ts)
services/lambda/   ingress, agent and Google-callback handlers; tools/ (profile, calendar, gmail, canvas, charts)
services/bridge/   BlueBubbles webhook receiver, SQS poller, photo upload
infra/             CDK app (API Gateway, Lambda, SQS FIFO, Scheduler, S3, IAM)
scripts/           setup-secrets, say, last-reply, security-check
```

## Notes
- **Name:** set `ASSISTANT_NAME` in `packages/core/src/models.ts`.
- **Briefing time:** set the cron in `infra/lib/stack.ts` (fixed to America/New_York). Turn it off by text ("stop the morning briefing").
- **Deadline nudges / quiet hours:** timing lives in `packages/core/src/schedule.ts` (8pm night before, 3h before, quiet 11pm-8am). Turn nudges off by text ("stop the deadline texts").
- **Pep talks:** the ticker picks random times in `PEP_WINDOW` (`packages/core/src/schedule.ts`) and hands each to the agent as a `pep_talk` event, so each one is a short Claude turn. The wording is `PEP_TALK` in `services/lambda/src/handlers/agent.ts`.
- **Capybara stash:** the ticker stocks S3 `stash/` from [capy.lol](https://capy.lol) (5 a minute until there are 200), and sends each day's random drops straight to the outbound queue with a canned caption, so they cost no model calls. Window and captions: `CAPY_WINDOW` in `packages/core/src/schedule.ts` and `CAPTIONS` in `services/lambda/src/capys.ts`.
- **Event colors:** category -> Google color map is `EVENT_CATEGORIES` in `packages/core/src/schedule.ts`.
- Atlas network access is `0.0.0.0/0` because Lambda has no static IP.
- The bridge's dedup set is in memory. SQS FIFO dedup covers 5 minutes after a restart.
