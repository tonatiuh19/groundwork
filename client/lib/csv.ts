/** Neutralise spreadsheet formula injection (`=`, `+`, `-`, `@`, tab, CR) in exported cells. */
function safeCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

/** Build a CSV string (CRLF rows) from typed rows. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => safeCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => safeCell(c.value(r))).join(","));
  return [head, ...body].join("\r\n");
}

/** Trigger a browser download of `csv` (UTF-8 with BOM so Excel reads accents). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
