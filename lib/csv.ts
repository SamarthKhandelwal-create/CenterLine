/** RFC4180 CSV. Excel opens this without mangling phone numbers or leading zeros. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null || cell === undefined ? '' : String(cell);
          return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\r\n');
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(`﻿${csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
