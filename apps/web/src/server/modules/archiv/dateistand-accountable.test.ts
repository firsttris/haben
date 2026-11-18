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
let lexoffice: typeof import("./lexoffice.ts");
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
    lexoffice = await import("./lexoffice.ts");
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

  it("reicht den Banner-Grund bis in die Belegansicht durch (#1322)", async () => {
    // Ohne eigene GUID, aber mit Dokument an einer anderen Zeile derselben Rechnung
    const voucher = await beleg("accountable/row/916", "purchaseinvoice", true, null, { documentPresent: true });
    const detail = (await lexoffice.legacyVoucherDetail(voucher))!;
    expect(detail.fileState.ohneBelegGrund).toBe("dokument_vorhanden");
    expect(detail.fileState.canConfirmWithoutFile).toBe(false);
    // Mit GUID und ohne Dokument bleibt es beim fehlenden Export
    const mitGuid = await beleg("accountable/row/917", "purchaseinvoice", true, "guid-917");
    expect((await lexoffice.legacyVoucherDetail(mitGuid))!.fileState.ohneBelegGrund).toBe("datei_fehlt_im_export");
    // Mit eigener GUID in einer Sammelrechnung gewinnt die GUID: für diese Zeile gibt es einen Beleg, nur die Datei fehlt im Export
    const guidMitDokument = await beleg("accountable/row/919", "purchaseinvoice", true, "guid-919", { documentPresent: true });
    const detailGuid = (await lexoffice.legacyVoucherDetail(guidMitDokument))!;
    expect(detailGuid.fileState.ohneBelegGrund).toBe("datei_fehlt_im_export");
    expect(detailGuid.fileState.canConfirmWithoutFile).toBe(false);
    await expect(dateistand.confirmWithoutFile("test-user", guidMitDokument, "")).rejects.toThrow("Beleg-GUID");
  });

  it("lässt im Stapel nach der Rücknahme erneut bestätigen (#1317)", async () => {
    // Im Stapel schreibt nur die Bestätigung Stände; ohne die Rücknahme als offenen Stand bliebe der Knopf wirkungslos
    const voucher = await beleg("accountable/row/918", "purchaseinvoice", true);
    await dateistand.confirmWithoutFile("test-user", voucher, "erste Prüfung");
    await dateistand.revokeFileConfirmation("test-user", voucher, "falsche Zeile erwischt");
    expect((await lexoffice.legacyVoucherDetail(voucher))!.fileState.canConfirmWithoutFile).toBe(true);
    await dateistand.confirmWithoutFile("test-user", voucher, "zweite Prüfung");
    expect((await lexoffice.legacyVoucherDetail(voucher))!.fileState.status).toBe("ohne_datei_bestaetigt");
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

  // Die Beleg-GUID steht vor „Dokument Vorhanden“ (#1322): Spalte Y gilt für die ganze Sammelrechnung, die GUID für genau
  // diese Zeile, deren Beleg nur im Export fehlt
  expect(ohneBelegGrund({ source: "accountable", guid: null, documentPresent: true })).toBe("dokument_vorhanden");
  expect(ohneBelegGrund({ source: "accountable", guid: "a1b2c3", documentPresent: true })).toBe("datei_fehlt_im_export");
  expect(ohneBelegGrund({ source: "accountable", guid: null, documentPresent: null })).toBe("kein_beleglink");

  // WISO und die Lexoffice-Sicherung setzen das Merkmal ohne GUID
  expect(ohneBelegGrund({ source: "wiso", guid: null })).toBe("quelle_ohne_beleg");
  expect(ohneBelegGrund({ source: "lexoffice", guid: null })).toBe("quelle_ohne_beleg");
  expect(ohneBelegGrund({ source: "wiso", guid: null, documentPresent: true })).toBe("quelle_ohne_beleg");
});
