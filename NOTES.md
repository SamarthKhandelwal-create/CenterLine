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
  list; there is now a `staff_shift` table, with an instructor-only log at `/staff`. It is
  a record of who was on the floor, not payroll: no rates and no approval step. (It does
  now export — see *Staff import and export* — but a CSV of who was in the building is
  still not a payroll run.) A partial unique index (`staff_shift_one_open_per_user`) makes
  a double clock-in impossible at the database rather than by convention, which is the
  same posture as the append-only triggers. Both roles clock in, not assistants only: an
  instructor is on the floor as much as anyone, and a log with a hole in it is worse than
  no log.

- **Clocking in and out moved from the app to the kiosk.** It began as a Clock in / Clock
  out bar on `/floor`, plus a Close shift button on `/staff` for the shift somebody left
  open overnight. Both are gone. Staff now start and end shifts at the tablet by the door,
  from a **Staff clock in / out** button on the idle screen.

  The reason is that the bar measured the wrong thing. A shift is about the building, and
  the bar was reached through a browser session — which meant it could be pressed from a
  phone on the way home, and that whoever forgot to press it needed somebody else to fix
  the record from a different screen. The tablet by the door is where arriving and leaving
  actually happen, and it is the same tap a student makes: one button per person, green
  when they are on shift, and the system works out which direction it is.

  Two consequences worth stating. The panel appears **only on a tablet an instructor put
  into kiosk mode** — the enroller's role now travels in the kiosk token, and a device an
  assistant enrolled runs the student screen alone. And, like everything else on that
  screen, **the tap is not authenticated**: anybody at the tablet can clock anybody in or
  out. That is the same trade the exit button makes below, taken deliberately for the same
  reason — the door is staffed, and a shift log nobody can be bothered to keep is worth
  less than one anybody can correct with a tap. A centre that wants it locked can put
  `verifyPassword` behind the tile; `lib/kiosk/staff.ts` and the panel are the only two
  files involved. The forgotten overnight shift is closed the same way, by tapping that
  person's tile, which is why `/staff` is now purely a record with no buttons on it.

- **Kiosk mode can be exited, without a password.** Enrolling a device was a first-class
  flow — a route, a page, an action and a 400-day cookie — while un-enrolling had nothing
  at all, so a browser that had once pressed *Start kiosk mode* was pinned to `/kiosk`
  until someone cleared cookies by hand or rotated `KIOSK_SECRET` for every tablet in the
  deployment. There is now a quiet **Exit kiosk** button on the idle screen, a
  confirmation panel, and `POST /api/kiosk/exit`, which deletes the device cookie and
  returns the tablet to `/login`. (It was labelled *Staff* until the staff clock in / out
  panel arrived beside it and made that name ambiguous.)

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

- **The floor sweep could write a row every ten seconds, for ever.** Reported as "check
  out is not working — it just says the student has been checked in". The inferred
  check-out is stamped at closing time, so a student checked in *after* `close + 60` was
  given a departure preceding their arrival. The toggle rule reads the latest event by
  `occurred_at`, so that check-out never became the latest event, the student stayed open,
  and they qualified for the sweep again on the next run. Latent since the sweep was
  written — the hourly cron hid it by running hourly, and cron never runs locally at all.
  Putting the same call on `/floor`'s ten-second tick turned it into an unbounded insert
  loop against a table with no DELETE by design. `resolveCentreOpenSessions` now only
  closes sessions whose check-in precedes closing time; a late arrival is left for staff,
  because inventing a departure we cannot support is the one thing that file exists to
  avoid. Fixed at the shared function, so the cron is covered too.

- **The kiosk answered "Checked in" to a tile that said "Check out".** Same report. A tap
  inside the 20-second double-scan grace window records nothing and replays the previous
  result — correct, and deliberate. But once the tiles started naming the action, replaying
  "Checked in" read as the screen refusing to let the student leave. The outcome now
  carries `repeated`, and the result screen says **Already checked in** with "Wait a moment,
  then tap again". The window itself is unchanged.

- **The kiosk could always check a student out; it just never said so.** The toggle rule
  has decided the direction since the beginning, and present students already sorted first
  and rendered green. But no tile said whether tapping it would check you in or out, so a
  student leaving had no way to know this was also the way out. The tiles now carry a
  *Check in* / *Check out* caption. The tap is still the action — no confirmation step,
  deliberately.

## Made the crons deployable on Hobby

- **`0 * * * *` is not a schedule Hobby will accept — it fails the deploy.** This was
  filed under "known limits" as if it were a degradation, but Vercel rejects a
  more-than-daily cron expression outright rather than downgrading it, so the whole
  deploy was blocked. Both jobs are now daily: `not-arrived` at 22:00 UTC, `resolve` at
  02:00 UTC. Neither needs Pro any more.

- **The not-arrived gate was an exact hour match, which only worked at hourly frequency.**
  `hour !== NOT_ARRIVED_HOUR` fires only if the run lands inside that one local hour.
  Daily, that is a coin toss the feature loses twice a year at DST, and again whenever
  Vercel exercises its right to fire a Hobby cron anywhere *within* the scheduled hour —
  and it loses silently, sending nothing and reporting success. The gate is now "at or
  past the local hour", held to one run per centre per day by `notArrivedRanToday`, which
  reads `message_log` rather than keeping state of its own. That pairing behaves correctly
  at hourly frequency too, so upgrading to Pro is a `vercel.json` edit and nothing else.

- **The resolve sweep would have skipped a day whenever the run drifted past midnight.**
  It derived both the day to sweep and the "has the grace period elapsed" check from a
  single instant. Landing at 00:30 local, it computed the *new* day's closing time,
  concluded the grace period was still running, and closed nothing — and `/floor`'s tick
  only ever sweeps its own local day, so the previous evening's open sessions would have
  stayed open permanently. The local day is now an explicit argument, separate from `now`,
  and the cron sweeps yesterday and today. Shifting the instant back 24h instead was the
  obvious fix and is wrong: it drags the deadline check back with it, so the run decides
  yesterday's grace period has not elapsed either.

## Staff import and export

"Import and export staff data" reads two ways — the people, or their hours — so both are
built. `/staff` now has **Export staff list**, **Export shifts** and **Import staff**.

The two exports are separate files rather than one document with two tables, because the
staff list is meant to be edited and handed straight back to the importer, and a shift log
stapled underneath it would break that round trip. A test asserts the round trip: export,
re-import, everything reads as unchanged. The shift export defaults to 90 days where the
screen shows 14 — the reason to open a spreadsheet is usually a question the screen cannot
answer.

Import matches on **email and nothing else**. Students needed a matching cascade because a
child has no identifier of their own; a member of staff already has one, and it is already
globally unique, so there is no fuzzy tier here and no ambiguous outcome — an address not
already in this centre is a new account, full stop.

Decisions inside it, in rough order of how much they would hurt to get wrong:

- **A file never carries a password.** New accounts are given a generated temporary
  password, shown once on the result screen and unrecoverable afterwards, exactly as QR
  cards are minted rather than reprinted. An existing account's hash is never touched:
  renaming a colleague from a spreadsheet must not sign them out of their own account.
- **An unrecognised role means assistant, and says so.** Instructor sees the whole roster,
  every guardian phone number and the compliance record; guessing upward from an
  unfamiliar job title is the one mistake this must never make. "Lead tutor" reads both
  ways, so it takes the smaller of the two and warns. An unrecognised role also never
  *demotes* somebody already here — the default exists to keep a new account small, not to
  strip an instructor because the column said "Staff".
- **The importer cannot lock the centre out of itself.** It refuses to demote the person
  running it, and refuses any demotion that would leave the centre with zero instructors —
  counted across the whole plan before a single write, because the answer depends on every
  row at once. Both are enforced in the commit against the database, never from the plan:
  the plan makes a round trip through the browser between review and commit, and the roles
  in it decide who can see this centre's data. The actor comes from the session cookie.
- **An email belonging to another centre is refused, not stolen.** The unique index is
  global, so the insert would otherwise abort the whole transaction with a constraint
  error. Detecting it needs one query that crosses the centre boundary; it selects only the
  addresses that were already in the file and nothing else — no name, no id, nothing about
  who they are. That is the least it can ask and still explain the refusal.
- **A repeated email blocks both copies.** Letting the last row win would silently pick
  somebody's role for them.
- **Nobody is ever removed.** `user` has no inactive state, so absence from the file means
  nothing at all — the same rule as the roster importer, and more so here because
  `staff_shift` rows point at these accounts.

Passing over: there is still no way to *create* a staff account one at a time, which is
now the odd gap — a centre hiring one person has to write a two-row spreadsheet. The
importer is where the safety rules live, so a form should call into the same commit rather
than insert directly.

## Early departures

The brief: a student who leaves more than five minutes short of their allowance should
raise an alarm with the instructors and assistants — under 25 minutes for one subject,
under 50 for two.

Decisions inside it:

- **Five minutes of grace per subject, not five minutes flat.** Built flat first, which
  put the two-subject threshold at 55; confirmed as ten minutes for two subjects, so the
  threshold is 50 — which is what the brief's "leaves 50 minutes before" said literally.
  The grace now scales with the session: a two-subject student is in the building twice as
  long, and twice as much of it can go missing before it means anything.

  The rule takes the allowance, not a subject count, because `student.expected_minutes` is
  the only figure the alert keeps and an import may set it to something that is not a clean
  multiple of 30. So the subject count is reconstructed by rounding — a 45-minute allowance
  gets two subjects' worth of grace, being closer to two sessions than to one. Changing the
  shape of this was a one-file edit plus its tests, which is the whole argument for the
  rule living in a single module.

- **Email, plus a banner on `/floor`.** Every other notification in the system goes to a
  guardian by SMS, and staff have no phone number on file — but they do have an email
  address, because password reset needs one, so `lib/email` was already there. The banner
  is what makes it actionable while somebody is still on the floor; the email is what
  reaches the instructor who was not. Sent to every instructor and assistant at the
  centre rather than whoever is clocked in: an assistant who forgot to start their shift
  is still on the floor, and the instructor who was not there is precisely the person who
  needs to hear about it.

- **Recorded, not derived.** "Who left early today" is computable from `session_v` at any
  time; "which of those has a person actually seen" is not. The point of the feature is
  that a short session is noticed by a human, so the verdict is written once with the
  numbers it was reached from, and carries its own acknowledgement — by name, not as an
  anonymous dismissal. `check_out_event_id` is unique, which is what makes a retried
  check-out or two `/floor` boards racing produce one alert and one round of email.

- **Never raised from an inferred check-out.** The nightly sweep stamps a departure at
  closing time as an estimate. A student who checked in at 6:55 and was closed out at 7:00
  has a five-minute session on paper and may not have left at all — reporting that as an
  early departure would be inventing a departure, which is the one thing
  `lib/attendance/resolve.ts` exists to avoid. Confirming an estimate on `/day` does not
  raise one either, for the same reason: a confirmation records what time the centre
  closed, not a departure anybody watched.

- **The banner is scoped to the current centre-local day.** An alert nobody cleared last
  Tuesday sitting at the top of the board would teach staff to ignore the banner, which
  costs more than the alert is worth. The row stays in the table, and the email is what
  carries past the end of the day.

- **The child is told nothing.** The kiosk result screen is identical whether they stayed
  the full session or not. Telling a nine-year-old at the door that they are leaving early
  is the staff's call to make, not a tablet's.

- **The seed backfills it.** The seed writes attendance straight into the table rather
  than going through the check-out path, so without a backfill pass the banner is empty on
  a fresh install and the feature looks like it was never built. It selects today's
  observed sessions from `session_v` and judges them with the same `isEarlyDeparture` the
  application calls — a threshold written into a `WHERE` clause would be a second copy of
  a rule whose whole point is that there is only one.

Not built: no `/day` column for early departures, and nothing in the CSV or PDF exports.
The alert is derivable from the attendance already in both — a session shorter than the
allowance is visible in the durations — and the compliance requirements say nothing about
session length, so adding a column to an audit document to restate an internal prompt
seemed like the wrong trade.

## Known limits

- **Cron is daily, and one daily trigger cannot serve every timezone.** Hobby rejects any
  schedule running more than once a day, so `not-arrived` fires at a UTC hour chosen for a
  US-Eastern centre. A centre far enough west that the trigger lands before its local
  `NOT_ARRIVED_HOUR` is never messaged — reported as `before_local_hour` in the response
  rather than dropped silently, but still not messaged. Centres across several timezones
  need Pro and an hourly schedule; the route already works unmodified at that frequency.
- **An inferred check-out can appear up to a day late** if nobody opens `/floor` that
  evening, since the cron is the only other trigger and it runs once a night.
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
is built is a shift log, not payroll: no rates and no approval step. It does export now
(*Staff import and export*), but a CSV of hours is not a pay run and nothing downstream
of it exists.

Three things I would argue for next, in order:

1. **A `device` table** so a lost tablet can be revoked without re-enrolling the others.
2. **A scheduled backup**, rather than relying on someone remembering to press Download
   backup. Requirement 6 is currently met by capability plus an attestation; a weekly
   automated export to somewhere off-box would make it genuinely true rather than
   genuinely claimed.
3. **Per-subject expected minutes**, which needs a `student_subject` table and would make
   the amber/red timers meaningfully more accurate for two-subject students.
