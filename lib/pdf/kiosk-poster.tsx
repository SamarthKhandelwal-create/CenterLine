import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

/**
 * The one-page student poster for the tablet by the door, laminated and hung beside it.
 *
 * Every string here is copied from the kiosk itself — app/(kiosk)/kiosk/states/*.tsx —
 * rather than paraphrased. A poster that says something the screen does not say is worse
 * than no poster: a child reads the wall, then reads the tablet, and believes the tablet
 * is broken. The 20 seconds is DOUBLE_SCAN_GRACE_MS in lib/attendance/commands.ts.
 *
 * Black on white throughout so it survives a photocopier. The screen colours are named in
 * words and drawn as a coloured outline, never as a filled block behind text: a tint that
 * copies to grey takes the words down with it, and the colour is the thing a child
 * matches against the tablet.
 */

/** The kiosk's own Tailwind colours, so wall and screen cannot drift apart. */
const KIOSK = {
  green: '#059669', // emerald-600 — checked in
  blue: '#2563EB', // blue-600 — checked out
  violet: '#6D28D9', // violet-700 — not yet
  amber: '#F59E0B', // amber-500 — front desk
  tile: '#10B981', // emerald-500 — a green name tile
};

const styles = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 34, paddingHorizontal: 46, fontFamily: 'Helvetica', color: '#000' },

  /** Deliberately empty. The centre tapes its own header here; there is no Kumon mark. */
  brandBand: { height: 50 },

  h1: { fontSize: 27, fontFamily: 'Helvetica-Bold', letterSpacing: -0.4 },

  hero: { borderWidth: 3, borderColor: '#000', paddingVertical: 12, paddingHorizontal: 16, marginTop: 10 },
  heroLine: { fontSize: 19, fontFamily: 'Helvetica-Bold', lineHeight: 1.28 },
  heroSub: { fontSize: 12.5, marginTop: 5, lineHeight: 1.3 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 13 },
  stepNum: { width: 40, fontSize: 33, fontFamily: 'Helvetica-Bold', lineHeight: 1 },
  stepText: { flex: 1, fontSize: 20, fontFamily: 'Helvetica-Bold', lineHeight: 1.2, paddingTop: 4 },
  stepNote: { fontSize: 12.5, marginTop: 8, marginLeft: 40 },

  tiles: { flexDirection: 'row', marginTop: 12 },
  tile: { flex: 1, borderWidth: 2.5, paddingVertical: 9, paddingHorizontal: 11 },
  tileWord: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  tileMeans: { fontSize: 12, marginTop: 3, lineHeight: 1.25 },

  sectionRule: { borderTopWidth: 2, borderTopColor: '#000', marginTop: 16, paddingTop: 7 },
  h2: { fontSize: 14, fontFamily: 'Helvetica-Bold' },

  screenRow: { flexDirection: 'row', alignItems: 'center', marginTop: 7 },
  chip: { width: 104, borderWidth: 2.5, paddingVertical: 5, alignItems: 'center' },
  chipWord: { fontSize: 10, fontFamily: 'Helvetica-Bold', letterSpacing: 0.4 },
  screenBody: { flex: 1, paddingLeft: 11 },
  screenSays: { fontSize: 15.5, fontFamily: 'Helvetica-Bold' },
  screenMeans: { fontSize: 12, marginTop: 1.5, lineHeight: 1.25 },

  footer: { borderTopWidth: 2, borderTopColor: '#000', marginTop: 14, paddingTop: 8 },
  footLine: { fontSize: 10.5, lineHeight: 1.35, marginBottom: 4 },
  footLabel: { fontFamily: 'Helvetica-Bold' },
});

/** One screen the student can land on, in the order they are likely to meet it. */
type ScreenRow = { colour: string; word: string; says: string; means: string };

const SCREENS: ScreenRow[] = [
  {
    colour: KIOSK.green,
    word: 'GREEN',
    says: 'Checked in',
    means: 'You are in. Go and sit down.',
  },
  {
    colour: KIOSK.blue,
    word: 'BLUE',
    says: 'Checked out',
    means: 'You are done. Time to go home.',
  },
  {
    // The double-press screen keeps the colour of whichever way you were already going,
    // which is exactly why it needs saying: the colour looks right, the word looks wrong.
    colour: '#000000',
    word: 'GREEN / BLUE',
    says: 'Already checked in / out',
    means: 'You pressed twice. Nothing is wrong. Wait 20 seconds, then press again.',
  },
  {
    colour: KIOSK.violet,
    word: 'VIOLET',
    says: 'Not yet',
    means: 'It is too soon to leave. Go back and talk to your instructor.',
  },
  {
    colour: KIOSK.amber,
    word: 'AMBER',
    says: 'Please see the front desk',
    means: 'Something went wrong. Go and ask a person.',
  },
];

export type KioskPosterProps = {
  /** Printed nowhere on the poster — it only titles the PDF for whoever opens the file. */
  centreName?: string;
};

export function KioskPoster({ centreName }: KioskPosterProps = {}) {
  return (
    <Document
      title={centreName ? `Kiosk instructions — ${centreName}` : 'Kiosk instructions'}
      author="Centerline"
    >
      <Page size="LETTER" orientation="portrait" style={styles.page}>
        {/* Blank by design — see brandBand. */}
        <View style={styles.brandBand} />

        <Text style={styles.h1}>Checking in and out</Text>

        <View style={styles.hero}>
          <Text style={styles.heroLine}>
            The SAME button and the SAME name, coming in and going home.
          </Text>
          <Text style={styles.heroSub}>
            The screen works out which one you mean. You never choose.
          </Text>
        </View>

        <View style={styles.stepRow}>
          <Text style={styles.stepNum}>1</Text>
          <Text style={styles.stepText}>Press the big white “Find my name” button.</Text>
        </View>

        <View style={styles.stepRow}>
          <Text style={styles.stepNum}>2</Text>
          <Text style={styles.stepText}>Press your name.</Text>
        </View>

        <Text style={styles.stepNote}>That’s it — two presses, nothing to confirm.</Text>

        <View style={styles.tiles}>
          <View style={[styles.tile, { borderColor: KIOSK.tile, marginRight: 10 }]}>
            <Text style={styles.tileWord}>GREEN name</Text>
            <Text style={styles.tileMeans}>
              You are already here. Pressing it checks you OUT. It says “Check out” under
              your name.
            </Text>
          </View>
          <View style={[styles.tile, { borderColor: '#000' }]}>
            <Text style={styles.tileWord}>WHITE name</Text>
            <Text style={styles.tileMeans}>
              You are not here yet. Pressing it checks you IN. It says “Check in” under your
              name.
            </Text>
          </View>
        </View>

        <View style={styles.sectionRule}>
          <Text style={styles.h2}>What the screen shows next</Text>
        </View>

        {SCREENS.map((s) => (
          <View key={s.says} style={styles.screenRow} wrap={false}>
            <View style={[styles.chip, { borderColor: s.colour }]}>
              <Text style={styles.chipWord}>{s.word}</Text>
            </View>
            <View style={styles.screenBody}>
              <Text style={styles.screenSays}>“{s.says}”</Text>
              <Text style={styles.screenMeans}>{s.means}</Text>
            </View>
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.footLine}>
            <Text style={styles.footLabel}>Parents: </Text>
            the tablet holds first names and one initial, and the time your child arrived and
            left. No last names, no photos, no schoolwork. If you have said yes to texts, one
            goes to you when your child checks out.
          </Text>
          <Text style={styles.footLine}>
            <Text style={styles.footLabel}>Students: </Text>
            the small “Staff clock in / out” and “Exit kiosk” buttons at the bottom of the
            screen are for staff only. Not for you.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
