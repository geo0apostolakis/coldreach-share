import { driveClient, sheetsClient } from "./google";
import { columnLetter, getSpreadsheetMeta, readGrid, writeRange, a1 } from "./sheets";
import { safeTabName, uniqueTabName } from "./naming";

export type DriveFile = { id: string; name: string; modifiedTime: string };

/**
 * Spreadsheets this app can already see — i.e. ones picked through the Google
 * Picker before, or created by ColdReach itself. Under the drive.file scope this
 * is intentionally *not* the user's whole Drive; the Picker is what widens it.
 */
export async function listSpreadsheets(query = ""): Promise<DriveFile[]> {
  const clauses = [
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "trashed = false",
  ];
  if (query.trim()) {
    clauses.push(`name contains '${query.trim().replace(/'/g, "\\'")}'`);
  }

  const res = await driveClient().files.list({
    q: clauses.join(" and "),
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 100,
  });

  return (res.data.files ?? []).map((file) => ({
    id: file.id ?? "",
    name: file.name ?? "Untitled",
    modifiedTime: file.modifiedTime ?? "",
  }));
}

export { safeTabName } from "./naming";

/**
 * Wraps a freshly-written range in a native Google Sheets Table — coloured
 * header, banded rows, per-column filter menus — so the app-created tab looks
 * like a real table rather than a bare grid.
 *
 * Best-effort: column *types* are deliberately not set, so nothing constrains
 * the "Sending <iso>" / "Sent" markers the engine writes into the status column.
 * If the API rejects the table the plain grid is left in place and still works.
 */
async function styleAsTable(
  spreadsheetId: string,
  sheetId: number,
  name: string,
  rowCount: number,
  columnCount: number,
): Promise<void> {
  try {
    await sheetsClient().spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addTable: {
              table: {
                name: name.slice(0, 50),
                tableId: `table_${sheetId}`,
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: rowCount,
                  startColumnIndex: 0,
                  endColumnIndex: columnCount,
                },
                rowsProperties: {
                  headerColorStyle: { rgbColor: { red: 0.204, green: 0.659, blue: 0.325 } },
                  firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
                  secondBandColorStyle: { rgbColor: { red: 0.953, green: 0.953, blue: 0.953 } },
                },
              },
            },
          },
        ],
      },
    });
  } catch {
    // A native table is a nicety; the plain grid is fully functional without it.
  }
}

export type WorkingTab = { tab: string; rows: number; statusColumn: string };

/**
 * Copies a source tab into a new tab named after the campaign, inside the same
 * spreadsheet, and makes sure the status column exists there.
 *
 * The point is that the campaign writes "Sending"/"Sent" markers into its own
 * tab, so the sheet the user picked is never modified.
 */
export async function createWorkingTab(
  spreadsheetId: string,
  sourceTab: string,
  campaignName: string,
  statusColumn: string,
  emailColumn?: string,
): Promise<WorkingTab> {
  const grid = await readGrid(spreadsheetId, sourceTab);
  if (grid.length === 0) throw new Error(`"${sourceTab}" is empty`);

  const meta = await getSpreadsheetMeta(spreadsheetId);
  const tab = uniqueTabName(
    meta.sheets.map((sheet) => sheet.title),
    safeTabName(campaignName),
  );

  const headers = grid[0].map((cell) => cell.trim());
  const body = grid.slice(1);
  const withStatus = headers.includes(statusColumn) ? headers : [...headers, statusColumn];

  // The two columns actually worked with go first: email, then its status.
  // Everything else keeps its original order behind them, so the tab opens on
  // the columns that matter instead of scrolling to find them.
  const lead = [emailColumn, statusColumn].filter(
    (name): name is string => Boolean(name) && withStatus.includes(name as string),
  );
  const finalHeaders = [...lead, ...withStatus.filter((name) => !lead.includes(name))];

  // Map each destination column back to where it sat in the source row.
  const sourceIndex = finalHeaders.map((name) => headers.indexOf(name));
  const width = finalHeaders.length;

  const values = [
    finalHeaders,
    ...body.map((row) => sourceIndex.map((index) => (index >= 0 ? (row[index] ?? "") : ""))),
  ];

  const added = await sheetsClient().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: tab,
              gridProperties: { rowCount: Math.max(values.length + 50, 100), columnCount: Math.max(width, 26) },
            },
          },
        },
      ],
    },
  });

  await writeRange(spreadsheetId, a1(tab, `A1:${columnLetter(width)}${values.length}`), values);

  const sheetId = added.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId != null) await styleAsTable(spreadsheetId, sheetId, tab, values.length, width);

  return { tab, rows: body.length, statusColumn };
}

/**
 * Creates a brand-new spreadsheet in the user's Drive from parsed CSV rows.
 * Uploaded CSVs have no home spreadsheet, so they get one of their own.
 */
export async function createSpreadsheetFromRows(
  title: string,
  tab: string,
  rows: string[][],
): Promise<{ spreadsheetId: string; title: string; tab: string; rows: number }> {
  if (rows.length === 0) throw new Error("The CSV had no rows");
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => {
    const copy = row.slice();
    while (copy.length < width) copy.push("");
    return copy;
  });

  const created = await sheetsClient().spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        {
          properties: {
            title: tab,
            gridProperties: { rowCount: Math.max(padded.length + 50, 100), columnCount: Math.max(width, 26) },
          },
        },
      ],
    },
    fields: "spreadsheetId,properties.title,sheets.properties.sheetId",
  });

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Google did not return a spreadsheet id");

  await writeRange(spreadsheetId, a1(tab, `A1:${columnLetter(width)}${padded.length}`), padded);

  const sheetId = created.data.sheets?.[0]?.properties?.sheetId;
  if (sheetId != null) await styleAsTable(spreadsheetId, sheetId, tab, padded.length, width);

  return {
    spreadsheetId,
    title: created.data.properties?.title ?? title,
    tab,
    rows: padded.length - 1,
  };
}
