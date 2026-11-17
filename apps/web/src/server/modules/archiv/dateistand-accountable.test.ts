import { beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { ohneBelegGrund, ohneDateiBestaetigbar } from "./ohne-datei.ts";

/*
 * #1235: Ein Beleg aus dem Accountable-Stapel kommt ohne Beleg-GUID und damit ohne Datei. Er steht als „Buchung ohne
 * Beleg" im Archiv und lässt sich in der Belegansicht bestätigen. Rechnungen bleiben ausgeschlossen, ein zweiter Klick
 * wird abgewiesen, und der Jahresabgleich zählt solche Buchungen nicht als fehlende Datei.
 */

type Dateistand = typeof import("./dateistand.ts");
type DbModul = typeof import("../../db/index.ts");

let dateistand: Dateistand;
let dbm: DbModul;
let importId: string;

async function beleg(lexofficeId: string, type: string, ohneBeleg: boolean, guid: string | null = null, extra: Record<string, unknown> = {}): Promise<string> {
  const [row] = await dbm.db
    .insert(dbm.schema.lexofficeVouchers)
    .values({
      lexofficeId,
      importId,
      source: "accountable",
      type,
      direction: "ausgabe",
      date: "2025-12-31",
      status: "unchecked",
      net: 0,
      tax: 0,
      gross: 0,
      taxes: [],
      categories: [],
      raw: { ohneBeleg, guid, ...extra },
    })
    .returning({ id: dbm.schema.lexofficeVouchers.id });
  return row!.id;
}

async function staende(voucherId: string) {
  const { eq } = await import("drizzle-orm");
  return dbm.db
    .select({ state: dbm.schema.legacyFileStates.state, message: dbm.schema.legacyFileStates.message })
    .from(dbm.schema.legacyFileStates)
    .where(eq(dbm.schema.legacyFileStates.voucherId, voucherId));
}

describe.skipIf(!testDatabaseUrl)("Accountable-Beleg ohne Datei bestätigen", () => {
  beforeAll(async () => {
    await setupTestDb();
    dbm = await import("../../db/index.ts");
    dateistand = await import("./dateistand.ts");
    const { sql } = await import("drizzle-orm");
    const lauf = await dbm.db.execute<{ id: string }>(
      sql`insert into lexoffice_imports (status, source, progress) values ('fertig', 'accountable', '{}'::jsonb) returning id`,
    );
    importId = lauf[0]!.id;
  });

  it("zählt eine Buchung ohne Beleg nicht als fehlende Datei", () => {
    expect(dateistand.legacyFileStatus(null, 0, true)).toBe("ohne_beleg");
    expect(dateistand.fileCheck(["ohne_beleg"]).ok).toBe(true);
  });

  it("hält die Bestätigung fest und macht den Beleg danach bestätigt", async () => {
    const voucher = await beleg("accountable/row/910", "purchaseinvoice", true);
    await dateistand.confirmWithoutFile("test-user", voucher, "Arbeitszimmer-Anteil, kein Einzelbeleg");

    const zeilen = await staende(voucher);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.state).toBe("bestaetigt_ohne_datei");
    expect(zeilen[0]!.message).toContain("Accountable-Stapel");

    // Bestätigt schlägt das Merkmal aus dem Import, im Abgleich bleibt die Buchung unauffällig
    expect(dateistand.legacyFileStatus("bestaetigt_ohne_datei", 0, true)).toBe("ohne_datei_bestaetigt");
    expect(dateistand.fileCheck(["ohne_datei_bestaetigt"]).ok).toBe(true);
  });

  it("lehnt eine zweite Bestätigung ab", async () => {
    const voucher = await beleg("accountable/row/911", "purchaseinvoice", true);
    await dateistand.confirmWithoutFile("test-user", voucher, "erstmals geprüft");
    await expect(dateistand.confirmWithoutFile("test-user", voucher, "")).rejects.toThrow("Schon bestätigt");
  });

  it("lässt eine Buchung mit Beleg-GUID nicht bestätigen", async () => {
    const voucher = await beleg("accountable/row/914", "purchaseinvoice", true, "guid-914");
    await expect(dateistand.confirmWithoutFile("test-user", voucher, "")).rejects.toThrow("Beleg-GUID");
  });

  it("lässt eine Buchung ohne GUID nicht bestätigen, wenn Accountable ein Dokument führt", async () => {
    // Daten.xlsx, Spalte Y: zu der Rechnung gibt es eine Datei (Sammelrechnung, die Datei hängt an einer anderen Zeile)
    const voucher = await beleg("accountable/row/915", "purchaseinvoice", true, null, { documentPresent: true });
    await expect(dateistand.confirmWithoutFile("test-user", voucher, "")).rejects.toThrow("Dokument vorhanden");
    expect(await staende(voucher)).toHaveLength(0);
  });

  it("lässt eine Ausgangsrechnung nicht ohne Datei bestätigen", async () => {
    const voucher = await beleg("accountable/row/912", "salesinvoice", false);
    await expect(dateistand.confirmWithoutFile("test-user", voucher, "")).rejects.toThrow("Original-PDF");
  });

  it("verlangt bei Belegen mit Datei die Bestätigung über den Abruf", async () => {
    const voucher = await beleg("accountable/row/913", "purchaseinvoice", false);
    await expect(dateistand.confirmWithoutFile("test-user", voucher, "")).rejects.toThrow("Erst ein Abruf");
  });
});

it("nennt den Grund je Quelle und Beleg-GUID (#1235)", async () => {
  // Ohne Beleglink: der Stapel nennt keine GUID, bestätigen ist erlaubt
  const ohneLink = ohneBelegGrund({ source: "accountable", guid: null });
  expect(ohneLink).toBe("kein_beleglink");
  expect(ohneDateiBestaetigbar({ source: "accountable", lexofficeId: "accountable/row/1", type: "purchaseinvoice", guid: null })).toBe(true);

  // Mit GUID: die Datei fehlt nur im Export, bestätigen ist gesperrt
  expect(ohneBelegGrund({ source: "accountable", guid: "a1b2c3" })).toBe("datei_fehlt_im_export");
  expect(ohneDateiBestaetigbar({ source: "accountable", lexofficeId: "accountable/row/2", type: "purchaseinvoice", guid: "a1b2c3" })).toBe(false);

  // WISO und die Lexoffice-Sicherung setzen das Merkmal ohne GUID
  expect(ohneBelegGrund({ source: "wiso", guid: null })).toBe("quelle_ohne_beleg");
  expect(ohneBelegGrund({ source: "lexoffice", guid: null })).toBe("quelle_ohne_beleg");
});
