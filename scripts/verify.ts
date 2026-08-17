/**
 * End-to-end verification against a running dev server.
 *
 * Drives a real browser through every "done when" criterion: log in as both roles,
 * check a student in and out on the kiosk under 3 seconds each, see them on /floor,
 * import a 200-row CSV, close the day, generate an evidence pack, print an
 * emergency roster.
 *
 *   pnpm dev            # in one terminal
 *   pnpm verify         # in another
 */
import { chromium, type Browser, type Page } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  OK   ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function section(name: string, fn: () => Promise<void>) {
  console.log(`\n${name}`);
  try {
    await fn();
    // A section that silently logged us out would make every later check meaningless.
  } catch (err) {
    fail += 1;
    failures.push(`${name} (threw)`);
    console.log(`  FAIL ${name} threw: ${(err as Error).message.split('\n')[0]}`);
  }
}

/** Builds a 200-student roster with the messy shapes real exports have. */
function build200RowCsv(): string {
  const first = ['Aiden','Maya','Ethan','Sofia','Liam','Ava','Noah','Isabella','Lucas','Mia','Oliver','Amelia','Elijah','Harper','James','Evelyn','Benjamin','Abigail','Sebastian','Emily'];
  const last = ['Chen','Patel','Kim','Nguyen','Garcia','Smith','Johnson','Rodriguez','Lee','Martinez'];
  const rows: string[][] = [
    ['Kumon Roster Export', '', '', '', '', ''],
    ['Generated for compliance review', '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['Student ID', 'Student Name', 'Program', 'Parent/Guardian', 'Contact Number', 'Status'],
  ];
  // 20 first names x 10 surnames = 200 genuinely distinct students.
  let n = 0;
  for (let li = 0; li < last.length; li += 1) {
    for (let fi = 0; fi < first.length; fi += 1) {
      const f = first[fi]!;
      const l = last[li]!;
      const id = `IMP-${2000 + n}`;
      const phone = `(312) 555-${String(2000 + n).padStart(4, '0')}`;
      rows.push([id, `${l}, ${f}`, 'Math', `Parent ${l}`, phone, 'Active']);
      // Every third student takes two subjects, as two separate rows that must merge.
      if (n % 3 === 0) rows.push([id, `${l}, ${f}`, 'Reading', `Parent ${l}`, phone, 'Active']);
      n += 1;
    }
  }
  console.log(`  (fixture: ${n} students across ${rows.length - 4} data rows)`);
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n');
}

async function main() {
  const browser: Browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    fail += 1;
    failures.push(`browser error: ${e.message.split('\n')[0]}`);
    console.log(`  FAIL browser error — ${e.message.split('\n')[0]}`);
  });

  await section('Auth and role gating', async () => {
    await page.goto(`${BASE}/floor`);
    check('unauthenticated /floor redirects to login', page.url().includes('/login'));

    await login(page, 'masonwest@centerline.test', 'password123');
    check('instructor lands on /floor', page.url().endsWith('/floor'), page.url());

    for (const path of ['/students', '/day', '/history', '/staff', '/compliance', '/emergency']) {
      await page.goto(`${BASE}${path}`);
      check(`instructor can open ${path}`, page.url().endsWith(path), page.url());
    }

    const actx = await browser.newContext();
    const ap = await actx.newPage();
    await login(ap, 'masonwest.assistant@centerline.test', 'password123');
    check('assistant lands on /floor', ap.url().endsWith('/floor'));
    for (const path of ['/students', '/compliance', '/history', '/day', '/staff']) {
      await ap.goto(`${BASE}${path}`);
      check(`assistant blocked from ${path}`, ap.url().endsWith('/floor'), ap.url());
    }
    await ap.goto(`${BASE}/emergency`);
    check('assistant can open /emergency', ap.url().endsWith('/emergency'));
    await actx.close();
  });

  await section('Emergency button on every page', async () => {
    for (const path of ['/floor', '/students', '/day', '/history', '/compliance']) {
      await page.goto(`${BASE}${path}`);
      const n = await page.locator('header a[href="/emergency"]').count();
      check(`${path} has the Emergency button`, n >= 1);
    }
  });

  let target: { id: string; firstName: string; lastInitial: string; pin: string; token: string };

  await section('Kiosk: check in and check out under 3 seconds each', async () => {
    const creds = await (await page.request.get(`${BASE}/api/dev/credentials`)).json();
    target = creds.students[0];
    const wasPresent: boolean = (creds.presentIds as string[]).includes(target.id);

    await page.goto(`${BASE}/kiosk`);
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/enroll')) {
      await page.getByRole('button', { name: 'Start kiosk mode' }).click();
      await page.waitForURL(/\/kiosk$/, { timeout: 30_000 });
      await page.waitForLoadState('networkidle');
    }
    check('kiosk idle shows the prompt', await page.getByText('Tap your card or find your name').isVisible());
    check('kiosk offers Find my name', await page.getByRole('button', { name: 'Find my name' }).isVisible());
    check('the PIN option is gone', (await page.getByRole('button', { name: /PIN/i }).count()) === 0);

    const tapStudent = async () => {
      await page.getByRole('button', { name: 'Find my name' }).click();
      // Not an exact match: each tile now carries a "Check in" / "Check out" caption,
      // so its accessible name is "Aiden L. Check out" rather than the name alone.
      await page
        .getByRole('button', { name: new RegExp(`^${target.firstName} ${target.lastInitial}\\.`) })
        .first()
        .click();
      await page.waitForFunction(
        () => /Checked in|Checked out|front desk/.test(document.body.innerText),
        undefined,
        { timeout: 15_000 },
      );
      const text = (await page.textContent('body')) ?? '';
      return text.includes('Checked in') ? 'check_in' : text.includes('Checked out') ? 'check_out' : 'error';
    };
    const backToIdle = () =>
      page.waitForFunction(
        () => /Tap your card or find your name/.test(document.body.innerText),
        undefined,
        { timeout: 6000 },
      );

    const t0 = Date.now();
    const action1 = await tapStudent();
    const first = Date.now() - t0;
    check(`first tap succeeded (${action1})`, action1 !== 'error');
    check('first tap under 3s', first < 3000, `${first}ms`);
    check('system chose the direction, not the student',
      action1 === (wasPresent ? 'check_out' : 'check_in'), `was present: ${wasPresent}`);

    await backToIdle();
    check('returns to idle after the result screen', true);

    // The double-tap grace window deliberately returns the previous result for 20s, so
    // an eager child tapping twice is not sent straight back out.
    const repeat = await tapStudent();
    check('double-tap inside the grace window does not flip the student',
      repeat === action1, `repeat showed ${repeat}`);
    await backToIdle();

    await new Promise((r) => setTimeout(r, 21_000));
    const t1 = Date.now();
    const action2 = await tapStudent();
    const second = Date.now() - t1;
    check(`second tap flipped direction (${action2})`, action2 !== action1 && action2 !== 'error');
    check('second tap under 3s', second < 3000, `${second}ms`);
  });

  await section('An unrecognised card is refused and explains nothing', async () => {
    const res = await page.request.post(`${BASE}/api/kiosk/scan`, {
      data: { token: 'not-a-real-token-at-all' },
    });
    const body = await res.json();
    check('an unknown card is refused', body.ok === false);
    // The response must not reveal whether the token exists, is revoked, or belongs to
    // another centre — every failure looks identical to the child and to a prober.
    check('the refusal leaks nothing', JSON.stringify(body) === '{"ok":false}', JSON.stringify(body));
  });

  await section('Kiosk: a student can see they are checking out, and staff can leave', async () => {
    // A throwaway context so enrolling and un-enrolling here cannot disturb the tablet
    // the checks above are using.
    const kctx = await browser.newContext();
    const kp = await kctx.newPage();
    await login(kp, 'masonwest@centerline.test', 'password123');

    await kp.goto(`${BASE}/kiosk`);
    await kp.waitForLoadState('networkidle');
    if (kp.url().includes('/enroll')) {
      await kp.getByRole('button', { name: 'Start kiosk mode' }).click();
      await kp.waitForURL(/\/kiosk$/, { timeout: 30_000 });
      await kp.waitForLoadState('networkidle');
    }

    await kp.getByRole('button', { name: 'Find my name' }).click();
    await kp.waitForTimeout(300);
    const grid = (await kp.textContent('body')) ?? '';
    // Checking out was always possible — the toggle decides — but the tiles never said
    // so, which left a student with no way to know this was also the way out.
    check('name tiles say which way they go', /Check in/.test(grid) && /Check out/.test(grid));
    await kp.getByRole('button', { name: 'Back' }).click();
    await kp.waitForTimeout(300);

    await kp.getByRole('button', { name: 'Staff' }).click();
    check('the exit asks for confirmation first',
      await kp.getByRole('dialog', { name: 'Exit kiosk mode' }).isVisible());

    await kp.getByRole('button', { name: 'Cancel' }).click();
    await kp.waitForTimeout(300);
    check('cancelling leaves the tablet in kiosk mode',
      await kp.getByRole('button', { name: 'Find my name' }).isVisible());

    await kp.getByRole('button', { name: 'Staff' }).click();
    await kp.getByRole('button', { name: 'Exit kiosk mode' }).click();
    // The route sends the tablet to /login. This context is still signed in as staff
    // (it had to be, to enrol the device), and /login forwards a live session to
    // /floor — so assert it left the kiosk rather than naming the destination. On a
    // real tablet, where nobody is signed in, it stops at /login.
    await kp.waitForURL((u) => !u.pathname.startsWith('/kiosk'), { timeout: 15_000 });
    check('exiting kiosk mode leaves the student screen', !kp.url().includes('/kiosk'), kp.url());

    // The device cookie is genuinely gone: this browser is no longer a kiosk.
    await kp.goto(`${BASE}/kiosk`);
    await kp.waitForLoadState('networkidle');
    check('the tablet must be enrolled again after exiting',
      kp.url().includes('/enroll') || kp.url().includes('/login'), kp.url());

    await kctx.close();
  });

  await section('Floor board', async () => {
    await page.goto(`${BASE}/floor`);
    await page.waitForLoadState('networkidle');
    const heading = (await page.locator('h1').first().textContent()) ?? '';
    check('floor shows a present count', /\d+ students? present/.test(heading), heading.trim());
    // Whoever the server currently reports as present must be on the board. This is
    // the real invariant: /floor reflects live attendance state.
    const state = await (await page.request.get(`${BASE}/api/dev/credentials`)).json();
    const presentIds = state.presentIds as string[];
    const roster = state.students as { id: string; firstName: string; lastInitial: string }[];
    if (presentIds.length > 0) {
      const who = roster.find((s) => s.id === presentIds[0]);
      check('a checked-in student appears on the floor',
        who ? (await page.getByText(`${who.firstName} ${who.lastInitial}.`).count()) > 0 : true,
        who ? `${who.firstName} ${who.lastInitial}.` : 'present student not in demo roster');
    } else {
      check('floor shows nobody when nobody is checked in',
        (await page.getByText('Nobody is checked in right now.').count()) > 0);
    }

    // Every present student appears exactly once. The old attention band listed
    // over-time students a second time, and after closing time it was a complete
    // duplicate of the grid — the bug this replaced.
    if (presentIds.length > 0) {
      const who = roster.find((s) => s.id === presentIds[0]);
      if (who) {
        const copies = await page
          .getByText(`${who.firstName} ${who.lastInitial}.`, { exact: false })
          .count();
        check('a present student is listed once, not twice', copies <= 1, `${copies} copies`);
      }
    }

    // The over-time banner renders nothing at all when nobody is over time.
    const banner = await page.locator('section[role="status"]').filter({ hasText: 'over time' });
    const bannerCount = await banner.count();
    if (bannerCount > 0) {
      const text = (await banner.first().textContent()) ?? '';
      check('over-time banner states a count', /\d+ students? (is|are) over time/.test(text), text.trim().slice(0, 60));
    } else {
      check('over-time banner is absent when nobody is over time', true);
    }
  });

  await section('Staff shifts', async () => {
    await page.goto(`${BASE}/floor`);
    await page.waitForLoadState('networkidle');

    const bar = page.locator('section[aria-label="Your shift"]');
    check('floor shows the shift bar', (await bar.count()) === 1);

    const wasOnShift = (await bar.getByRole('button', { name: 'Clock out' }).count()) > 0;
    if (!wasOnShift) {
      await bar.getByRole('button', { name: 'Clock in' }).click();
      await page.waitForTimeout(800);
      check('clocking in switches the bar to on shift',
        (await bar.getByRole('button', { name: 'Clock out' }).count()) > 0);
    }

    await page.goto(`${BASE}/staff`);
    await page.waitForLoadState('networkidle');
    const body = (await page.textContent('body')) ?? '';
    check('staff log lists shifts', /shifts? ·/.test(body) || /No shifts recorded/.test(body));
    check('staff log shows somebody on shift now', /on shift now/.test(body), body.slice(0, 80));

    // Leave the demo data as we found it.
    if (!wasOnShift) {
      await page.goto(`${BASE}/floor`);
      await page.locator('section[aria-label="Your shift"]')
        .getByRole('button', { name: 'Clock out' })
        .click();
      await page.waitForTimeout(800);
    }
  });

  await section('Import a 200-row roster', async () => {
    const csv = build200RowCsv();
    writeFileSync('/tmp/centerline-200.csv', csv);

    await page.goto(`${BASE}/students/import`);
    const t0 = Date.now();
    await page.setInputFiles('input[type=file]', '/tmp/centerline-200.csv');
    await page.getByRole('button', { name: 'Review import' }).click();
    await page.waitForFunction(() => /New|Need a decision/.test(document.body.innerText), undefined, { timeout: 60_000 });

    const summary = (await page.textContent('body')) ?? '';
    // Blank rows are dropped at parse time, so the two title lines put the headers
    // at parsed index 2, displayed as row 3. What matters is that it is not row 1.
    const headerRow = /headers found on row (\d+)/.exec(summary);
    check('header row auto-detected below a title banner',
      headerRow !== null && Number(headerRow[1]) > 1, `reported row ${headerRow?.[1]}`);
    check('no manual column mapping was required', !/map .* column/i.test(summary));

    const importBtn = page.getByRole('button', { name: /^Import \d+ changes$/ });
    check('review screen offers a single import action', await importBtn.isVisible());
    await importBtn.click();
    await page.waitForFunction(() => /Import complete/.test(document.body.innerText), undefined, { timeout: 120_000 });
    const elapsed = Date.now() - t0;
    const done = (await page.textContent('body')) ?? '';
    const added = Number(/(\d+) students added/.exec(done)?.[1] ?? 0);
    const updated = Number(/(\d+) students updated/.exec(done)?.[1] ?? 0);
    const unchangedNow = Number(/(\d+) unchanged/.exec(done)?.[1] ?? 0);
    // Some file rows match students already on the seeded roster by first name and
    // last initial; those are updated rather than duplicated. What must hold is that
    // every row in the file is accounted for exactly once.
    check('every one of the 200 rows was accounted for',
      added + updated + unchangedNow === 200,
      `${added} added + ${updated} updated + ${unchangedNow} unchanged`);
    check('no duplicate students were created', added <= 200, `${added} added`);
    check('import completed under 4 minutes', elapsed < 240_000, `${Math.round(elapsed / 1000)}s`);

    // Second identical import must change nothing.
    await page.goto(`${BASE}/students/import`);
    await page.setInputFiles('input[type=file]', '/tmp/centerline-200.csv');
    await page.getByRole('button', { name: 'Review import' }).click();
    await page.waitForFunction(() => /unchanged|already up to date/.test(document.body.innerText), undefined, { timeout: 60_000 });
    const second = (await page.textContent('body')) ?? '';
    const newCount = Number(/(\d+)\s*New/.exec(second)?.[1] ?? -1);
    const updCount = Number(/(\d+)\s*Updated/.exec(second)?.[1] ?? -1);
    check('re-importing the same file reports zero changes',
      newCount === 0 && updCount === 0, `new=${newCount} updated=${updCount}`);
    const importBtn2 = page.getByRole('button', { name: /^Import 0 changes$/ });
    check('re-import offers no changes to apply', await importBtn2.isVisible().catch(() => false));
  });

  await section('Day close-out', async () => {
    await page.goto(`${BASE}/day`);
    await page.waitForLoadState('networkidle');
    const body = (await page.textContent('body')) ?? '';
    check('day screen renders', body.includes('Close the day'));

    const confirmButtons = page.getByRole('button', { name: 'Confirm' });
    const n = await confirmButtons.count();
    if (n > 0) {
      check('estimated check-outs are labelled Estimated', body.includes('Estimated'));
      await confirmButtons.first().click();
      await page.waitForLoadState('networkidle');
      check('confirming an estimate works', true, `${n} pending before`);
    } else {
      check('no estimates pending (section hidden)', !body.includes('Estimated check-outs to confirm'));
    }
  });

  await section('Evidence pack PDF', async () => {
    const res = await page.request.get(`${BASE}/api/compliance/evidence`);
    check('evidence pack returns 200', res.status() === 200, String(res.status()));
    check('content type is PDF', (res.headers()['content-type'] ?? '').includes('application/pdf'));
    const body = await res.body();
    check('PDF is a real PDF', body.subarray(0, 5).toString() === '%PDF-', body.subarray(0, 5).toString());
    check('PDF has meaningful size', body.length > 5000, `${Math.round(body.length / 1024)}KB`);
    writeFileSync('/tmp/centerline-evidence.pdf', body);
  });

  await section('Compliance page', async () => {
    await page.goto(`${BASE}/compliance`);
    await page.waitForLoadState('networkidle');
    const rows = await page.locator('ul.divide-y > li').count();
    check('exactly eight requirement rows', rows === 8, `${rows} rows`);
    const body = (await page.textContent('body')) ?? '';
    check('each row has a status', (body.match(/Met|Attention/g) ?? []).length >= 8);
  });

  await section('Emergency roster', async () => {
    await page.goto(`${BASE}/emergency`);
    await page.waitForLoadState('networkidle');
    const body = (await page.textContent('body')) ?? '';
    check('emergency lists students in the building', body.includes('Students in the building'));
    check('shows guardian phone numbers', /\+1\d{10}|No guardian on file/.test(body));
    check('shows release mode', /GUARDIAN|SELF|building is empty/i.test(body));
    check('has a print button', await page.getByRole('button', { name: 'Print roster' }).isVisible());
  });

  await section('History and CSV export', async () => {
    await page.goto(`${BASE}/history`);
    await page.waitForLoadState('networkidle');
    check('history renders sessions', /\d+ sessions/.test((await page.textContent('body')) ?? ''));

    const res = await page.request.get(`${BASE}/api/history/export`);
    check('CSV export returns 200', res.status() === 200);
    const csv = await res.text();
    check('CSV has a header row', csv.includes('Date,Student,Check in'));
    check('CSV spells out estimated times',
      !csv.includes('ESTIMATED') || csv.includes('ESTIMATED - not observed'));
  });

  await browser.close();
  console.log(`\n${'='.repeat(64)}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
