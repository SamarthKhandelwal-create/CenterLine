/**
 * Production smoke test. Logs in as a real user and exercises each screen against a
 * `next start` server, where the dev-only helper endpoints are switched off.
 *
 *   pnpm build && pnpm start     # in one terminal
 *   pnpm smoke                   # in another
 */
import { chromium, type Page } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';

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

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    fail += 1;
    const where = page.url().replace(BASE, '') || '(unknown)';
    failures.push(`browser error on ${where}: ${e.message.split('\n')[0]}`);
    console.log(`  FAIL browser error on ${where} — ${e.message.split('\n')[0]}`);
  });

  // A page whose HTML renders but whose CSS and JS 404 still "contains the right
  // text" — which is how a broken build passed this suite once. Track the assets.
  const badAssets = new Set<string>();
  page.on('response', (r) => {
    if (r.status() >= 400 && /\/_next\/static\//.test(r.url())) {
      badAssets.add(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });

  console.log('\nBuild integrity');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  check('no static asset failed to load', badAssets.size === 0, [...badAssets].slice(0, 3).join(', '));

  // Stylesheets must actually apply, not merely be referenced.
  const styled = await page.evaluate(() => {
    const el = document.querySelector('button[type=submit]');
    if (!el) return false;
    const bg = getComputedStyle(el).backgroundColor;
    return bg !== '' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  });
  check('CSS is applied (styles actually loaded)', styled);

  // And React must hydrate, or every button on every screen is inert.
  const hydrated = await page.evaluate(() => {
    const el = document.querySelector('form');
    return el ? Object.keys(el).some((k) => k.startsWith('__react')) : false;
  });
  check('React hydrated (page is interactive)', hydrated);

  console.log('\nProduction hardening');
  await login(page, 'masonwest@centerline.test', 'password123');
  check('instructor signs in', page.url().endsWith('/floor'), page.url());
  const devRes = await page.request.get(`${BASE}/api/dev/credentials`);
  check('dev credentials endpoint is off in production', devRes.status() === 404, String(devRes.status()));

  console.log('\nScreens render with real data');
  const screens: [string, RegExp][] = [
    ['/floor', /students? present|Nobody is checked in/],
    ['/students', /Students/],
    ['/day', /Close the day/],
    ['/history', /\d+ sessions/],
    ['/staff', /Staff shifts/],
    ['/compliance', /of 8 requirements met/],
    ['/emergency', /Students in the building/],
    ['/students/import', /Import roster/],
  ];
  for (const [path, expected] of screens) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    const body = (await page.textContent('body')) ?? '';
    check(`${path} renders`, expected.test(body), path === '/compliance' ? body.match(/\d+ of \d+ requirements met/)?.[0] ?? '' : '');
  }

  console.log('\nFloor board');
  await page.goto(`${BASE}/floor`);
  await page.waitForLoadState('networkidle');
  const floorBody = (await page.textContent('body')) ?? '';
  const presentCount = Number(/(\d+) students? present/.exec(floorBody)?.[1] ?? 0);
  check('floor shows present students from the seed', presentCount > 0, `${presentCount} present`);
  const cards = await page.locator('a[href="/emergency"]').count();
  check('emergency button present', cards > 0);

  console.log('\nKiosk');
  await page.goto(`${BASE}/kiosk`);
  await page.waitForLoadState('networkidle');
  if (page.url().includes('/enroll')) {
    await page.getByRole('button', { name: 'Start kiosk mode' }).click();
    await page.waitForURL(/\/kiosk$/, { timeout: 30_000 });
    await page.waitForLoadState('networkidle');
  }
  check('kiosk idle screen', await page.getByText('Tap your card or find your name').isVisible());
  await page.getByRole('button', { name: 'Find my name' }).click();
  const tiles = await page.locator('button').count();
  check('name grid lists students', tiles > 10, `${tiles} tiles`);

  console.log('\nEvidence pack');
  const pdf = await page.request.get(`${BASE}/api/compliance/evidence`);
  const bytes = await pdf.body();
  check('evidence pack is a PDF', bytes.subarray(0, 5).toString() === '%PDF-', `${Math.round(bytes.length / 1024)}KB`);

  console.log('\nCSV export');
  const csv = await page.request.get(`${BASE}/api/history/export`);
  const text = await csv.text();
  check('CSV export has rows', text.split('\n').length > 2, `${text.split('\n').length - 1} rows`);
  check('estimated times are spelled out', !text.includes('ESTIMATED') || text.includes('ESTIMATED - not observed'));

  console.log('\nRole gating');
  const actx = await browser.newContext();
  const ap = await actx.newPage();
  await login(ap, 'masonwest.assistant@centerline.test', 'password123');
  await ap.goto(`${BASE}/compliance`);
  check('assistant cannot reach /compliance', ap.url().endsWith('/floor'), ap.url());
  await actx.close();

  check('no static asset failed across the whole run', badAssets.size === 0,
    [...badAssets].slice(0, 3).join(', '));

  await browser.close();
  console.log(`\n${'='.repeat(60)}`);
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
