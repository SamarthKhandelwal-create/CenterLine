# Notes

Decisions taken while building, ambiguities resolved, and things deliberately left out.

## The eight requirements

Wired from *Student Check-In / Check-Out System Requirements and Non-Exhaustive
Informational Vendor List*. The checklist wording is stored verbatim in
`lib/compliance/requirements.ts` and rendered as-is on `/compliance` and in the evidence
pack, so a reviewer reads the requirement itself rather than my paraphrase of it.

Six are computed from the centre's own records. Two are not, and pretending otherwise
would have been dishonest:

- **4 Staff Oversight and Training** — whether staff understand and follow the process
  is not something the attendance log can prove. The system shows supporting evidence
  (named accounts, role separation, count of staff actions) and the instructor confirms.
- **6 Backup or Data Preservation** — the system provides the backup export; whether the
  centre actually keeps a copy somewhere is a fact about the centre.

Both are recorded as dated confirmations by a named person, valid twelve months to match
the annual certification the document describes, appended rather than overwritten. This
needed one new table, `compliance_attestation`.

Corrections against my earlier provisional set, now fixed:

- **Retention is two years, not seven.** I had guessed seven. The evidence pack and the
  retention policy text now state the two-year minimum, and explain that records are
  never purged at all because the log is append-only.
- Requirement 3 turned out to be exactly what the inferred-checkout design was already
  for: "not entered later only for recordkeeping purposes". An unreviewed estimate now
  holds that requirement amber until staff confirm it.

## Decisions you approved

- **Two independent centres.** Mason West and Liberty Township each have their own
  students, guardians, credentials, closing time, staff and compliance record. This is
  not multi-centre management — there is no cross-centre view, and a user only ever sees
  their own centre. A test asserts no query and no derived session ever crosses centres.
- **`student_import_key` table.** `first_name + last_initial` is not unique at 200
  students, so import matches on a recorded key (source ID from the file, else
  normalised full name). Without it, re-import either duplicates students or merges two
  different children. It is import provenance, not a domain change — the tables you
  specified are unchanged.
- **Pickup messages bypass quiet hours.** A checkout at 21:05 still notifies the
  guardian, because the child is standing at the door. Only the proactive not-arrived
  cron honours 9pm–8am.
- **Siblings: send immediately, suppress the duplicate.** The first sibling's message
  goes out with no delay. A second checkout within ten minutes is recorded as
  `suppressed_sibling` rather than sent — so the guardian is not messaged twice, and the
  suppression is visible in `message_log` rather than silently dropped.

## Decisions taken without asking

- **PGlite for local development and tests.** Docker was not running on this machine, and
  requiring a daemon to run the test suite is friction. PGlite is real Postgres in-process,
  so the window functions, `AT TIME ZONE` arithmetic and triggers are all exercised
  genuinely. Production uses Neon over `postgres-js`; `db/client.ts` selects the driver
  and the application code never knows which is in play.
- **Append-only enforced by database triggers**, not just convention. `db/views.sql`
  installs `BEFORE UPDATE` and `BEFORE DELETE` triggers that raise. A compliance rule
  that depends on every future developer remembering it is not a compliance rule.
- **Voiding an event.** `supersedes_id` expresses "this was wrong" but not "this never
  happened". A superseding row carrying `inference_basis = 'voided'` is treated as a
  retraction and excluded from `live_attendance_event`. This is a schema smell — a
  dedicated column would be cleaner — but it avoids changing the tables you specified.
- **Session derivation is a plain view, not materialised.** `/floor` and `/kiosk` need
  this second's truth, and the data volume (~125k events per centre-year) is far too
  small for a refresh cycle to be worth its staleness.
- **File upload goes through a route handler, not a server action.** Server actions cap
  the request body well below a real roster export, and the multipart round-trip through
  an action was unreliable in practice. `/api/import/analyze` and `/api/import/commit`
  take the file directly.
- **Import never grants SMS consent.** A phone number in a spreadsheet is not permission
  to text it. Imported guardians land with `sms_consent = false` until an instructor
  ticks the box, which timestamps it.
- **Import never deactivates students missing from the file.** A partial export must not
  wipe a roster. Deactivation is a deliberate action on the student page.
- **QR cards are minted, not reprinted.** Only an HMAC is stored, so an existing token
  cannot be recovered. Printing issues a fresh set and revokes the old — which is also
  the right behaviour for a lost card. Doing this on page *load* would have invalidated
  every card in the centre on a stray visit, so it is an explicit, confirmed action.
- **Kiosk PIN is only accepted after selecting a student by name.** Four digits across
  250 students collide heavily; scoping the PIN to one already-chosen student plus a
  three-attempt lockout and per-student rate limiting makes it viable.
- **Double-scan grace window of 20 seconds.** An eager child tapping twice would
  otherwise be checked straight back out. The second scan returns the first result.
- **A doubled check-in starts one session, timed from the first scan.** Found by a test:
  `presentStudents` originally reported the second scan, which under-reported elapsed
  time on `/floor`.
- **STOP matches on the last 10 digits.** Stored numbers carry a country code that
  inbound messages may not. Also found by a test — the strict comparison silently failed
  to revoke consent, which is the worst possible failure in that path.
- **`expected_minutes` is per student, not per subject.** The brief says "30 per subject"
  but the column is a single integer, so import sets `30 × subject count` — now via
  `expectedMinutesFor()` in `lib/students/expected-minutes.ts` rather than five separate
  literals. A two-subject student with genuinely different per-subject durations still
  cannot be represented.
- **No "log out everywhere".** `user` has no token-version column, so a session cookie
  stays valid until it expires (12 hours). Mitigated by every mutation re-reading the
  user from the database, so a role change or deletion takes effect on the next write.
- **Kiosk devices are authorised by a stateless signed cookie.** There is no device
  table, so revoking one tablet means rotating `KIOSK_SECRET` and re-enrolling all of
  them. Fine at one or two tablets per centre.
- **Rate limiting is in-memory**, therefore per-instance on Vercel. Adequate for a kiosk
  on a centre LAN; a determined attacker gets more attempts than intended.
- **`/api/dev/credentials`** exposes demo PINs and QR tokens for the browser verification
  script. It returns 404 when `NODE_ENV=production`. It reads a gitignored file the seed
  writes, never the database.

## Found while wiring in the real checklist

- **`/day` only showed today's estimates.** Compliance counted every unreviewed estimate,
  but the Day screen surfaced only the current day, so a backlog was flagged as
  non-compliant with no way to clear it. It now shows today's task and an "earlier
  estimates" section separately.
- **Confirming an estimate could attest to the wrong record.** The action looked up "the
  student's most recent inferred event" rather than the row that was clicked. With a
  backlog it would have confirmed the newest instead of the one in front of you — a
  staff member signing their name against a record they never looked at. It now targets
  the event by id, and a test covers three unreviewed days on one student.
- **The dev credentials endpoint returned whichever centre came back first**, which with
  two centres meant handing out another centre's students. Now scoped to the session.

## Two ways to break a local deploy, now guarded

Both of these produced the same symptom for the user — "Application error: a
client-side exception has occurred" — and neither was caught by a test that only
checked page text.

- **`next dev` clobbers a running `next start`.** They share `.next`. Starting the dev
  server on another port rewrote the production build, so the server kept serving HTML
  referencing chunk files that no longer existed; every asset 404'd and React never
  hydrated. `pnpm smoke` now asserts no `/_next/static` request failed, that a computed
  style is actually applied, and that React hydrated — the HTML looking right is not
  evidence the page works.
- **Seeding while a server holds the database.** PGlite is single-writer; a concurrent
  write corrupted the data directory and surfaced later as a storage-manager read error
  deep in a query. `createDb()` now records its pid in a lock beside the data directory
  and the seed refuses while a live process holds it. The lock sits *beside* the
  directory, not inside — PGlite's initdb refuses to initialise a non-empty directory.

Also fixed along the way: **sign-in and sign-out no longer use Server Actions.** Action
ids are content-hashed, so a tab left open across a deploy posts an id the new server
rejects, and React turns that into a bare client-side exception. Signing in is how
someone recovers from that state, so it is a plain form post to a route handler and
works even from a stale tab. Everything else keeps Server Actions but is wrapped in
error boundaries that recognise the stale-deployment case and say "reload" instead of
showing a stack trace. The kiosk has its own boundary that shows the same amber
"see the front desk" screen a child would see for any other failure, and reloads itself.

## Added after the first walkthrough

- **Front-desk check-in.** The kiosk was the only way to check a student in, so the
  amber "please see the front desk" screen sent children to a desk with no way to help
  them. `/floor` now has a Check in button listing active students who are not currently
  present. Recorded as `staff` with `created_by`, never silently as a kiosk capture.
  (`staffToggleAction` had been written for this and never wired to anything; it is gone,
  replaced by an explicit `staffCheckInAction` that refuses a double check-in rather than
  toggling someone back out.)

## PIN removed

Students now identify themselves with a QR card, or by tapping their name on the kiosk
(`kiosk_tap`, which was in the original schema and previously unused). The PIN pad, the
`/api/kiosk/pin` route, PIN generation and the "Use my PIN" button are gone, and
migration `0002` deletes the stored PIN credentials — they were personal data with no
remaining purpose.

The `'pin'` value stays in the `credential_kind` enum. Postgres cannot drop an enum
value without recreating the type and rewriting every dependent column, which is a
disproportionate risk for a label nothing reads.

**The trade, stated plainly:** the name grid is not authentication. Any child can tap any
name, so a student can check a classmate in or out. The QR card remains the primary path
and the only one tied to something the student holds. This was an explicit product
decision, not an oversight — but a centre that needs attendance which cannot be spoofed
by another student should stay on cards.

## Decisions reversed later

Three things this document previously recorded as settled are no longer true. Each was
asked for directly, and each is a genuine trade rather than a correction.

- **Timecards are no longer excluded.** "No timecards or payroll" was on the exclusion
  list; there is now a `staff_shift` table and a Clock in / Clock out bar on `/floor`,
  with an instructor-only log at `/staff`. It is a record of who was on the floor, not
  payroll: no rates, no approval, no export. It stays deliberately separate from the
  account Sign out button in the header — signing out of the app is about a browser
  session, going off shift is about the building, and neither is evidence of the other.
  A partial unique index (`staff_shift_one_open_per_user`) makes a double clock-in
  impossible at the database rather than by convention, which is the same posture as the
  append-only triggers. Shown to both roles, not assistants only: an instructor is on the
  floor as much as anyone, and a log with a hole in it is worse than no log.

- **Kiosk mode can be exited, without a password.** Enrolling a device was a first-class
  flow — a route, a page, an action and a 400-day cookie — while un-enrolling had nothing
  at all, so a browser that had once pressed *Start kiosk mode* was pinned to `/kiosk`
  until someone cleared cookies by hand or rotated `KIOSK_SECRET` for every tablet in the
  deployment. There is now a quiet **Staff** button on the idle screen, a confirmation
  panel, and `POST /api/kiosk/exit`, which deletes the device cookie and returns the
  tablet to `/login`.

  **Stated plainly: this is not authenticated.** Any child who finds the button and taps
  through the confirmation can take the tablet out of kiosk mode. That was an explicit
  product decision — the way out should be as simple as the way in — and the confirm step
  is the only friction. What it cannot do is leak anything: the handler deletes a cookie
  and nothing else, the kiosk holds no student data beyond first names and last initials,
  and re-enrolling takes one staff sign-in. A centre that wants it locked can turn the
  panel into a credential challenge with `verifyPassword` from `lib/auth/password.ts`;
  the route and the panel are the only two files involved.

- **The inferred-checkout sweep no longer depends on cron alone.** The logic was right
  and tested, but `/api/cron/resolve` never runs in local development and is daily-only on
  a Vercel Hobby plan, so the behaviour that is supposed to make forgotten check-outs
  resolve themselves looked, on exactly those deployments, like it did not work at all.
  `/floor` now calls `sweepOverdueAction` on its existing ten-second refresh once the
  centre is past `close_time + 60 minutes`. Same function, same `inferred` capture method,
  same stated basis, same Estimated tag, same one-tap confirmation on `/day` — only the
  trigger is new. It is idempotent, so several open boards racing each other is harmless,
  and cron remains the mechanism when nobody is looking.

## Found while adding the overstay indicator

- **`/floor` rendered every over-time student twice.** `getFloorData` returned a
  `needsAttention` array that was a strict subset of `present`, and the board rendered
  both — the amber band and the card grid — with nothing subtracting one from the other.
  Each copy carried its own working Check out button. Worse, `pastClose` is a wall-clock
  condition rather than a per-student one, so from closing time onward the two lists were
  identical and the band was a complete second copy of the grid. The search box only
  filtered the grid, so typing a name shrank one list while the other kept showing
  everyone. There is now one grid, over-time students sorted to the front, and a single
  large banner above it.

- **Two over-time rules disagreed.** The server flagged a student at
  `expected + 15 minutes`; the client coloured cards by ratio, amber at 100% and red at
  130%. A 30-minute student went red in the grid at 39 minutes but only reached the
  server's list at 45. Both now come from `elapsedTone` in `lib/attendance/over-time.ts`,
  a plain module with neither `server-only` nor `use client` on it precisely so both sides
  must use the same one. The banner is derived on the client from the tick that was
  already running, so it counts up between refreshes and a second server-side list cannot
  come back.

- **Re-import updated a student's subjects and left their allowance stale.** The commit
  wrote `expected_minutes` only when the *file* carried an explicit minutes column, so a
  Math-only student who picked up Reading got the new subject and kept 30 minutes for
  ever — their floor timer then went amber halfway through a session they were entitled to
  be in. Worse, the review screen hid it: the "Expected minutes" diff row was behind the
  same condition, so a roster whose only staleness was the allowance reported as
  *unchanged*. The allowance now follows the subject count unless the file states
  otherwise, `analyze` resolves the figure against the stored student and carries it to
  the commit so the number approved is the number written, and the five scattered `30 *`
  literals are one `expectedMinutesFor()` in `lib/students/expected-minutes.ts`.
  Idempotency is unaffected — a second import of the same file still writes nothing, and
  the byte-identical roster hash in `tests/import-idempotency.test.ts` covers it.

- **The kiosk could always check a student out; it just never said so.** The toggle rule
  has decided the direction since the beginning, and present students already sorted first
  and rendered green. But no tile said whether tapping it would check you in or out, so a
  student leaving had no way to know this was also the way out. The tiles now carry a
  *Check in* / *Check out* caption. The tap is still the action — no confirmation step,
  deliberately.

## Known limits

- **Hourly crons need Vercel Pro.** On Hobby, cron is daily-only, so an inferred
  check-out could appear up to a day late instead of within the hour.
- **`xlsx@0.18.5`** has known prototype-pollution advisories on the npm build. Mitigated
  by parsing server-side only, with a 5 MB and 5,000-row cap. Worth revisiting the
  distribution source.
- **DST and centres open past midnight.** Day-boundary logic assumes a centre does not
  operate across local midnight. A session spanning midnight is attributed to the
  check-in's local date. Both DST transition days are covered by tests.
- **`message_log` has no error column.** Twilio failure codes are appended to the body
  text instead.
- **Barcode scanner detection is a timing heuristic** (keystrokes faster than 60ms
  ending in Enter). It works, but if the scanner can be configured to emit a prefix
  character, that would be deterministic. Needs testing with the actual hardware.
- **No confirmation before issuing new QR cards for the whole centre** beyond a browser
  `confirm()`. Worth a stronger flow if a centre has many tablets and staff.

## Deliberately not built

Everything on the exclusion list was left out: no offline support or service workers, no
student workflow states beyond present/absent, no wall display, no scheduling, no tuition
or invoicing, no CRM, no worksheet inventory, no academic progress tracking, no conference
scheduling, no multi-centre management, no design token pipeline, no native apps.

Staff timecards were on that list and are no longer — see *Decisions reversed later*. What
is built is a shift log, not payroll: no rates, no approvals, no export.

Three things I would argue for next, in order:

1. **A `device` table** so a lost tablet can be revoked without re-enrolling the others.
2. **A scheduled backup**, rather than relying on someone remembering to press Download
   backup. Requirement 6 is currently met by capability plus an attestation; a weekly
   automated export to somewhere off-box would make it genuinely true rather than
   genuinely claimed.
3. **Per-subject expected minutes**, which needs a `student_subject` table and would make
   the amber/red timers meaningfully more accurate for two-subject students.
