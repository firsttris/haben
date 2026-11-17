import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1317: Eine Bestätigung „ohne Datei“ lässt sich mit Grund zurücknehmen. Die Rücknahme ist eine neue Zeile, die
 * Bestätigung bleibt stehen, und der Beleg gilt wieder als offen. Belegansicht, Jahresexport (lexoffice/belege.csv) und
 * Abgleich lesen alle die jüngste Zeile und zeigen deshalb denselben Stand, ohne eigene Regel.
 */

type Dateistand = typeof import("./dateistand.ts");
type Lexoffice = typeof import("./lexoffice.ts");
type ExportModul = typeof import("./export.ts");
type DbModul = typeof import("../../db/index.ts");

let dateistand: Dateistand;
let lexoffice: Lexoffice;
let exporter: ExportModul;
let dbm: DbModul;
let importId: string;

/** Beleg im Archiv; `source` sevdesk mit „voucher/…“, damit er sich bestätigen lässt oder es am PDF scheitert */
async function beleg(lexofficeId: string, type: string, source: "sevdesk" | "accountable" = "sevdesk"): Promise<string> {
  const [row] = await dbm.db
    .insert(dbm.schema.lexofficeVouchers)
    .values({
      lexofficeId,
      importId,
      source,
      type,
      direction: type === "invoice" || type === "creditnote" ? "einnahme" : "ausgabe",
      date: "2025-03-04",
      number: `B-2025-${lexofficeId.slice(-3)}`,
      status: "unchecked",
      net: 10000,
      tax: 1900,
      gross: 11900,
      taxes: [],
      categories: [],
      raw: {},
    })
    .returning({ id: dbm.schema.lexofficeVouchers.id });
  return row!.id;
}

/** Stand, den der Abruf festgestellt hat; `ohne_datei` ist der offene Stand vor der Bestätigung */
async function stand(voucherId: string, state: "ohne_datei"): Promise<void> {
  await dbm.db.insert(dbm.schema.legacyFileStates).values({
    voucherId,
    importId,
    state,
    message: "sevDesk nennt keine Datei",
    createdBy: "test-user",
  });
}

async function verlauf(voucherId: string) {
  const { eq } = await import("drizzle-orm");
  return dbm.db
    .select({ state: dbm.schema.legacyFileStates.state, message: dbm.schema.legacyFileStates.message, createdBy: dbm.schema.legacyFileStates.createdBy })
    .from(dbm.schema.legacyFileStates)
    .where(eq(dbm.schema.legacyFileStates.voucherId, voucherId))
    .orderBy(dbm.schema.legacyFileStates.createdAt, dbm.schema.legacyFileStates.id);
}

/** Jahresexport als Dateien im Speicher, damit die Spalte „Dateistand“ wirklich aus dem Export kommt */
async function exportDateien(): Promise<Record<string, Uint8Array>> {
  const teile: Uint8Array[] = [];
  for await (const teil of exporter.exportYear(2025)) teile.push(teil);
  return unzipSync(new Uint8Array(Buffer.concat(teile.map((t) => Buffer.from(t)))));
}

describe.skipIf(!testDatabaseUrl)("Bestätigung „ohne Datei“ zurücknehmen", () => {
  beforeAll(async () => {
    await setupTestDb();
    dbm = await import("../../db/index.ts");
    dateistand = await import("./dateistand.ts");
    lexoffice = await import("./lexoffice.ts");
    exporter = await import("./export.ts");
    const { sql } = await import("drizzle-orm");
    const lauf = await dbm.db.execute<{ id: string }>(
      sql`insert into lexoffice_imports (status, source, progress) values ('fertig', 'sevdesk', '{}'::jsonb) returning id`,
    );
    importId = lauf[0]!.id;
  });

  it("nimmt mit Grund zurück und stellt den Beleg wieder auf offen", async () => {
    const voucher = await beleg("voucher/ID_901", "voucher");
    await stand(voucher, "ohne_datei");
    await dateistand.confirmWithoutFile("test-user", voucher, "Kassenbon verloren");
    await dateistand.revokeFileConfirmation("test-user", voucher, "falscher Beleg geprüft");

    // Drei Zeilen, die älteste unverändert: die Bestätigung bleibt stehen, die Rücknahme ist neu
    const zeilen = await verlauf(voucher);
    expect(zeilen.map((z) => z.state)).toEqual(["ohne_datei", "bestaetigt_ohne_datei", "bestaetigung_zurueckgenommen"]);
    expect(zeilen[0]!.message).toBe("sevDesk nennt keine Datei");
    expect(zeilen[1]!.message).toBe("In sevDesk geprüft: Kassenbon verloren");
    expect(zeilen[2]!.message).toBe("Bestätigung zurückgenommen: falscher Beleg geprüft");
    expect(zeilen[2]!.createdBy).toBe("test-user");

    // Zurück auf „ohne Datei, laut sevDesk nicht bestätigt“: der Knopf ist wieder da
    const detail = (await lexoffice.legacyVoucherDetail(voucher))!;
    expect(detail.fileState.status).toBe("ohne_datei_offen");
    expect(detail.fileState.canConfirmWithoutFile).toBe(true);
    expect(detail.fileState.history.map((h) => h.state)).toEqual(["ohne_datei", "bestaetigt_ohne_datei", "bestaetigung_zurueckgenommen"]);

    // Export zeigt denselben Stand in der Spalte „Dateistand“
    const dateien = await exportDateien();
    const belege = new TextDecoder("utf-8", { ignoreBOM: true }).decode(dateien["lexoffice/belege.csv"]);
    expect(belege).toContain(";laut sevDesk ohne Datei, nicht bestätigt");
    expect(belege).not.toContain(";ohne Datei, bestätigt");
    // … und der Verlauf steht vollständig in der eigenen Datei
    const verlaufDatei = new TextDecoder("utf-8", { ignoreBOM: true }).decode(dateien["lexoffice/dateistand.csv"]);
    expect(verlaufDatei).toContain("Bestätigung zurückgenommen");

    // Abgleich zählt den Beleg wieder als fehlende Datei
    const abgleich = await lexoffice.reconciliation();
    const jahr = abgleich.years.find((y) => y.year === 2025)!;
    expect(jahr.withoutFile).toBe(1);
    expect(jahr.files.ohneDateiOffen).toBe(1);
    expect(jahr.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")).toMatchObject({
      ok: false,
      detail: "1 laut sevDesk ohne Datei, nicht bestätigt",
    });
  });

  it("weist die Rücknahme ohne Grund ab und lässt die Bestätigung stehen", async () => {
    const voucher = await beleg("voucher/ID_902", "voucher");
    await stand(voucher, "ohne_datei");
    await dateistand.confirmWithoutFile("test-user", voucher, "");
    await expect(dateistand.revokeFileConfirmation("test-user", voucher, "   ")).rejects.toThrow("braucht einen Grund");
    expect(await verlauf(voucher)).toHaveLength(2);
    const detail = (await lexoffice.legacyVoucherDetail(voucher))!;
    expect(detail.fileState.status).toBe("ohne_datei_bestaetigt");
  });

  it("weist einen nie bestätigten Beleg ab", async () => {
    const voucher = await beleg("voucher/ID_903", "voucher");
    await stand(voucher, "ohne_datei");
    await expect(dateistand.revokeFileConfirmation("test-user", voucher, "nichts zu widerrufen")).rejects.toThrow("nicht bestätigt");
    expect(await verlauf(voucher)).toHaveLength(1);
  });

  it("lässt Rechnung und Gutschrift gesperrt", async () => {
    const rechnung = await beleg("invoice/ID_904", "invoice");
    const gutschrift = await beleg("invoice/ID_905", "creditnote");
    await expect(dateistand.confirmWithoutFile("test-user", rechnung, "")).rejects.toThrow("Original-PDF");
    await expect(dateistand.confirmWithoutFile("test-user", gutschrift, "")).rejects.toThrow("Original-PDF");
    await expect(dateistand.revokeFileConfirmation("test-user", rechnung, "nichts zu widerrufen")).rejects.toThrow("nicht bestätigt");
    await expect(dateistand.revokeFileConfirmation("test-user", gutschrift, "nichts zu widerrufen")).rejects.toThrow("nicht bestätigt");
  });

  it("zählt die Bestätigung vor der Rücknahme getrennt, im Export wie im Abgleich", async () => {
    const voucher = await beleg("voucher/ID_906", "voucher");
    await stand(voucher, "ohne_datei");
    await dateistand.confirmWithoutFile("test-user", voucher, "kein Beleg");

    const detail = (await lexoffice.legacyVoucherDetail(voucher))!;
    expect(detail.fileState.status).toBe("ohne_datei_bestaetigt");
    const dateien = await exportDateien();
    const belege = new TextDecoder("utf-8", { ignoreBOM: true }).decode(dateien["lexoffice/belege.csv"]);
    expect(belege).toContain(";ohne Datei, bestätigt");
    const abgleich = await lexoffice.reconciliation();
    const jahr = abgleich.years.find((y) => y.year === 2025)!;
    expect(jahr.files.ohneDateiBestaetigt).toBeGreaterThan(0);
  });
});
