import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * GWG über einen Beleg der Kategorie „Anlagegut“ (#1397): Der Beleg bucht auf das GWG-Konto (SKR03 0480, SKR04 0670), das
 * bei einem Beleg der Kategorie „Hardware“ Aufwand ist, bei einer Anlage aber Anlagevermögen. In der EÜR zählt nur die
 * Sofortabschreibung (§ 6 Abs. 2 EStG), sonst stünde das GWG doppelt da. Privat bezahlt hat der Beleg keinen offenen Posten
 * und zählt mit seinen eigenen Zeilen, über die Bank erst mit der Zahlung. Die gezahlte Vorsteuer bleibt Betriebsausgabe
 * (Anlage EÜR, „Gezahlte Vorsteuerbeträge“); ohne Vorsteuerabzug gehört sie zu den Anschaffungskosten (§ 9b Abs. 1 EStG).
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

describe.skipIf(!testDatabaseUrl)("EÜR: GWG über einen Beleg der Kategorie Anlagegut (Postgres)", () => {
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("../bank/index.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let reports: typeof import("./reports.ts");
  let abgleich: typeof import("./abgleich.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    bank = await import("../bank/index.ts");
    assets = await import("../buchhaltung/assets.ts");
    reports = await import("./reports.ts");
    abgleich = await import("./abgleich.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", kleinunternehmer: boolean) {
    await leeren(sql)`truncate asset_depreciations, assets, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer})`;
  }

  /** GWG für 400 € netto und 76 € Vorsteuer, gebucht am 4. November 2026 */
  async function gwgBeleg(payment: "privat" | "bank") {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 97]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `g${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Händler",
      supplierUstId: "",
      invoiceNumber: `G${docSeq}`,
      documentDate: "2026-11-04",
      dueDate: null,
      category: "anlage",
      payment,
      note: "",
      privateShare: 0,
      reverseCharge: null,
      amounts: [{ taxRate: 1900, net: 40_000, tax: 7_600 }],
      asset: { name: "Monitor", kind: "sonstiges", method: "gwg", usefulLifeMonths: null },
    } as never);
    await documents.bookDocument(actor, id);
    return id;
  }

  const ausgaben = async () => (await reports.euerForYear(2026)).ausgaben.filter((l) => l.amount !== 0).map((l) => [l.key, l.amount]);

  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Privat bezahlt: nur die Sofortabschreibung, nicht zusätzlich als Hardware (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen, false);
        await gwgBeleg("privat");
        await assets.bookDepreciation(actor, 2026, "2026-12-31");
        expect(await ausgaben()).toEqual([
          ["gwg", 40_000],
          ["vorsteuer", 7_600],
        ]);
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
      }, 60_000);

      it(`Über die Bank bezahlt: nur die Sofortabschreibung (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen, false);
        const id = await gwgBeleg("bank");
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([["10.11.26", "10.11.26", "Gebucht", "Testfirma", "Händler", "Monitor", "Ausgang", "DE02100100100006820101", "-476,00", "", "", ""]]),
            filename: `${crypto.randomUUID()}.csv`,
          },
          null,
        );
        const [t] = await sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions`;
        await bank.allocate(actor, { kind: "document", transactionId: t!.id, documentId: id, amount: t!.amount });
        await assets.bookDepreciation(actor, 2026, "2026-12-31");
        expect(await ausgaben()).toEqual([
          ["gwg", 40_000],
          ["vorsteuer", 7_600],
        ]);
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
      }, 60_000);
    }

  // Der Fall aus dem Issue: Kleinunternehmer, Ist, privat bezahlt; ohne Vorsteuerabzug zählt das GWG brutto
  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    it(`Kleinunternehmer, privat bezahlt: 476 € einmal als Sofortabschreibung (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, true);
      await gwgBeleg("privat");
      await assets.bookDepreciation(actor, 2026, "2026-12-31");
      expect(await ausgaben()).toEqual([["gwg", 47_600]]);
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
    }, 60_000);
});
