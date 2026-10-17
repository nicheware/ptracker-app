// @ts-check
// RFC 4180 CSV writer: quoting only when required, CRLF between records, no final break, no BOM (CD-6 §4.1).
// The parser (parseCsv) is M2.

/** CRLF record separator (FR-EXP-02). */
export const CRLF = '\r\n';

/**
 * Quote a field only when RFC 4180 requires it.
 * @param {string} s
 * @returns {string}
 */
export function encodeField(s) {
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Join rows into CSV text: fields with ',', records with CRLF, no line break after the last record
 * (SRC-2's byte format). An empty `rows` gives ''.
 * @param {string[][]} rows   header first; every cell already a string
 * @returns {string}
 */
export function writeCsv(rows) {
  return rows.map((r) => r.map(encodeField).join(',')).join(CRLF);
}
