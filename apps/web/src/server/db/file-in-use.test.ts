import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";

/**
 * Spalten mit einem SHA-256, zu dem keine Datei im Speicher (DOCUMENTS_DIR) gehört. Jede andere solche Spalte muss in
 * FILE_REFERENCES stehen, sonst übersieht die Vollprüfung ihre Dateien und fileInUse löscht sie womöglich (#857).
 */
const OHNE_DATEI: Record<string, string> = {
  "bank_imports.sha256": "Auszugsdatei wird nicht gespeichert",
  "beleg_layouts.sha256": "Typst-Quelltext steht in der Tabelle",
  "beleg_layouts.approved_sha256": "Freigabe des Quelltexts",
  "company_logo.sha256": "Bild steht in der Tabelle (bytea)",
  "dunnings.pdf_sha256": "PDF steht in der Tabelle (bytea)",
  "invoices.pdf_sha256": "PDF steht in der Tabelle (bytea)",
  "invoices.xml_sha256": "XML steht in der Tabelle",
  "letterhead_background.sha256": "Bild steht in der Tabelle (bytea)",
  "payslips.sha256": "PDF steht in der Tabelle (bytea)",
  "quotes.pdf_sha256": "PDF steht in der Tabelle (bytea)",
  "store_reports.sha256": "dieselbe Datei steht in archive_files (archive_file_id)",
};

describe.skipIf(!testDatabaseUrl)("Dateiverweise im Speicher (Postgres)", () => {
  let sql: postgres.Sql;
  let files: typeof import("./file-in-use.ts");
  let db: typeof import("./index.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    files = await import("./file-in-use.ts");
    db = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("kennt jede SHA-256-Spalte im Schema: als Verweis auf eine Datei im Speicher oder als Hash ohne Datei", async () => {
    const rows = await sql<{ spalte: string }[]>`
      select table_name || '.' || column_name as spalte from information_schema.columns
      where table_schema = 'public' and column_name like '%sha256%'`;
    const verweise = files.FILE_REFERENCES.map((r) => `${r.table}.${r.column}`);
    expect(rows.map((r) => r.spalte).sort()).toEqual([...verweise, ...Object.keys(OHNE_DATEI)].sort());
  });

  it("zählt Auftrags-PDFs aus dem Umzug als Nutzung, damit das Löschen eines Belegs mit derselben Datei sie nicht entfernt", async () => {
    const sha256 = randomBytes(32).toString("hex");
    await sql.begin(async (tx) => {
      // Ohne den Auftrag und seinen Import: Fremdschlüssel greifen wie bei einem Replikat nicht
      await tx`set local session_replication_role = replica`;
      await tx`insert into legacy_order_files (order_id, filename, mime_type, sha256, size, origin)
        values (gen_random_uuid(), 'AB-1001.pdf', 'application/pdf', ${sha256}, 1, 'manuell')`;
    });
    expect(await db.db.transaction((tx) => files.fileInUse(tx, sha256))).toBe(true);
    expect(await db.db.transaction((tx) => files.fileInUse(tx, randomBytes(32).toString("hex")))).toBe(false);
  });
});
