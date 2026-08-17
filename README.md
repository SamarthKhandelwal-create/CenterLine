# Centerline

Student check-in and check-out for Kumon centres.

A tablet by the door, a floor board for the instructor, and enough of a paper trail to
satisfy a compliance audit. The product wins by removing more labour than it adds, so
almost everything here exists to save someone a step: the student never chooses check-in
or check-out, the roster imports itself, and forgotten check-outs resolve on their own
and are marked honestly as estimates.

## Quick start

```bash
pnpm install
pnpm db:seed     # creates the database, applies migrations, loads demo data
pnpm dev         # http://localhost:3000
```

Sign in at `/login`. The seed creates two independent centres:

| Centre | Email | Password | Role |
| --- | --- | --- | --- |
| Kumon of Mason West | `masonwest@centerline.test` | `password123` | Instructor — everything |
| Kumon of Mason West | `masonwest.assistant@centerline.test` | `password123` | Assistant — kiosk, floor, emergency |
| Kumon of Liberty Township | `liberty@centerline.test` | `password123` | Instructor — everything |
| Kumon of Liberty Township | `liberty.assistant@centerline.test` | `password123` | Assistant — kiosk, floor, emergency |

Set `SEED_PASSWORD=...` to use something other than `password123`.

Each centre has its own students, guardians, credentials, closing time and compliance
record; a user only ever sees their own centre. The two are seeded in deliberately
different states so both halves of the workflow are visible:

- **Mason West** closes at 19:00 and is behind — a backlog of estimated check-outs to
  review on `/day`, and its annual certifications not yet recorded. Reads 5 of 8.
- **Liberty Township** closes at 18:30 and is on top of things — every estimate
  confirmed by staff, both certifications on file. Reads 8 of 8.

Each has 30 days of realistic attendance including forgotten check-outs, guardians with
mixed SMS consent, and a sibling pair for testing combined pickup messages.

To run the kiosk, press **Open kiosk** in the header (or go to `/kiosk`) while signed in
and press **Start kiosk mode**. That binds the tablet to the centre with a device cookie;
it does not stay signed in as you. To take a tablet back out of kiosk mode, press
**Staff** in the corner of the idle screen and confirm — see *Leaving kiosk mode* below,
including what that deliberately does not check.

Demo QR tokens are printed by `pnpm db:seed` and written to
`.demo-credentials.json` (gitignored). Real credentials are stored only as HMACs and
cannot be read back — see *Printing cards* below.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm test` | Vitest suite — 62 tests against real Postgres via PGlite, no Docker needed |
| `pnpm verify` | Drives a real browser through every acceptance criterion (needs `pnpm dev`) |
| `pnpm smoke` | Production smoke test against `pnpm start` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations and (re)install views + triggers |
| `pnpm db:seed` | Reset and reseed demo data |
| `pnpm db:reset` | Delete the local database and reseed |

`pnpm verify` needs `pnpm dev` running in another terminal; `pnpm smoke` needs
`pnpm build && pnpm start`.

### Running locally in production mode

```bash
pnpm build
pnpm start        # http://localhost:3000
pnpm smoke        # in another terminal
```

Production mode enforces the real environment contract: secrets must be present and at
least 32 characters, and `/api/dev/credentials` returns 404. Generate secrets with
`openssl rand -base64 36`.

`pnpm dev` builds into `.next-dev`, so it no longer overwrites a production build.
`pnpm smoke` additionally asserts that no static asset failed, that CSS actually
applied and that React hydrated — a page whose HTML is right but whose scripts 404 is
not a passing page.

**Only one server at a time can use the local database.** PGlite is single-writer, so
`pnpm dev` and `pnpm start` cannot share `.pgdata`, and seeding while either runs would
corrupt it. All three now fail loudly and say what holds the directory instead of
producing an unreadable storage error later.

**Stop servers with `kill`, not `kill -9`.** A force-kill leaves PGlite's `postmaster.pid`
behind and can damage the data directory. A stale pid file is now cleared automatically
on next start; a genuinely damaged directory needs `pnpm db:reset`.

`pnpm verify` needs the dev server (it uses a dev-only endpoint that 404s in
production); `pnpm smoke` is the production suite.

**Keep `.env` and `.env.local` in agreement.** CLI scripts and the server both read
them through `db/load-env.ts` in Next's precedence order, because seeding with one
`CREDENTIAL_HMAC_SECRET` while the server validates against another silently breaks
every printed QR card. Changing that secret means reseeding or reissuing cards.

## Environment

Copy `.env.local` and adjust. Development falls back to fixed dev secrets so a bare
checkout runs; production refuses to start without real ones.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | prod | `file:./.pgdata` | Neon connection string in production |
| `DATABASE_DRIVER` | no | `pglite` | `pglite` locally, `postgres` for Neon |
| `SESSION_SECRET` | prod | dev fallback | ≥32 chars. Signs the session cookie |
| `CREDENTIAL_HMAC_SECRET` | prod | dev fallback | ≥32 chars. **Rotating invalidates every printed card** |
| `KIOSK_SECRET` | prod | dev fallback | ≥32 chars. Rotating un-enrols every tablet |
| `CRON_SECRET` | prod | `dev-cron-secret` | Vercel sends it as `Authorization: Bearer` |
| `SMS_PROVIDER` | no | `console` | `console` or `twilio` |
| `TWILIO_ACCOUNT_SID` | if twilio | — | |
| `TWILIO_AUTH_TOKEN` | if twilio | — | Also validates webhook signatures |
| `TWILIO_FROM_NUMBER` | if twilio | — | |
| `TWILIO_WEBHOOK_URL` | if twilio | — | Exact public URL, for signature validation |
| `NOT_ARRIVED_HOUR` | no | `17` | Centre-local hour for the not-arrived message |

Generate secrets with `openssl rand -base64 32`.

## Deploying to Vercel + Neon

1. Create a Neon project and copy the pooled connection string.
2. Import the repo into Vercel.
3. Set the environment variables above. Set `DATABASE_DRIVER=postgres` and
   `DATABASE_URL` to the Neon string.
4. Deploy, then apply the schema once:
   ```bash
   DATABASE_DRIVER=postgres DATABASE_URL='postgres://…' pnpm db:migrate
   ```
   This also installs the append-only triggers and the session view, which the app
   depends on.
5. Create the first instructor. The seed script is demo data, so for a real centre
   insert a `centre` row and a `user` row with a hash from `hashPassword()`.

`vercel.json` registers two cron jobs. **Hourly crons need a Vercel Pro plan**; on Hobby
they are limited to once daily, which delays inferred check-outs.

| Route | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/resolve` | hourly | Close sessions left open past closing + 60 min |
| `/api/cron/not-arrived` | hourly | Message guardians of absent students, in their local hour |

Point the Twilio inbound-message webhook at `/api/webhooks/twilio` so STOP replies
revoke consent.

## How it works

### Checking a student in

Three ways, in the order they are meant to be used:

1. **Scan a card.** The kiosk listens for a barcode scanner at all times — no field to
   focus, no button to press first. Recorded as `kiosk_qr`.
2. **Find my name.** For a student without their card: tap **Find my name**, tap your
   tile, done. The tap *is* the check-in — no PIN, no confirmation step. Recorded as
   `kiosk_tap`.
3. **Front desk.** `/floor` → **Check in** → search → tap the name. Recorded as `staff`
   and attributed to whoever is signed in, so it is always distinguishable from a time
   the student captured themselves. Assistants can do this too, since they staff the desk.

**Open kiosk** in the header opens the student-facing screen in a new tab. On the door
tablet you press it once and leave it; on a desktop it is how staff check the kiosk is
working.

> **A note on the name grid.** Tapping a name is not authenticated — any child can tap
> any name. That is the deliberate trade for a five-year-old who cannot be asked to
> remember a code, and it is why the QR card is the primary path. If a centre needs
> attendance that cannot be spoofed by another student, keep them on cards and treat the
> grid as the exception.

### The check-in rule

The student never chooses. One query decides: if their last live event on the
centre-local day is a `check_in`, the scan is a check-out; otherwise it is a check-in.
No confirmation, no text entry. A second scan within 20 seconds returns the first
result rather than flipping the child straight back out.

Checking **out** therefore works exactly like checking in — same card, same tile, same
screen. On the name grid a student already in the building shows as a green tile marked
*Check out* and sorts to the top; everyone else is white and marked *Check in*.

### Leaving kiosk mode

**Staff** in the corner of the idle screen, then confirm. The device cookie is deleted and
the tablet returns to `/login`; setting it up again is one staff sign-in.

This is **not** password-protected, by choice. A child who finds the button and taps
through the confirmation can take the tablet out of kiosk mode — the confirm step is the
only thing in the way. Nothing leaks if they do: the endpoint deletes a cookie and nothing
else, and the kiosk screen holds no student data beyond first names and last initials. If
your centre needs it locked, `app/api/kiosk/exit/route.ts` and
`app/(kiosk)/kiosk/exit-panel.tsx` are the only two files to change; `verifyPassword` in
`lib/auth/password.ts` is what the sign-in screen already uses.

### Staff shifts

Anyone signed in — instructor or assistant — clocks in and out from the top of `/floor`.
It is a record of who was on the floor, kept separate from the account **Sign out** button
because signing out of the app is about a browser session and going off shift is about the
building. The instructor sees the last two weeks at `/staff` and can close a shift somebody
left open overnight, which is recorded as closed by them rather than by the person who
worked it.

Not payroll: no rates, no approvals, no export. See `NOTES.md`.

### Attendance is append-only

`attendance_event` is never updated or deleted — the database rejects both with a
trigger, not merely by convention. A correction inserts a new row whose `supersedes_id`
points at the row it replaces. Sessions are derived at query time by `session_v`; there
is no mutable session table to drift out of step with the evidence.

### Estimated check-outs

Students forget to check out. Any session still open past `close_time + 60 minutes` is
closed automatically, inserting a check-out with `capture_method = 'inferred'` and a
stated basis. These are shown as **Estimated** everywhere — the floor, history, the
CSV export, the PDF — with the basis on hover. Confirming one in `/day` inserts a *new*
staff-attested event; the original inference stays in the log forever.

Two things trigger it, doing the same idempotent work: the hourly `/api/cron/resolve`, and
`/floor` itself on its ten-second refresh once past the deadline. The second exists because
cron does not run in local development and is daily-only on a Vercel Hobby plan, which made
the feature look broken on exactly those deployments.

Presenting an inferred time as observed would be a compliance violation dressed up as a
feature, so the code goes out of its way to make that hard to do by accident.

### Compliance

`/compliance` shows the eight Kumon baseline requirements verbatim, each with its
current status measured from the centre's own records. Six are computed:

| # | Requirement | How it is measured |
| --- | --- | --- |
| 1 | Digital System Required | Every record in the period was captured in this system |
| 2 | Unique Student Identification | Every active student holds a unique QR card |
| 3 | Actual Arrival and Departure | Share captured live, and no estimate left unreviewed |
| 5 | Current Student Awareness | Live present list plus days of history on record |
| 7 | Handling of PII | Credentials stored one-way; roster holds no full surnames |
| 8 | Reviewable and Retained Records | Append-only triggers active; nothing is ever purged |

Requirements **4 (Staff Oversight and Training)** and **6 (Backup or Data Preservation)**
describe what the centre does rather than anything the attendance log can prove, so they
are confirmed by a named person on the page. A confirmation is recorded with who made it
and when, is valid for twelve months to match the annual certification cycle, and is
appended rather than overwritten so last year's remains on file.

**Download backup** produces one CSV containing the roster and every attendance record
including superseded entries — the evidence for requirement 6. **Generate evidence pack**
produces the dated PDF for a review.

### Roster import

Drop in a CSV or Excel export. The importer finds the header row even when it sits below
a title banner, maps columns by fuzzy matching, splits `"Last, First"`, and merges the
one-row-per-subject shape into a single student with several subjects. Re-importing the
same file changes nothing.

Matching uses a `student_import_key` table, because `first_name + last_initial` is not
unique in a 200-student centre — two "Emma S." must not silently merge. Rows that match
more than one student are surfaced for a decision rather than guessed. Import never
grants SMS consent and never writes attendance events.

### Printing cards

A printed QR contains only a random 128-bit token — no name, no centre, nothing
identifying if the card is dropped in a car park. Only an HMAC is stored, so a card
cannot be reprinted; **Issue new cards** mints a fresh set and revokes the old ones.

### SMS

`SmsProvider` has two implementations. `ConsoleProvider` (the default) logs and writes to
`message_log` without sending, so everything is testable before A2P 10DLC registration
completes. `TwilioProvider` is complete, not a stub — it is covered by tests with the
SDK mocked, so the only untested step is Twilio's own API.

### Switching real sending on

```bash
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...          # a number on your account
TWILIO_WEBHOOK_URL=https://your-domain/api/webhooks/twilio
```

No code change. Four things have to be true first, none of them technical:

1. **A funded Twilio account** with a purchased number.
2. **A2P 10DLC registration.** US carriers reject unregistered application traffic from
   10-digit numbers. Registration runs 2–6 weeks, which is the reason the console
   provider is the default rather than an afterthought.
3. **Real guardian phone numbers.** The seed uses `+1513555…`; the 555 range is reserved
   and non-routable, so sending to demo data would fail — and any that did route would
   text a stranger.
4. **A public webhook URL** so Twilio can deliver STOP replies to
   `/api/webhooks/twilio`. `localhost` is unreachable from Twilio; use the deployed URL,
   or `ngrok` while testing. Without it, STOP replies never arrive and consent silently
   goes stale — the one failure mode worth caring about.

To rehearse against Twilio without sending anything, use their **test credentials** and
magic numbers (`+15005550006` succeeds, `+15005550001` returns invalid-number). Those
exercise the real API and return real error codes while sending no message. Messages only go to guardians with recorded consent, STOP revokes it
immediately, and every decision — sent, skipped, suppressed — is logged.

Pickup-ready messages bypass the 9pm–8am quiet window, because a guardian in the car park
needs to know their child is waiting; the proactive not-arrived message honours it. When
two siblings are checked out within ten minutes, the first message sends immediately and
the second is recorded as `suppressed_sibling` rather than sent twice.

## Testing

```bash
pnpm test     # 62 tests
pnpm verify   # browser checks against a running server
pnpm smoke    # checks against a production build
```

Tests run against a real Postgres in-process via PGlite — no Docker, no fixtures
pretending to be a database. The four required areas are covered:

- `tests/attendance.test.ts` — the check-in/check-out rule, including the centre-local
  day boundary, superseded events, and the append-only triggers
- `tests/import-idempotency.test.ts` — messy files, subject merging, and a byte-identical
  roster hash across a repeated import
- `tests/inferred-checkout.test.ts` — inference, its idempotency, and confirmation
  preserving the original
- `tests/sms-consent.test.ts` — the consent gate, STOP revocation, quiet hours, siblings
- `tests/compliance.test.ts` — all eight requirements, certification expiry, and that two
  centres never see each other's data
- `tests/staff-shifts.test.ts` — clock in/out durations, the double clock-in the partial
  unique index makes impossible, and centre isolation

## Project layout

```
app/
  (app)/          floor, students, day, history, staff, compliance, emergency — nav
  (kiosk)/        the tablet screen — device cookie, no nav, no PII
  api/            kiosk, import, cron, webhooks, exports
lib/
  attendance/     the toggle rule, derived queries, inference, the over-time rule
  staff/          shifts — clock in, clock out, the log
  import/         parse, header detection, column matching, diff, commit
  sms/            provider interface, consent gate, templates
  compliance/     the eight Kumon baseline requirements and annual certifications
  time/           every centre-local date calculation lives here
db/
  schema.ts       Drizzle schema
  views.sql       session view + append-only triggers
  seed.ts         demo centre
```

See `NOTES.md` for decisions taken along the way and things deliberately not built.
