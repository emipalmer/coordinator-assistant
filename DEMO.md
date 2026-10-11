# 3-minute demo

**Setup (before judges arrive):** `npx tsx --env-file=.env scripts/seed.ts` (fresh synthetic data), bridge running (`npm run bridge`), iPhone mirrored to the screen, the synthetic signed form (`scripts/fake-signed-form.ts`) saved in Photos, Atlas UI open on the `assignments` collection.

| Time | Do | Say |
|---|---|---|
| 0:00 | Title | "Volunteer coordinators at small nonprofits run hundreds of people from a phone, a spreadsheet, and a stack of paper forms. We talked to one today: _[their quote]_. So we put the assistant where they already are: iMessage." |
| 0:20 | Text: *Add Taylor Brooks, birthday March 4, free Saturday mornings, loves animals and has a truck* | "No app, no form. It parses that and stores a profile we can search by meaning." |
| 0:35 | Text: *Saturday pantry yesterday: Sam 4h, Maria 3h, Ben 3.5h* | Reply asks which Maria. "It never guesses on a name. Records stay trustworthy." Answer *Gonzalez*. |
| 0:55 | Text: *Sam cut his hand on the loading dock yesterday around 10am unloading the truck. Priya bandaged it.* | "Incident reports are the form coordinators dread. It already knows Sam, the date, the injury, and the first aid, so it asks only the two things it can't know." Answer both. The PDF arrives; open it. |
| 1:35 | In Atlas, set Ben's Saturday assignment `status` to `cancelled` (or run `scripts/cancel.ts "Ben Okafor"`) | "A volunteer drops out. A MongoDB change stream catches it, Atlas Vector Search finds who fits the shift and is free Saturday morning, and the coordinator gets candidates plus an invite draft in its own bubble to forward." |
| 2:05 | Text: *Hours report for September for our board meeting* | "Grant reports and board decks need hours and dollar value. Computed from attendance at the Independent Sector rate, which they can change by text." Open the PDF. |
| 2:25 | Send the photo of the signed onboarding form | "Paper still comes back. Claude vision reads who signed what and checks it off." |
| 2:40 | Architecture slide | "iMessage through BlueBubbles on a Mac mini, no inbound tunnel. API Gateway, Lambda and SQS FIFO on AWS. Claude with 20 zod-validated tools. Atlas for state, vector search and change streams. EventBridge for the 8am birthday and check-in drafts. It only ever talks to the coordinator: volunteers get messages a human chose to send." |

**Fallbacks:** if iMessage misbehaves, run the same lines with `npx tsx --env-file=.env scripts/say.ts "..."`. It goes straight to AWS, skipping BlueBubbles, and prints the reply (PDFs still arrive in S3, and in iMessage once it recovers). If Wi-Fi drops, show the recorded run.
