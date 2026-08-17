import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { CaptureStats, RequirementResult } from '@/lib/compliance/requirements';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#111' },
  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 18, marginBottom: 6 },
  sub: { fontSize: 10, color: '#555', marginBottom: 2 },
  para: { lineHeight: 1.5, marginBottom: 6 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e0e0e0', paddingVertical: 5 },
  headRow: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#333', paddingBottom: 4 },
  bold: { fontFamily: 'Helvetica-Bold' },
  reqTitle: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  reqBlock: { marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  statusMet: { color: '#046c4e', fontFamily: 'Helvetica-Bold' },
  statusAttn: { color: '#92400e', fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 8, color: '#777' },
  estimated: { color: '#92400e' },
  quoted: {
    color: '#444',
    fontFamily: 'Helvetica-Oblique',
    marginBottom: 3,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#ddd',
  },
});

export type EvidencePackProps = {
  centreName: string;
  timezone: string;
  from: string;
  to: string;
  generatedAt: string;
  generatedBy: string;
  requirements: RequirementResult[];
  description: string[];
  stats: CaptureStats;
  totalEvents: number;
  retentionPolicy: string;
  sample: {
    date: string;
    student: string;
    checkIn: string;
    checkOut: string;
    method: string;
    estimated: boolean;
    basis: string | null;
  }[];
  totals: { students: number; sessions: number; estimated: number; corrections: number };
};

const col = (w: string) => ({ width: w, paddingRight: 6 });

export function EvidencePack(props: EvidencePackProps) {
  return (
    <Document
      title={`Centerline evidence pack — ${props.centreName} — ${props.from} to ${props.to}`}
      author="Centerline"
    >
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.h1}>Attendance evidence pack</Text>
        <Text style={styles.sub}>{props.centreName}</Text>
        <Text style={styles.sub}>
          Period {props.from} to {props.to} ({props.timezone})
        </Text>
        <Text style={styles.sub}>
          Generated {props.generatedAt} by {props.generatedBy}
        </Text>

        <Text style={styles.h2}>What this system does</Text>
        {props.description.map((para, i) => (
          <Text key={i} style={styles.para}>
            {para}
          </Text>
        ))}

        <Text style={styles.h2}>Summary for this period</Text>
        <View style={styles.row}>
          <Text style={col('40%')}>Students with recorded attendance</Text>
          <Text style={[col('60%'), styles.bold]}>{props.totals.students}</Text>
        </View>
        <View style={styles.row}>
          <Text style={col('40%')}>Completed sessions</Text>
          <Text style={[col('60%'), styles.bold]}>{props.totals.sessions}</Text>
        </View>
        <View style={styles.row}>
          <Text style={col('40%')}>Sessions with an estimated departure</Text>
          <Text style={[col('60%'), styles.bold]}>{props.totals.estimated}</Text>
        </View>
        <View style={styles.row}>
          <Text style={col('40%')}>Corrections recorded</Text>
          <Text style={[col('60%'), styles.bold]}>{props.totals.corrections}</Text>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${props.centreName} · ${props.from} to ${props.to} · page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.h1}>Kumon baseline requirements</Text>
        <Text style={styles.sub}>
          The eight requirements from the Kumon check-in/check-out baseline checklist. The quoted
          text is the requirement as written; the status beneath it is measured from this
          centre&apos;s own records, except where noted as confirmed by staff.
        </Text>
        <View style={{ marginTop: 12 }}>
          {props.requirements.map((r) => (
            <View key={r.id} style={styles.reqBlock} wrap={false}>
              <Text style={styles.reqTitle}>
                {r.number}. {r.title}
              </Text>
              <Text style={styles.quoted}>{r.confirmation}</Text>
              <Text style={r.status === 'green' ? styles.statusMet : styles.statusAttn}>
                {r.status === 'green' ? 'MET' : 'NEEDS ATTENTION'} — {r.measure}
              </Text>
              <Text style={{ marginTop: 2 }}>{r.evidence}</Text>
              {r.kind === 'attested' && r.attestedBy ? (
                <Text style={{ marginTop: 2, color: '#555' }}>
                  Confirmed by {r.attestedBy}
                  {r.attestedAt ? ` on ${r.attestedAt.toISOString().slice(0, 10)}` : ''}
                  {r.expiresAt ? `, renews ${r.expiresAt.toISOString().slice(0, 10)}` : ''}.
                </Text>
              ) : null}
            </View>
          ))}
        </View>
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${props.centreName} · ${props.from} to ${props.to} · page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.h1}>Capture statistics</Text>
        <Text style={styles.sub}>{props.totalEvents} attendance events in this period</Text>
        <View style={[styles.headRow, { marginTop: 10 }]}>
          <Text style={[col('50%'), styles.bold]}>How the time was captured</Text>
          <Text style={[col('25%'), styles.bold]}>Events</Text>
          <Text style={[col('25%'), styles.bold]}>Share</Text>
        </View>
        {props.stats.map((s) => (
          <View key={s.method} style={styles.row}>
            <Text style={col('50%')}>
              {s.method === 'inferred' ? 'Estimated by the system' : s.method.replace('kiosk_', 'kiosk ').replace('_', ' ')}
            </Text>
            <Text style={col('25%')}>{s.count}</Text>
            <Text style={col('25%')}>
              {Math.round((Number(s.count) / Math.max(1, props.totalEvents)) * 100)}%
            </Text>
          </View>
        ))}

        <Text style={styles.h2}>Retention policy</Text>
        <Text style={styles.para}>{props.retentionPolicy}</Text>

        <Text style={styles.h2}>Sample of records</Text>
        <Text style={styles.sub}>
          A representative sample from this period. Estimated departures are marked.
        </Text>
        <View style={[styles.headRow, { marginTop: 8 }]}>
          <Text style={[col('18%'), styles.bold]}>Date</Text>
          <Text style={[col('27%'), styles.bold]}>Student</Text>
          <Text style={[col('15%'), styles.bold]}>In</Text>
          <Text style={[col('15%'), styles.bold]}>Out</Text>
          <Text style={[col('25%'), styles.bold]}>Source</Text>
        </View>
        {props.sample.map((s, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={col('18%')}>{s.date}</Text>
            <Text style={col('27%')}>{s.student}</Text>
            <Text style={col('15%')}>{s.checkIn}</Text>
            <Text style={[col('15%'), ...(s.estimated ? [styles.estimated] : [])]}>{s.checkOut}</Text>
            <Text style={[col('25%'), ...(s.estimated ? [styles.estimated] : [])]}>
              {s.estimated ? `ESTIMATED (${s.basis ?? 'inferred'})` : s.method}
            </Text>
          </View>
        ))}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${props.centreName} · ${props.from} to ${props.to} · page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
