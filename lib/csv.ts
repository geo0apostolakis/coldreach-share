/**
 * RFC 4180 CSV parser. Zero imports so the self-test can load it directly.
 *
 * Handles quoted fields, escaped quotes (""), embedded commas and newlines,
 * CRLF line endings and a leading UTF-8 BOM.
 */
export function parseCsv(input: string, delimiter = ","): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      // Swallow CR so CRLF produces a single row break.
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // A trailing newline leaves nothing worth keeping; anything else is a real row.
  if (field !== "" || row.length > 0) endRow();

  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ""));
}

/** Picks the delimiter by counting candidates in the header line. */
export function detectDelimiter(input: string): string {
  const firstLine = input.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((candidate) => ({
    candidate,
    count: firstLine.split(candidate).length - 1,
  }));
  const best = counts.sort((a, b) => b.count - a.count)[0];
  return best && best.count > 0 ? best.candidate : ",";
}

/**
 * Makes a header row safe to key rows by: trims, fills in blanks and
 * de-duplicates, because readObjects() would silently drop colliding columns.
 */
export function normalizeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}
