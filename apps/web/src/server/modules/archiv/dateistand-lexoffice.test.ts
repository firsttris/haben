import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1318: Eine Buchung ohne Beleg aus der Lexoffice-Sicherung trägt `raw.ohneBeleg`, in der Quelle hatte sie nie ein
 * Belegbild. Sie lässt sich deshalb bestätigen, so wie eine Accountable-Buchung ohne Beleg-GUID. Eine Ausgabe, deren
 * Datei nur im Export fehlt, trägt das Merkmal nicht und bleibt gesperrt; Rechnung und Gutschrift ebenso. Export und
 * Abgleich lesen dieselbe Entscheidung wie die Belegansicht.
 */

type Dateistand = typeof import("./dateistand.ts");
type Archiv = typeof import("./lexoffice.ts");
type Exporter = typeof import("./export.ts");
type DbModul = typeof import("../../db/index.ts");

let dateistand: Dateistand;
let archiv: Archiv;
let exporter: Exporter;
let dbm: DbModul;
let importId: string;

/** Beleg aus der Sicherung; `ohneBeleg` setzt der Import nur bei Buchungen ohne Belegbild */
async function beleg(lexofficeId: string, options: { type?: string; ohneBeleg?: boolean; jahr?: string } = {}): Promise<string> {
  const [row] = await dbm.db
    .insert(dbm.schema.lexofficeVouchers)
    .values({
      lexofficeId,
      importId,
      source: "lexoffice",
      type: options.type ?? "purchaseinvoice",
      direction: "ausgabe",
      number: `B-${lexofficeId}`,
      date: options.jahr ?? "2025-03-12",
      status: "unchecked",
      net: 0,
      tax: 0,
      gross: 0,
      taxes: [],
      categories: [],
      raw: { ohneBeleg: options.ohneBeleg ?? false, remark: "Buchung ohne Beleg: Beispiel" },
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

/** Jahresexport auspacken: die Belegliste und der Verlauf des Dateistands */
async function exportDateien(year: number) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of exporter.exportYear(year, new Date("2026-11-15T10:00:00Z"))) chunks.push(chunk);
  const files = unzipSync(Buffer.concat(chunks));
  return {
    belege: new TextDecoder().decode(files["lexoffice/belege.csv"]),
    verlauf: new TextDecoder().decode(files["lexoffice/dateistand.csv"]),
  };
}

describe.skipIf(!testDatabaseUrl)("Lexoffice-Sicherung: Buchung ohne Beleg bestätigen", () => {
  beforeAll(async () => {
    await setupTestDb();
    dbm = await import("../../db/index.ts");
    dateistand = await import("./dateistand.ts");
    archiv = await import("./lexoffice.ts");
    exporter = await import("./export.ts");
    const { sql } = await import("drizzle-orm");
    const lauf = await dbm.db.execute<{ id: string }>(
      sql`insert into lexoffice_imports (status, source, progress) values ('fertig', 'lexoffice', '{}'::jsonb) returning id`,
    );
    importId = lauf[0]!.id;
  });

  it("lässt eine Buchung ohne Beleg aus der Sicherung zu", async () => {
    const voucher = await beleg("fVoucher-7001", { ohneBeleg: true });
    // Die Ansicht zeigt den Grund und den Knopf an derselben Stelle wie bisher
    const vorher = await archiv.legacyVoucherDetail(voucher);
    expect(vorher!.fileState).toMatchObject({ status: "ohne_beleg", canConfirmWithoutFile: true, ohneBelegGrund: "quelle_ohne_beleg" });

    await dateistand.confirmWithoutFile("test-user", voucher, "Kassenbon liegt nicht vor");

    const zeilen = await staende(voucher);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.state).toBe("bestaetigt_ohne_datei");
    expect(zeilen[0]!.message).toBe("Lexoffice-Sicherung: Kassenbon liegt nicht vor");

    const nachher = await archiv.legacyVoucherDetail(voucher);
    expect(nachher!.fileState).toMatchObject({ status: "ohne_datei_bestaetigt", canConfirmWithoutFile: false });
  });

  it("weist eine Buchung ab, die die Sicherung mit Beleg führt", async () => {
    const voucher = await beleg("fVoucher-7002", { ohneBeleg: false });
    await expect(dateistand.confirmWithoutFile("test-user", voucher, "")).rejects.toThrow("fehlt nur im Export");
    expect(await staende(voucher)).toHaveLength(0);
    // In der Ansicht erscheint dafür kein Knopf
    expect((await archiv.legacyVoucherDetail(voucher))!.fileState.canConfirmWithoutFile).toBe(false);
  });

  it("hält Rechnung und Gutschrift aus der Sicherung gesperrt, auch als Buchung ohne Beleg", async () => {
    const rechnung = await beleg("fVoucher-7003", { type: "salesinvoice", ohneBeleg: true });
    await expect(dateistand.confirmWithoutFile("test-user", rechnung, "")).rejects.toThrow("Original-PDF");
    const gutschrift = await beleg("fVoucher-7004", { type: "creditnote", ohneBeleg: true });
    await expect(dateistand.confirmWithoutFile("test-user", gutschrift, "")).rejects.toThrow("Original-PDF");

    expect(await staende(rechnung)).toHaveLength(0);
    expect(await staende(gutschrift)).toHaveLength(0);
    expect((await archiv.legacyVoucherDetail(rechnung))!.fileState.canConfirmWithoutFile).toBe(false);
    expect((await archiv.legacyVoucherDetail(gutschrift))!.fileState.canConfirmWithoutFile).toBe(false);
  });

  it("zählt nach der Bestätigung wie die Ansicht, im Export und im Abgleich", async () => {
    const voucher = await beleg("fVoucher-7005", { ohneBeleg: true, jahr: "2026-05-04" });
    expect((await exportDateien(2026)).belege).toContain("Buchung ohne Beleg");

    await dateistand.confirmWithoutFile("test-user", voucher, "Buchung ohne Belegbild in der Quelle");

    // Die Gegenprobe am Export: dieselbe Entscheidung wie in der Ansicht
    const nachher = await exportDateien(2026);
    expect(nachher.belege).toContain("ohne Datei, bestätigt");
    expect(nachher.belege).not.toContain("Buchung ohne Beleg");
    expect(nachher.verlauf).toContain("Lexoffice-Sicherung: Buchung ohne Belegbild in der Quelle");

    // Und der offene Punkt im Abgleich ist weg
    const jahr = (await archiv.reconciliation()).years.find((y) => y.year === 2026)!;
    expect(jahr.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")).toMatchObject({ ok: true, detail: "1 ohne Datei (bestätigt), übrige mit Datei" });
  });
});
