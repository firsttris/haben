import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Gutschrift, die bereits Bezahltes erstattet (#786): Kein Kz 66 im Belegmonat, die Vorsteuerminderung steht auf dem
 * Zwischenkonto (SKR03 1548, SKR04 1434), bis das Geld zurückkommt oder verrechnet wird (§ 17 Abs. 1 Satz 2 und 8 UStG).
 * Ohne die Angabe mindert sie die Vorsteuer wie bisher; bei Kleinunternehmern gibt es keine Vorsteuer, also auch nichts
 * auf dem Zwischenkonto. Die Versteuerungsart ändert daran nichts (§ 20 UStG regelt nur die eigenen Umsätze).
 */

const ZWISCHEN: Record<"SKR03" | "SKR04", string> = { SKR03: "1548", SKR04: "1434" };
const VORSTEUER: Record<"SKR03" | "SKR04", string> = { SKR03: "1576", SKR04: "1406" };

describe.skipIf(!testDatabaseUrl)("Beleg: Gutschrift „erstattet bereits Bezahltes“ (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "erstattet-test";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", kleinunternehmer = false) {
    await leeren(sql)`truncate document_cancellations, vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      asset_depreciations, assets, journal_lines, journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer})`;
  }

  /** Entwurf einer Gutschrift über 100,00 € netto (19 %); negativ, wie eine Gutschrift einzugeben ist */
  async function gutschrift(erstattetBezahltes: boolean, documentDate = "2026-09-15") {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 72]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `gutschrift-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `GS-${fileSeq}`,
      documentDate,
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      erstattetBezahltes,
      amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }],
    });
    return id;
  }

  async function belegZeilen(documentId: string) {
    return sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'document' and e.source_id = ${documentId} and e.reverses_id is null order by l.account`;
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`${kontenrahmen}, ${versteuerung}: die Vorsteuerminderung steht im Belegmonat nicht in Kz 66`, async () => {
        await reset(kontenrahmen, versteuerung);
        const id = await gutschrift(true);
        await documents.bookDocument(actor, id);
        const lines = await belegZeilen(id);
        expect(lines).toContainEqual({ account: ZWISCHEN[kontenrahmen], debit: 0, credit: 1_900, tax_code: "VSt19" });
        expect(lines.map((l) => l.account)).not.toContain(VORSTEUER[kontenrahmen]);
        const figures = await vat.computeVatFigures({ year: 2026, month: 9 });
        expect(figures.quelle).toBe("journal");
        expect(figures.kz66).toBe(0);
      });

      it(`${kontenrahmen}, ${versteuerung}: ohne die Angabe mindert sie Kz 66 wie bisher`, async () => {
        await reset(kontenrahmen, versteuerung);
        const id = await gutschrift(false);
        await documents.bookDocument(actor, id);
        const lines = await belegZeilen(id);
        expect(lines).toContainEqual({ account: VORSTEUER[kontenrahmen], debit: 0, credit: 1_900, tax_code: "VSt19" });
        expect(lines.map((l) => l.account)).not.toContain(ZWISCHEN[kontenrahmen]);
        expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(-1_900);
      });
    }
  }

  it("an einer positiven Rechnung lehnt schon das Speichern die Angabe ab", async () => {
    await reset("SKR03", "soll");
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 73]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `rechnung-${fileSeq}.jpg` });
    await expect(
      documents.updateDocument(actor, id, {
        supplierName: "Beispiel GmbH",
        supplierUstId: "",
        invoiceNumber: "RE-1",
        documentDate: "2026-09-15",
        dueDate: null,
        category: "software",
        payment: "bank",
        note: "",
        erstattetBezahltes: true,
        amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
      }),
    ).rejects.toThrow(/nur an einer Gutschrift/);
  });

  it("ein gemeldeter Belegmonat nimmt die Angabe nicht mehr an, weder beim Speichern noch beim Buchen", async () => {
    await reset("SKR03", "ist");
    await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 9, 'sent', 0, 0, 0, 0, now())`;
    await expect(gutschrift(true, "2026-09-15")).rejects.toThrow(/schon gemeldet/);

    // Entwurf vor der Meldung angelegt: das Buchen prüft dieselbe Sperre erneut
    await reset("SKR03", "ist");
    const id = await gutschrift(true, "2026-09-15");
    await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 9, 'sent', 0, 0, 0, 0, now())`;
    await expect(documents.bookDocument(actor, id)).rejects.toThrow(/schon gemeldet/);
  });

  it("Kleinunternehmer: keine Vorsteuer, also auch nichts auf dem Zwischenkonto", async () => {
    await reset("SKR03", "ist", true);
    const id = await gutschrift(true);
    await documents.bookDocument(actor, id);
    const lines = await belegZeilen(id);
    expect(lines.map((l) => l.account)).not.toContain(ZWISCHEN.SKR03);
    expect(lines.map((l) => l.account)).not.toContain(VORSTEUER.SKR03);
    expect(lines).toContainEqual({ account: "4964", debit: 0, credit: 11_900, tax_code: "keineVSt" });
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
  });
});
