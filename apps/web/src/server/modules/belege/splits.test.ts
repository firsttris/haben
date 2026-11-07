import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Aufteilung eines Eingangsbelegs auf mehrere Kontierungszeilen (#271). Beispiel aus dem Issue, je 19 %: 100 € Handelsware,
 * 50 € Software, 20 € Bürobedarf = 170 € netto, 32,30 € Vorsteuer, 202,30 € Zahlbetrag. Ein Beleg, ein offener Posten,
 * eine Buchung mit drei Aufwandszeilen; Voranmeldung, EÜR und DATEV bilden dieselbe Aufteilung ab.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const KONTEN = {
  SKR03: { ware: "3200", software: "4964", buero: "4930", vorsteuer: "1576", verbindlichkeiten: "1600", privat: "1890", bank: "1200" },
  SKR04: { ware: "5200", software: "6837", buero: "6815", vorsteuer: "1406", verbindlichkeiten: "3300", privat: "2180", bank: "1800" },
} as const;

const ISSUE_SPLITS = [
  { category: "wareneinkauf" as const, taxRate: 1900 as const, net: 10_000 },
  { category: "software" as const, taxRate: 1900 as const, net: 5_000 },
  { category: "buero" as const, taxRate: 1900 as const, net: 2_000 },
];

describe.skipIf(!testDatabaseUrl)("Beleg aufteilen (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  let bank: typeof import("../bank/bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    cancellation = await import("./cancellation.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    datev = await import("../auswertungen/datev-export.ts");
    bank = await import("../bank/bank.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", kleinunternehmer = false) {
    await sql`truncate document_cancellations, vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      asset_depreciations, assets, journal_lines, journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer})`;
  }

  type Options = {
    payment?: "bank" | "privat" | "kasse";
    amounts?: { taxRate: 1900 | 700 | 0; net: number; tax: number }[];
    splits?: { category: "wareneinkauf" | "software" | "buero" | "literatur" | "anlage"; taxRate: 1900 | 700 | 0; net: number }[];
    privateShare?: number;
    reverseCharge?: "eu" | null;
    currency?: string;
  };

  async function draft(options: Options = {}) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 71]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `split-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Bürohaus Nord GmbH",
      supplierUstId: "",
      invoiceNumber: `BN-${fileSeq}`,
      documentDate: "2026-09-15",
      dueDate: null,
      // Mit Aufteilung zählt die Kategorie des Belegs nicht; sie wird geleert
      category: "sonstiges",
      payment: options.payment ?? "bank",
      note: "",
      privateShare: options.privateShare ?? 0,
      reverseCharge: options.reverseCharge ?? null,
      currency: options.currency ?? "EUR",
      exchangeRate: options.currency ? "1,1" : null,
      amounts: (options.amounts ?? [{ taxRate: 1900, net: 17_000, tax: 3_230 }]).map((a) =>
        options.currency ? { ...a, net: 0, tax: 0, originalNet: a.net, originalTax: a.tax } : a,
      ),
      splits: options.splits ?? ISSUE_SPLITS,
    });
    return id;
  }

  async function entryLines(documentId: string) {
    return sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'document' and e.source_id = ${documentId} and e.reverses_id is null order by l.account`;
  }

  /** Erwartete Buchungszeilen in der Reihenfolge von entryLines (nach Konto) */
  const byAccount = <T extends { account: string }>(lines: T[]) => [...lines].sort((a, b) => a.account.localeCompare(b.account));

  async function importAndAllocate(documentId: string, payments: { date: string; amount: string; cents: number }[]) {
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv(
          payments.map((p) => [p.date, p.date, "Gebucht", "Testfirma", "Bürohaus Nord", "BN", "Ausgang", "DE02100100100006820101", p.amount, "", "", ""]),
        ),
        filename: `konto-${fileSeq}.csv`,
      },
      null,
    );
    const transactions = await sql`select id, amount from bank_transactions order by booking_date`;
    for (const t of transactions) {
      await bank.allocate(actor, { kind: "document", transactionId: t.id as string, documentId, amount: t.amount as number });
    }
  }

  const ausgabe = (euer: Awaited<ReturnType<typeof reports.euerForYear>>, key: string) => euer.ausgaben.find((l) => l.key === key)?.amount ?? 0;

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      const k = KONTEN[kontenrahmen];

      it(`${kontenrahmen}, ${versteuerung}: eine Buchung mit drei Aufwandszeilen, ein offener Posten, Teilzahlungen ohne doppelte Steuer`, async () => {
        await reset(kontenrahmen, versteuerung);
        const id = await draft();
        const saved = (await documents.getDocument(id))!;
        expect(saved.document.category).toBeNull();
        expect(saved.splits.map(({ position, category, taxRate, net, tax }) => ({ position, category, taxRate, net, tax }))).toEqual([
          { position: 1, category: "wareneinkauf", taxRate: 1900, net: 10_000, tax: 1_900 },
          { position: 2, category: "software", taxRate: 1900, net: 5_000, tax: 950 },
          { position: 3, category: "buero", taxRate: 1900, net: 2_000, tax: 380 },
        ]);
        expect(documents.bookingIssues(saved.document, saved.amounts, "2026-09-20", saved.splits)).toEqual([]);
        await documents.bookDocument(actor, id);

        expect(await entryLines(id)).toEqual(
          byAccount([
            { account: k.ware, debit: 10_000, credit: 0, tax_code: "VSt19" },
            { account: k.software, debit: 5_000, credit: 0, tax_code: "VSt19" },
            { account: k.buero, debit: 2_000, credit: 0, tax_code: "VSt19" },
            { account: k.vorsteuer, debit: 3_230, credit: 0, tax_code: "VSt19" },
            { account: k.verbindlichkeiten, debit: 0, credit: 20_230, tax_code: null },
          ]),
        );

        // Voranmeldung: Vorsteuer laut Beleg im Monat des Belegdatums, bei Ist und Soll
        const september = await vat.computeVatFigures({ year: 2026, month: 9 });
        expect(september.kz66).toBe(3_230);
        expect(september.inputTax).toEqual([expect.objectContaining({ documentId: id, base: 17_000, tax: 3_230 })]);
        expect((await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);

        // Genau ein offener Posten über den ganzen Betrag
        expect((await bank.openItems()).filter((i) => i.type === "document")).toEqual([expect.objectContaining({ id, open: -20_230 })]);
        expect((await reports.openPositions("2026-09-20")).payables.map((p) => [p.id, p.open])).toEqual([[id, 20_230]]);

        // Zwei Teilzahlungen am gemeinsamen Beleg erledigen alle Zeilen; die Vorsteuer steht nur einmal in der EÜR
        await importAndAllocate(id, [
          { date: "20.09.26", amount: "-100,00", cents: -10_000 },
          { date: "05.10.26", amount: "-102,30", cents: -10_230 },
        ]);
        expect((await bank.openItems()).filter((i) => i.type === "document")).toEqual([]);
        expect((await reports.openPositions("2026-10-05")).payables).toEqual([]);
        const euer = await reports.euerForYear(2026);
        expect(ausgabe(euer, "ausgabe:wareneinkauf")).toBe(10_000);
        expect(ausgabe(euer, "ausgabe:software")).toBe(5_000);
        expect(ausgabe(euer, "ausgabe:buero")).toBe(2_000);
        expect(ausgabe(euer, "ausgabe:sonstiges")).toBe(0);
        expect(ausgabe(euer, "vorsteuer")).toBe(3_230);
        expect(euer.totalAusgaben).toBe(20_230);
        expect((await abgleich.euerAbgleich(2026)).zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
        // Die Zahlung bucht nur Verbindlichkeiten an Bank, die Aufteilung bleibt in der Belegbuchung
        const [{ saldo }] = (await sql`select coalesce(sum(l.debit - l.credit), 0)::int as saldo from journal_lines l
          where l.account = ${k.verbindlichkeiten}`) as unknown as [{ saldo: number }];
        expect(saldo).toBe(0);

        // DATEV: jede Aufwandszeile gegen die Verbindlichkeit, die Vorsteuer einmal
        await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003" });
        const stack = parseDatevBuchungsstapel((await datev.datevExport(2026, new Date(2026, 9, 6, 8, 0, 0))).bytes);
        const documentRows = stack.bookings.filter((b) => b.contraAccount === k.verbindlichkeiten).map((b) => `${b.account}/${b.amount}`);
        expect(documentRows.sort()).toEqual([`${k.ware}/10000`, `${k.software}/5000`, `${k.buero}/2000`, `${k.vorsteuer}/3230`].sort());
      });

      it(`${kontenrahmen}, ${versteuerung}: Storno nimmt alle Zeilen zurück, Neuerfassung übernimmt die Aufteilung`, async () => {
        await reset(kontenrahmen, versteuerung);
        const id = await draft({ payment: "privat" });
        await documents.bookDocument(actor, id);
        // September schon gemeldet: der Storno steht im Oktober
        await sql`insert into vat_returns (year, month, status, source, sent_at, locked_at) values (2026, 9, 'sent', 'manuell', now(), now())`;
        await cancellation.cancelDocument(actor, id, { reason: "Falsch aufgeteilt" }, "2026-10-05");

        const balances = await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
          where e.source_id = ${id} group by l.account order by l.account`;
        expect(balances.map((b) => b.account).sort()).toEqual([k.ware, k.software, k.buero, k.vorsteuer, k.privat].sort());
        expect(balances.every((b) => b.saldo === 0)).toBe(true);
        expect((await vat.computeVatFigures({ year: 2026, month: 10 })).kz66).toBe(-3_230);
        // Privat bezahlt: Ausgabe im September, Storno im Oktober; je Kategorie zusammen null
        const euer = await reports.euerForYear(2026);
        for (const key of ["ausgabe:wareneinkauf", "ausgabe:software", "ausgabe:buero", "vorsteuer"]) expect(ausgabe(euer, key)).toBe(0);
        // Der gebuchte Beleg und seine Zeilen bleiben, wie sie sind
        expect((await documents.getDocument(id))!.splits).toHaveLength(3);

        const reentry = await cancellation.reenterDocument(actor, id);
        const copy = (await documents.getDocument(reentry))!;
        expect(copy.document).toMatchObject({ status: "neu", category: null, replacesDocumentId: id });
        expect(copy.splits.map(({ position, category, net, tax }) => ({ position, category, net, tax }))).toEqual([
          { position: 1, category: "wareneinkauf", net: 10_000, tax: 1_900 },
          { position: 2, category: "software", net: 5_000, tax: 950 },
          { position: 3, category: "buero", net: 2_000, tax: 380 },
        ]);
      });
    }

    it(`${kontenrahmen}: Kleinunternehmer: Steueranteil je Zeile im Aufwand, keine Vorsteuer`, async () => {
      await reset(kontenrahmen, "ist", true);
      const id = await draft({ payment: "privat" });
      await documents.bookDocument(actor, id);
      const k = KONTEN[kontenrahmen];
      expect(await entryLines(id)).toEqual(
        byAccount([
          { account: k.ware, debit: 11_900, credit: 0, tax_code: "keineVSt" },
          { account: k.software, debit: 5_950, credit: 0, tax_code: "keineVSt" },
          { account: k.buero, debit: 2_380, credit: 0, tax_code: "keineVSt" },
          { account: k.privat, debit: 0, credit: 20_230, tax_code: null },
        ]),
      );
      expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
      const euer = await reports.euerForYear(2026);
      expect(ausgabe(euer, "ausgabe:wareneinkauf")).toBe(11_900);
      expect(ausgabe(euer, "vorsteuer")).toBe(0);
    });
  }

  it("mehrere Zeilen mit gleichem Satz und gleicher Kategorie, dazu 7 %: Rundung je Satz nachvollziehbar", async () => {
    await reset("SKR03", "soll");
    const id = await draft({
      amounts: [
        { taxRate: 1900, net: 9_999, tax: 1_900 },
        { taxRate: 700, net: 2_000, tax: 140 },
      ],
      splits: [
        { category: "software", taxRate: 1900, net: 3_333 },
        { category: "buero", taxRate: 1900, net: 3_333 },
        { category: "software", taxRate: 1900, net: 3_333 },
        { category: "literatur", taxRate: 700, net: 2_000 },
      ],
    });
    const saved = (await documents.getDocument(id))!;
    // 19,00 € auf drei gleiche Zeilen: je 6,33 €, der Cent Rest an die erste (größte) Zeile
    expect(saved.splits.map((s) => s.tax)).toEqual([634, 633, 633, 140]);
    await documents.bookDocument(actor, id);
    expect(await entryLines(id)).toEqual(
      byAccount([
        { account: "4964", debit: 6_666, credit: 0, tax_code: "VSt19" },
        { account: "4930", debit: 3_333, credit: 0, tax_code: "VSt19" },
        { account: "4940", debit: 2_000, credit: 0, tax_code: "VSt7" },
        { account: "1576", debit: 1_900, credit: 0, tax_code: "VSt19" },
        { account: "1571", debit: 140, credit: 0, tax_code: "VSt7" },
        { account: "1600", debit: 0, credit: 14_039, tax_code: null },
      ]),
    );
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(2_040);
  });

  it("lehnt ab: Summe passt nicht, § 13b, Privatanteil, Fremdwährung, Anlagegut", async () => {
    await reset("SKR03", "soll");
    const mismatch = await draft({ splits: ISSUE_SPLITS.slice(0, 2) });
    await expect(documents.bookDocument(actor, mismatch)).rejects.toThrow("Aufteilung 19 %: Zeilen zusammen 150,00 € netto, Beleg 170,00 €");
    const rc = await draft({ reverseCharge: "eu" });
    await expect(documents.bookDocument(actor, rc)).rejects.toThrow(/§ 13b mit Aufteilung/);
    const privat = await draft({ privateShare: 20 });
    await expect(documents.bookDocument(actor, privat)).rejects.toThrow(/Privatanteil mit Aufteilung/);
    const usd = await draft({ currency: "USD" });
    await expect(documents.bookDocument(actor, usd)).rejects.toThrow(/Fremdwährung mit Aufteilung/);
    const asset = await draft({
      splits: [
        { category: "anlage", taxRate: 1900, net: 15_000 },
        { category: "software", taxRate: 1900, net: 2_000 },
      ],
    });
    await expect(documents.bookDocument(actor, asset)).rejects.toThrow(/Anlagegüter lassen sich nicht aufteilen/);
    expect(await sql`select count(*)::int as n from journal_entries`).toEqual([{ n: 0 }]);
  });

  it("Netto einer Zeile über dem Höchstwert: Hinweis statt Datenbankfehler", async () => {
    await reset("SKR03", "soll");
    // 30 Mio. € passen in die Eingabe, aber nicht in die int4-Spalte document_splits.net
    const tooLarge = [
      { category: "software" as const, taxRate: 1900 as const, net: 3_000_000_000 },
      { category: "buero" as const, taxRate: 1900 as const, net: -2_999_983_000 },
    ];
    await expect(draft({ splits: tooLarge })).rejects.toThrow(/zu groß/);
  });

  it("ohne Zeilen gilt wieder die Kategorie des Belegs", async () => {
    await reset("SKR03", "soll");
    const id = await draft();
    await documents.updateDocument(actor, id, {
      supplierName: "Bürohaus Nord GmbH",
      supplierUstId: "",
      invoiceNumber: "BN-x",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "buero",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 17_000, tax: 3_230 }],
      splits: [],
    });
    const saved = (await documents.getDocument(id))!;
    expect(saved.splits).toEqual([]);
    expect(saved.document.category).toBe("buero");
    await documents.bookDocument(actor, id);
    expect((await entryLines(id)).map((l) => l.account)).toEqual(["1576", "1600", "4930"]);
  });

  it("gebucht: Zeilen gesperrt und im Siegel des Belegs; ein Eingriff fällt bei der Prüfung auf", async () => {
    await reset("SKR04", "ist");
    const id = await draft();
    await documents.bookDocument(actor, id);
    await expect(sql`update document_splits set net = 1 where document_id = ${id}`).rejects.toThrow(/gebucht/);
    await expect(sql`delete from document_splits where document_id = ${id}`).rejects.toThrow(/gebucht/);
    await expect(
      sql`insert into document_splits (document_id, position, category, tax_rate, net, tax) values (${id}, 4, 'software', 1900, 1, 0)`,
    ).rejects.toThrow(/gebucht/);
    const [seal] = await sql`select columns from seals where table_name = 'documents' and row_id = ${id}`;
    expect(Object.keys(seal!.columns as object)).toContain("document_splits");
    // Siegel früherer Tests überdauern das Leeren der Tabellen; geprüft wird dieser Beleg
    const problems = async () => (await sql`select tabelle, zeile, befund from haben_integrity_problems(100)`).filter((p) => p.zeile === id);
    expect(await problems()).toEqual([]);
    // Im Audit-Log steht jede Zeile
    expect(
      await sql`select count(*)::int as n from audit_log where table_name = 'document_splits' and action = 'INSERT' and new_value ->> 'document_id' = ${id}`,
    ).toEqual([{ n: 3 }]);

    // An der Sperre vorbei geändert: Das Siegel passt nicht mehr
    await sql.begin(async (tx) => {
      await tx`alter table document_splits disable trigger document_splits_locked`;
      await tx`alter table document_splits disable trigger document_splits_audit`;
      await tx`update document_splits set category = 'buero' where document_id = ${id} and position = 1`;
      await tx`alter table document_splits enable trigger document_splits_locked`;
      await tx`alter table document_splits enable trigger document_splits_audit`;
    });
    expect(await problems()).toEqual([{ tabelle: "documents", zeile: id, befund: "Inhalt passt nicht zum Siegel" }]);
  });
});
