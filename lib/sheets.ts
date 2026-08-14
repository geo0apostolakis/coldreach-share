import { sheetsClient } from "./google";

/** 1 -> "A", 27 -> "AA" */
export function columnLetter(index: number): string {
  let n = index;
  let letter = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/** Quotes a sheet name for use in an A1 range. */
export function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

export function a1(tab: string, range: string): string {
  return `${quoteTab(tab)}!${range}`;
}

export type SheetMeta = { title: string; sheetId: number; rowCount: number; columnCount: number };

export async function getSpreadsheetMeta(spreadsheetId: string): Promise<{
  title: string;
  sheets: SheetMeta[];
}> {
  const res = await sheetsClient().spreadsheets.get({
    spreadsheetId,
    fields:
      "properties.title,sheets.properties(title,sheetId,gridProperties(rowCount,columnCount))",
  });
  return {
    title: res.data.properties?.title ?? "Untitled",
    sheets: (res.data.sheets ?? []).map((sheet) => ({
      title: sheet.properties?.title ?? "",
      sheetId: sheet.properties?.sheetId ?? 0,
      rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
      columnCount: sheet.properties?.gridProperties?.columnCount ?? 0,
    })),
  };
}

/** Returns every populated row of a tab, header row included, as raw strings. */
export async function readGrid(spreadsheetId: string, tab: string): Promise<string[][]> {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId,
    range: quoteTab(tab),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return (res.data.values ?? []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}

export async function readHeaders(spreadsheetId: string, tab: string): Promise<string[]> {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId,
    range: a1(tab, "1:1"),
  });
  return (res.data.values?.[0] ?? []).map((cell) => String(cell ?? "").trim());
}

/**
 * Reads only the named columns, as objects keyed by header.
 *
 * readObjects pulls the whole tab, which is fine for Campaigns but wrong for
 * Email Log: that tab holds every subject and body ever sent, so summing one
 * numeric column would download megabytes. This asks Sheets for just the
 * columns needed. Missing headers are skipped rather than throwing, so a tab
 * that predates a new column still reads.
 */
export async function readColumns(
  spreadsheetId: string,
  tab: string,
  headerNames: string[],
): Promise<Record<string, string>[]> {
  const headers = await readHeaders(spreadsheetId, tab);
  const wanted = headerNames
    .map((name) => ({ name, index: headers.indexOf(name) }))
    .filter((entry) => entry.index >= 0);
  if (wanted.length === 0) return [];

  const res = await sheetsClient().spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: wanted.map((entry) => a1(tab, `${columnLetter(entry.index + 1)}2:${columnLetter(entry.index + 1)}`)),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const columns = (res.data.valueRanges ?? []).map((range) =>
    (range.values ?? []).map((row) => (row[0] == null ? "" : String(row[0]))),
  );
  const length = columns.reduce((max, column) => Math.max(max, column.length), 0);

  const rows: Record<string, string>[] = [];
  for (let i = 0; i < length; i++) {
    const row: Record<string, string> = {};
    wanted.forEach((entry, columnIndex) => {
      row[entry.name] = columns[columnIndex]?.[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/** Reads a tab as objects keyed by header, plus the 1-based sheet row number. */
export async function readObjects(
  spreadsheetId: string,
  tab: string,
): Promise<{ headers: string[]; rows: { rowNumber: number; values: Record<string, string> }[] }> {
  const grid = await readGrid(spreadsheetId, tab);
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => h.trim());
  const rows = grid.slice(1).map((row, index) => {
    const values: Record<string, string> = {};
    headers.forEach((header, i) => {
      if (header) values[header] = row[i] ?? "";
    });
    return { rowNumber: index + 2, values };
  });
  return { headers, rows };
}

export async function appendRow(spreadsheetId: string, tab: string, values: string[]): Promise<void> {
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId,
    range: quoteTab(tab),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
}

/** Writes many scattered ranges in one call. Used to stamp classifier results back. */
export async function batchWriteRanges(
  spreadsheetId: string,
  updates: { range: string; values: (string | number)[][] }[],
): Promise<void> {
  if (updates.length === 0) return;
  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: updates },
  });
}

/** Bulk append. One API call instead of one per row, which matters at 650 rows. */
export async function appendRows(
  spreadsheetId: string,
  tab: string,
  values: string[][],
): Promise<void> {
  if (values.length === 0) return;
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId,
    range: quoteTab(tab),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

export async function writeRange(
  spreadsheetId: string,
  range: string,
  values: (string | number)[][],
): Promise<void> {
  await sheetsClient().spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

export async function writeCell(
  spreadsheetId: string,
  tab: string,
  columnIndex: number,
  rowNumber: number,
  value: string,
): Promise<void> {
  const cell = `${columnLetter(columnIndex)}${rowNumber}`;
  await writeRange(spreadsheetId, a1(tab, cell), [[value]]);
}

/** Creates a tab if missing and writes the header row. Never creates the file itself. */
/**
 * Ensures several tabs at once, in two reads total instead of two per tab.
 *
 * The per-tab version cost a spreadsheets.get plus a readHeaders every time, so calling
 * it in a loop over six control tabs meant twelve reads before any route did
 * real work. Three parallel API calls on one page load was enough to hit the
 * Sheets per-minute read quota.
 */
export async function ensureTabs(
  spreadsheetId: string,
  specs: { tab: string; headers: string[] }[],
): Promise<void> {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const existing = new Set(meta.sheets.map((sheet) => sheet.title));

  const missingTabs = specs.filter((spec) => !existing.has(spec.tab));
  if (missingTabs.length > 0) {
    await sheetsClient().spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missingTabs.map((spec) => ({
          addSheet: { properties: { title: spec.tab } },
        })),
      },
    });
  }

  // One batchGet for every header row, rather than one read each.
  const res = await sheetsClient().spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: specs.map((spec) => a1(spec.tab, "1:1")),
  });
  const rows = res.data.valueRanges ?? [];

  const writes: { range: string; values: string[][] }[] = [];
  specs.forEach((spec, index) => {
    const current = (rows[index]?.values?.[0] ?? []).map((cell) => String(cell ?? "").trim());
    const missing = spec.headers.filter((header) => !current.includes(header));
    if (current.length > 0 && missing.length === 0) return;
    // Missing headers are appended, never inserted, so existing rows stay aligned.
    const merged = current.length === 0 ? spec.headers : [...current, ...missing];
    writes.push({
      range: a1(spec.tab, `A1:${columnLetter(merged.length)}1`),
      values: [merged],
    });
  });

  if (writes.length > 0) {
    await batchWriteRanges(spreadsheetId, writes);
  }
}

/** Appends a column to the header row of a leads tab and returns its 1-based index. */
/**
 * Widens the grid so a cell at `count` exists.
 *
 * A CSV import sizes the grid to exactly the columns it holds, which every
 * Apollo export does, so the cell one past the last header is outside the grid
 * and writing to it fails with "exceeds grid limits".
 */
async function ensureColumnCount(spreadsheetId: string, tab: string, count: number): Promise<void> {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const sheet = meta.sheets.find((entry) => entry.title === tab);
  if (!sheet || sheet.columnCount >= count) return;
  await sheetsClient().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          appendDimension: {
            sheetId: sheet.sheetId,
            dimension: "COLUMNS",
            length: count - sheet.columnCount,
          },
        },
      ],
    },
  });
}

export async function addColumn(spreadsheetId: string, tab: string, name: string): Promise<number> {
  const headers = await readHeaders(spreadsheetId, tab);
  const existing = headers.indexOf(name);
  if (existing >= 0) return existing + 1;
  const index = headers.length + 1;
  await ensureColumnCount(spreadsheetId, tab, index);
  await writeRange(spreadsheetId, a1(tab, `${columnLetter(index)}1`), [[name]]);
  return index;
}

/**
 * Blanks every value under a column's header, leaving the header itself alone.
 * Returns how many cells actually held something.
 *
 * An Apollo export ships its own "email_status" column reading "verified" on
 * every row. Pointed at as a campaign's status column it makes all of them look
 * already contacted, and nothing sends.
 */
export async function clearColumnValues(
  spreadsheetId: string,
  tab: string,
  column: string,
): Promise<number> {
  const headers = await readHeaders(spreadsheetId, tab);
  const index = headers.indexOf(column);
  if (index < 0) throw new Error(`Column "${column}" is missing from the sheet`);

  const letter = columnLetter(index + 1);
  const range = a1(tab, `${letter}2:${letter}`);
  const res = await sheetsClient().spreadsheets.values.get({ spreadsheetId, range });
  const filled = (res.data.values ?? []).filter(
    (row) => String(row[0] ?? "").trim() !== "",
  ).length;
  if (filled > 0) {
    await sheetsClient().spreadsheets.values.clear({ spreadsheetId, range, requestBody: {} });
  }
  return filled;
}
