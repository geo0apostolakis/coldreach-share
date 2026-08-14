import { randomUUID } from "node:crypto";
import { controlSpreadsheetId } from "./google";
import { FOLDERS_TAB, FOLDER_HEADERS, ensureControlTabs } from "./control";
import { a1, appendRow, columnLetter, readObjects, writeRange } from "./sheets";
import type { Folder } from "./types";

type Row = { rowNumber: number; values: Record<string, string> };

function toFolder(row: Row): Folder {
  const v = row.values;
  return {
    id: v.id ?? "",
    name: v.name ?? "",
    color: v.color || "brand",
    note: v.note ?? "",
    createdAt: v.createdAt ?? "",
    archivedAt: v.archivedAt ?? "",
  };
}

function toRowValues(folder: Folder): string[] {
  const flat: Record<string, string> = {
    id: folder.id,
    name: folder.name,
    color: folder.color,
    note: folder.note,
    createdAt: folder.createdAt,
    archivedAt: folder.archivedAt,
  };
  return FOLDER_HEADERS.map((header) => flat[header] ?? "");
}

async function loadRows(): Promise<Row[]> {
  await ensureControlTabs();
  const { rows } = await readObjects(controlSpreadsheetId(), FOLDERS_TAB);
  return rows.filter((row) => row.values.id);
}

/** Archived folders stay in the sheet but drop out of the UI. */
export async function listFolders(includeArchived = false): Promise<Folder[]> {
  const folders = (await loadRows()).map(toFolder);
  return includeArchived ? folders : folders.filter((folder) => !folder.archivedAt);
}

export async function getFolder(id: string): Promise<Folder | null> {
  const row = (await loadRows()).find((candidate) => candidate.values.id === id);
  return row ? toFolder(row) : null;
}

export async function createFolder(input: { name: string; color?: string; note?: string }): Promise<Folder> {
  await ensureControlTabs();
  const folder: Folder = {
    id: randomUUID(),
    name: input.name,
    color: input.color || "brand",
    note: input.note ?? "",
    createdAt: new Date().toISOString(),
    archivedAt: "",
  };
  await appendRow(controlSpreadsheetId(), FOLDERS_TAB, toRowValues(folder));
  return folder;
}

export async function updateFolder(id: string, patch: Partial<Folder>): Promise<Folder | null> {
  const row = (await loadRows()).find((candidate) => candidate.values.id === id);
  if (!row) return null;
  const merged: Folder = { ...toFolder(row), ...patch, id };
  const range = a1(
    FOLDERS_TAB,
    `A${row.rowNumber}:${columnLetter(FOLDER_HEADERS.length)}${row.rowNumber}`,
  );
  await writeRange(controlSpreadsheetId(), range, [toRowValues(merged)]);
  return merged;
}

/**
 * Archive rather than delete. Campaigns keep their folderId, so un-archiving
 * restores the grouping instead of orphaning every campaign that pointed here.
 */
export async function archiveFolder(id: string): Promise<boolean> {
  const updated = await updateFolder(id, { archivedAt: new Date().toISOString() });
  return updated !== null;
}
