import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Eigene Sachkonten (#270, Stufe 1), Beleg und Aufteilung: Ein Beleg oder eine Zeile der Aufteilung bucht auf das eigene
 * Konto statt auf das Konto der Kategorie; Voranmeldung und EÜR rechnen mit der Elternkategorie. Storno und „Neu erfassen“
 * behalten das Konto. Alle Daten sind erfunden.
 */

const KONTEN = {
  SKR03: { eigen: "4999", software: "4964", buero: "4930", vorsteuer: "1576", verbindlichkeiten: "1600" },
  SKR04: { eigen: "6999", software: "6837", buero: "6815", vorsteuer: "1406", verbindlichkeiten: "3300" },
} as const;

describe.skipIf(!testDatabaseUrl)("Beleg mit eigenem Konto (Postgres, #270)", () => {
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let konten: typeof import("../eigene-konten/index.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    cancellation = await import("./cancellation.ts");
    konten = await import("../eigene-konten/index.ts");
    reports = await import("../auswertungen/reports.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate document_cancellations, vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      asset_depreciations, assets, journal_lines, journal_entries, document_splits, document_amounts, documents, own_accounts, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'soll', ${kontenrahmen}, false)`;
    return konten.createOwnAccount(actor, { account: KONTEN[kontenrahmen].eigen, name: "Software: Entwicklung", parentCategory: "software" });
  }

  async function draft(ownAccountId: string | null, extra: Record<string, unknown> = {}) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 83]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `konto-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Softwarehaus Nord GmbH",
      supplierUstId: "",
      invoiceNumber: `SN-${fileSeq}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      ownAccountId,
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
      splits: [],
      ...extra,
    } as never);
    return id;
  }

  const lines = (id: string) =>
    sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'document' and e.source_id = ${id} and e.reverses_id is null order by l.account`;

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    const k = KONTEN[kontenrahmen];

    describe(kontenrahmen, () => {
      it("bucht den Beleg auf das eigene Konto; Vorsteuer und Verbindlichkeit wie bei der Kategorie, die Voranmeldung zählt die Vorsteuer", async () => {
        const own = await reset(kontenrahmen);
        const id = await draft(own);
        expect((await documents.getDocument(id))!.document).toMatchObject({ category: "software", ownAccountId: own });
        await documents.bookDocument(actor, id);
        expect(await lines(id)).toEqual(
          [
            { account: k.eigen, debit: 10_000, credit: 0, tax_code: "VSt19" },
            { account: k.vorsteuer, debit: 1_900, credit: 0, tax_code: "VSt19" },
            { account: k.verbindlichkeiten, debit: 0, credit: 11_900, tax_code: null },
          ].sort((a, b) => a.account.localeCompare(b.account)),
        );
        expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(1_900);
      });

      it("die EÜR zählt das eigene Konto wie die Kategorie (gleiche Zeile, gleicher Betrag)", async () => {
        const own = await reset(kontenrahmen);
        // Privat bezahlt: die Ausgabe zählt in der EÜR sofort, ohne Zahlung über die Bank
        await documents.bookDocument(actor, await draft(null, { payment: "privat" }));
        const ohne = (await reports.euerForYear(2026)).ausgaben.find((l) => l.key === "ausgabe:software")?.amount;
        await documents.bookDocument(actor, await draft(own, { payment: "privat" }));
        const beide = (await reports.euerForYear(2026)).ausgaben.find((l) => l.key === "ausgabe:software")?.amount;
        expect(ohne).toBe(10_000);
        expect(beide).toBe(20_000);
      });

      it("Aufteilung: die Zeile mit eigenem Konto bucht dort, die andere wie bisher", async () => {
        const own = await reset(kontenrahmen);
        const id = await draft(null, {
          category: null,
          splits: [
            { category: "software", ownAccountId: own, taxRate: 1900, net: 6_000 },
            { category: "buero", taxRate: 1900, net: 4_000 },
          ],
        });
        expect((await documents.getDocument(id))!.splits.map((s) => [s.category, s.ownAccountId])).toEqual([
          ["software", own],
          ["buero", null],
        ]);
        await documents.bookDocument(actor, id);
        expect(
          (await lines(id))
            .filter((l) => l.debit > 0)
            .map((l) => [l.account, l.debit])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ).toEqual(
          [
            [k.eigen, 6_000],
            [k.buero, 4_000],
            [k.vorsteuer, 1_900],
          ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        );
      });

      it("lehnt ein Konto ab, das nicht zur Kategorie des Belegs oder der Zeile passt, und ein unbekanntes", async () => {
        const own = await reset(kontenrahmen);
        await expect(draft(own, { category: "buero" })).rejects.toThrow(/Elternkategorie/);
        await expect(draft("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/Konto nicht gefunden/);
        await expect(draft(null, { category: null, splits: [{ category: "buero", ownAccountId: own, taxRate: 1900, net: 10_000 }] })).rejects.toThrow(
          /Elternkategorie/,
        );
        // ohne Kategorie kein eigenes Konto am Beleg
        await expect(draft(own, { category: null })).rejects.toThrow(/Kategorie/);
      });

      it("Storno spiegelt das eigene Konto; „Neu erfassen“ übernimmt es", async () => {
        const own = await reset(kontenrahmen);
        const id = await draft(own);
        await documents.bookDocument(actor, id);
        await cancellation.cancelDocument(actor, id, { reason: "Falsch erfasst" }, "2026-10-05");
        const eigen = await sql`select coalesce(sum(l.debit - l.credit), 0)::int as saldo from journal_lines l where l.account = ${k.eigen}`;
        expect(eigen[0]!.saldo).toBe(0);
        const reentry = await cancellation.reenterDocument(actor, id);
        expect((await documents.getDocument(reentry))!.document.ownAccountId).toBe(own);
      });

      it("ein verwendetes eigenes Konto lässt sich nicht löschen, nur archivieren", async () => {
        const own = await reset(kontenrahmen);
        await draft(own);
        await expect(konten.deleteOwnAccount(actor, own)).rejects.toThrow(/verwendet/);
        await konten.setOwnAccountArchived(actor, own, true);
      });
    });
  }
});
