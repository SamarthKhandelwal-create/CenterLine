/**
 * Renders the laminate-and-hang student poster for the kiosk.
 *
 *   pnpm poster              -> out/kiosk-poster.pdf
 *   pnpm poster ~/Desktop/kiosk.pdf
 *
 * No database and no environment: the poster's content lives in the component, which
 * copies it from the kiosk states. Nothing here should ever need a running centre.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { KioskPoster } from '@/lib/pdf/kiosk-poster';

async function main() {
  const target = resolve(process.cwd(), process.argv[2] ?? 'out/kiosk-poster.pdf');
  await mkdir(dirname(target), { recursive: true });

  const buffer = await renderToBuffer(<KioskPoster />);
  await writeFile(target, buffer);

  console.log(`Poster written to ${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
