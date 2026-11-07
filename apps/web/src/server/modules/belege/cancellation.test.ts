import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Storno gebuchter Belege (#237): Gegenbuchung im noch nicht gemeldeten Zeitraum der Belegbuchung, sonst am Tag des
 * Stornos; Voranmeldung und EÜR zählen sie an ihrem Datum, der Beleg bleibt gesperrt; Neu erfassen legt einen Entwurf
 * mit derselben Datei an.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const KONTEN = {
  SKR03: { aufwand: "4964", vorsteuer: "1576", verbindlichkeiten: "1600", privat: "1890", kasse: "1000" },
  SKR04: { aufwand: "6837", vorsteuer: "1406", verbindlichkeiten: "3300", privat: "2180", kasse: "1600" },
} as const;

describe.skipIf(!testDatabaseUrl)("Beleg stornieren (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let bank: typeof import("../bank/bank.ts");
  let cash: typeof import("../bank/cash.ts");
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
    bank = await import("../bank/bank.ts");
    cash = await import("../bank/cash.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate document_cancellations, vat_returns, annual_submissions, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      asset_depreciations, assets, journal_lines, journal_entries, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${versteuerung}, ${kontenrahmen})`;
  }

  /** Bucht einen Beleg; wie im Anlass mit dem Bruttobetrag im Feld „Netto“ */
  async function bookedDocument(options: {
    date?: string;
    payment?: "bank" | "privat" | "kasse";
    net?: number;
    tax?: number;
    privateShare?: number;
    reverseCharge?: "eu" | "drittland" | null;
    category?: "software" | "anlage";
  }) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 37]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "JetBrains s.r.o.",
      supplierUstId: "",
      invoiceNumber: `R-${fileSeq}`,
      documentDate: options.date ?? "2026-09-15",
      dueDate: null,
      category: options.category ?? "software",
      payment: options.payment ?? "bank",
      note: "",
      privateShare: options.privateShare ?? 0,
      reverseCharge: options.reverseCharge ?? null,
      asset: options.category === "anlage" ? { name: "Notebook", kind: "edv", method: "digital", usefulLifeMonths: null } : null,
      amounts: [{ taxRate: 1900, net: options.net ?? 11_900, tax: options.tax ?? 2_261 }],
    });
    await documents.bookDocument(actor, id);
    return { id, bytes };
  }

  it("vatPeriodsOf nennt Monat und Quartal (41–44) des Buchungsdatums", () => {
    expect(cancellation.vatPeriodsOf("2026-03-11")).toEqual({ year: 2026, months: [3, 41] });
    expect(cancellation.vatPeriodsOf("2026-04-01")).toEqual({ year: 2026, months: [4, 42] });
    expect(cancellation.vatPeriodsOf("2026-11-03")).toEqual({ year: 2026, months: [11, 44] });
  });

  /** Eine gesendete Voranmeldung für Monat (1–12) oder Quartal (41–44): Der Zeitraum ist gemeldet */
  async function sentReturn(year: number, month: number) {
    await sql`insert into vat_returns (year, month, status, source, sent_at, locked_at) values (${year}, ${month}, 'sent', 'manuell', now(), now())`;
  }

  /** Saldo je Konto über alle Buchungen eines Belegs: nach dem Storno überall null */
  async function balances(documentId: string) {
    const rows = await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'document' and e.source_id = ${documentId} group by l.account order by l.account`;
    return Object.fromEntries(rows.map((r) => [r.account as string, r.saldo as number]));
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`${kontenrahmen}, ${versteuerung}: September schon gemeldet: bucht zurück am Tag des Stornos, Voranmeldung im laufenden Monat, Beleg bleibt gesperrt`, async () => {
        await reset(kontenrahmen, versteuerung);
        const konten = KONTEN[kontenrahmen];
        const { id } = await bookedDocument({});
        const before = await vat.computeVatFigures({ year: 2026, month: 9 });
        expect(before.kz66).toBe(2_261);
        await sentReturn(2026, 9);
        expect(await cancellation.plannedCancellationDate(id, "2026-10-05")).toBe("2026-10-05");

        const row = await cancellation.cancelDocument(actor, id, { reason: "Brutto als Netto erfasst" }, "2026-10-05");
        expect(row).toMatchObject({ documentId: id, date: "2026-10-05", reason: "Brutto als Netto erfasst" });

        // Gegenbuchung mit vertauschten Seiten, verweist auf die Belegbuchung
        const entries = await sql`select id, date, description, reverses_id from journal_entries where source_id = ${id} order by created_at`;
        expect(entries).toHaveLength(2);
        expect(entries[1]).toMatchObject({ date: "2026-10-05", reverses_id: entries[0]!.id, description: expect.stringMatching(/^Storno: Beleg R-/) });
        expect(row.journalEntryId).toBe(entries[1]!.id);
        const lines = await sql`select account, debit, credit from journal_lines where entry_id = ${entries[1]!.id} order by account`;
        expect(lines).toEqual(
          [
            { account: konten.aufwand, debit: 0, credit: 11_900 },
            { account: konten.vorsteuer, debit: 0, credit: 2_261 },
            { account: konten.verbindlichkeiten, debit: 14_161, credit: 0 },
          ].sort((a, b) => a.account.localeCompare(b.account)),
        );
        expect(Object.values(await balances(id)).every((s) => s === 0)).toBe(true);

        // September bleibt, wie er abgegeben ist; im Oktober mindert der Storno die Vorsteuer
        expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(2_261);
        const oct = await vat.computeVatFigures({ year: 2026, month: 10 });
        expect(oct.kz66).toBe(-2_261);
        expect(oct.inputTax).toEqual([
          expect.objectContaining({ documentId: id, date: "2026-10-05", number: `Storno R-${fileSeq}`, tax: -2_261, base: -11_900 }),
        ]);
        for (const month of [9, 10]) {
          const { zeilen } = await abgleich.vatAbgleich({ year: 2026, month });
          expect(zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
        }

        // Nichts mehr zu zahlen: weder offener Posten noch Zuordnung
        expect((await reports.openPositions("2026-10-05")).payables).toEqual([]);
        expect((await bank.openItems()).filter((i) => i.id === id)).toEqual([]);

        // Der Beleg selbst ist unverändert gebucht und gesperrt; der Storno ist versiegelt und nur anhängbar
        const [doc] = await sql`select status, locked_at from documents where id = ${id}`;
        expect(doc!.status).toBe("gebucht");
        expect(doc!.locked_at).not.toBeNull();
        expect(await sql`select count(*)::int as n from seals where table_name = 'document_cancellations' and row_id = ${row.id}`).toEqual([{ n: 1 }]);
        await expect(sql`update document_cancellations set reason = 'x' where id = ${row.id}`).rejects.toThrow();
        await expect(sql`delete from document_cancellations where id = ${row.id}`).rejects.toThrow();
        await expect(cancellation.cancelDocument(actor, id, {}, "2026-10-06")).rejects.toThrow(/bereits storniert/);
        expect((await documents.listDocuments()).find((d) => d.id === id)?.cancelledOn).toBe("2026-10-05");
      });

      it(`${kontenrahmen}, ${versteuerung}: Zeitraum noch nicht gemeldet: Storno im Zeitraum der Belegbuchung (Belegdatum vertauscht)`, async () => {
        await reset(kontenrahmen, versteuerung);
        // Wie im Anlass: 11.03. statt 03.11. erfasst, vierteljährliche Voranmeldung, Q1 noch nicht abgegeben
        const { id } = await bookedDocument({ date: "2026-03-11", net: 5_990, tax: 1_138 });
        expect((await vat.computeVatFigures({ year: 2026, month: 41 })).kz66).toBe(1_138);
        expect(await cancellation.plannedCancellationDate(id, "2026-11-06")).toBe("2026-03-11");

        const row = await cancellation.cancelDocument(actor, id, { reason: "Belegdatum vertauscht" }, "2026-11-06");
        expect(row.date).toBe("2026-03-11");
        const entries = await sql`select date, reverses_id from journal_entries where source_id = ${id} order by created_at`;
        expect(entries.map((e) => e.date)).toEqual(["2026-03-11", "2026-03-11"]);
        expect(Object.values(await balances(id)).every((s) => s === 0)).toBe(true);

        // Q1 ist ohne den Beleg, wie er abzugeben ist; der laufende Zeitraum bleibt unberührt
        for (const month of [3, 41, 11, 44]) {
          expect((await vat.computeVatFigures({ year: 2026, month })).kz66).toBe(0);
        }
        for (const month of [3, 41]) {
          const { zeilen } = await abgleich.vatAbgleich({ year: 2026, month });
          expect(zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
        }
        expect((await documents.listDocuments()).find((d) => d.id === id)?.cancelledOn).toBe("2026-03-11");
      });
    }

    it(`${kontenrahmen}: Quartal schon gemeldet: Storno am Tag des Stornos, auch bei monatlichem Belegmonat`, async () => {
      await reset(kontenrahmen, "ist");
      const { id } = await bookedDocument({ date: "2026-02-10", net: 10_000, tax: 1_900 });
      await sentReturn(2026, 41);
      const row = await cancellation.cancelDocument(actor, id, {}, "2026-11-06");
      expect(row.date).toBe("2026-11-06");
      expect((await vat.computeVatFigures({ year: 2026, month: 41 })).kz66).toBe(1_900);
      expect((await vat.computeVatFigures({ year: 2026, month: 44 })).kz66).toBe(-1_900);
    });

    it(`${kontenrahmen}: nur ein anderer Zeitraum gemeldet: Storno trotzdem im Zeitraum der Belegbuchung`, async () => {
      await reset(kontenrahmen, "soll");
      const { id } = await bookedDocument({ date: "2026-05-20", net: 10_000, tax: 1_900 });
      await sentReturn(2026, 41);
      await sentReturn(2026, 6);
      const row = await cancellation.cancelDocument(actor, id, {}, "2026-11-06");
      expect(row.date).toBe("2026-05-20");
      expect((await vat.computeVatFigures({ year: 2026, month: 42 })).kz66).toBe(0);
    });

    it(`${kontenrahmen}: Jahreserklärung gesendet: Storno am Tag des Stornos, auch ohne gesendete Voranmeldung`, async () => {
      await reset(kontenrahmen, "ist");
      const { id } = await bookedDocument({ date: "2025-11-20", payment: "privat", net: 10_000, tax: 1_900 });
      await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
        values ('ust', 2025, 'send', true, 0, 'ok', '{}', '', '', '')`;
      const row = await cancellation.cancelDocument(actor, id, {}, "2026-02-01");
      expect(row.date).toBe("2026-02-01");
    });

    it(`${kontenrahmen}: nur geprüft, nicht gesendet: Jahreserklärung zählt nicht als gemeldet`, async () => {
      await reset(kontenrahmen, "ist");
      const { id } = await bookedDocument({ date: "2025-11-20", payment: "privat", net: 10_000, tax: 1_900 });
      await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
        values ('ust', 2025, 'validate', true, 0, 'ok', '{}', '', '', '')`;
      const row = await cancellation.cancelDocument(actor, id, {}, "2026-02-01");
      expect(row.date).toBe("2025-11-20");
    });

    // Review #371: Bei einer GmbH meldet die E-Bilanz (mit KSt und GewSt) das Jahr, nicht die Anlage EÜR. Ohne gesendete
    // Voranmeldung (befreit, Kleinunternehmer) minderte ein zurückdatierter Storno sonst ein Jahr, dessen Bilanz schon beim
    // Finanzamt liegt.
    it(`${kontenrahmen}: GmbH, E-Bilanz gesendet: Storno am Tag des Stornos, auch ohne gesendete Voranmeldung`, async () => {
      await reset(kontenrahmen, "soll");
      await sql`update company set rechtsform = 'gmbh'`;
      const { id } = await bookedDocument({ date: "2025-11-20", net: 10_000, tax: 1_900 });
      await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
        values ('ebilanz', 2025, 'send', true, 0, 'ok', '{}', '', '', '')`;
      expect(await cancellation.plannedCancellationDate(id, "2026-08-01")).toBe("2026-08-01");
      const row = await cancellation.cancelDocument(actor, id, {}, "2026-08-01");
      expect(row.date).toBe("2026-08-01");
    });

    it(`${kontenrahmen}: privat bezahlt, Q4 gemeldet, Storno im Folgejahr: EÜR 2026 mit Ausgabe, 2027 mit derselben Ausgabe zurück`, async () => {
      await reset(kontenrahmen, "ist");
      const { id } = await bookedDocument({ date: "2026-12-20", payment: "privat", net: 10_000, tax: 1_900 });
      await sentReturn(2026, 44);
      await cancellation.cancelDocument(actor, id, {}, "2027-01-10");
      const ausgabe = async (year: number) => (await reports.euerForYear(year)).ausgaben.find((l) => l.key === "ausgabe:software")?.amount ?? 0;
      const vorsteuer = async (year: number) => (await reports.euerForYear(year)).ausgaben.find((l) => l.key === "vorsteuer")?.amount ?? 0;
      expect(await ausgabe(2026)).toBe(10_000);
      expect(await vorsteuer(2026)).toBe(1_900);
      expect(await ausgabe(2027)).toBe(-10_000);
      expect(await vorsteuer(2027)).toBe(-1_900);
      for (const year of [2026, 2027]) {
        const { zeilen } = await abgleich.euerAbgleich(year);
        expect(zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
      }
      const entries = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.source_id = ${id} and e.reverses_id is not null and l.account = ${KONTEN[kontenrahmen].privat}`;
      expect(entries).toEqual([{ account: KONTEN[kontenrahmen].privat, debit: 11_900, credit: 0 }]);
    });

    it(`${kontenrahmen}: bar aus der Kasse: Gegenzeile im Kassenbuch am Tag des Stornos, auch im noch offenen Zeitraum`, async () => {
      await reset(kontenrahmen, "soll");
      await cash.createCashEntry(actor, { kind: "einlage", date: "2026-09-01", amount: 50_000 }, "2026-09-01");
      const { id } = await bookedDocument({ payment: "kasse", net: 2_000, tax: 380 });
      await cancellation.cancelDocument(actor, id, {}, "2026-10-05");
      const book = await cash.cashBook(2026);
      expect(book.current).toBe(50_000);
      const original = book.entries.find((e) => e.documentId === id)!;
      expect(original).toMatchObject({ amount: -2_380, reversed: true });
      expect(book.entries.at(-1)).toMatchObject({ date: "2026-10-05", amount: 2_380, kind: "beleg", reversesId: original.id });
      expect((await balances(id))[KONTEN[kontenrahmen].kasse]).toBe(0);
    });
  }

  it("bar erstattete Gutschrift: Storno lehnt ab, wenn der Kassenbestand dadurch negativ würde", async () => {
    await reset("SKR03", "soll");
    // Gutschrift bar erstattet: 23,80 € kommen in die Kasse und werden am selben Tag entnommen
    const { id } = await bookedDocument({ payment: "kasse", net: -2_000, tax: -380 });
    await cash.createCashEntry(actor, { kind: "entnahme", date: "2026-09-15", amount: 2_380 }, "2026-09-15");
    expect((await cash.cashBook(2026)).current).toBe(0);
    await expect(cancellation.cancelDocument(actor, id, {}, "2026-10-05")).rejects.toThrow(/negativ/);
    expect((await cash.cashBook(2026)).current).toBe(0);
  });

  it("§ 13b, September gemeldet: Storno mindert Kz 46/47 und Kz 67 im Monat des Stornos", async () => {
    await reset("SKR03", "soll");
    const { id } = await bookedDocument({ reverseCharge: "eu", net: 10_000, tax: 1_900 });
    await sentReturn(2026, 9);
    await cancellation.cancelDocument(actor, id, {}, "2026-10-05");
    expect(await vat.computeVatFigures({ year: 2026, month: 9 })).toMatchObject({ kz46: 10_000, kz47: 1_900, kz67: 1_900 });
    expect(await vat.computeVatFigures({ year: 2026, month: 10 })).toMatchObject({ kz46: -10_000, kz47: -1_900, kz67: -1_900, kz66: 0 });
    const { zeilen } = await abgleich.vatAbgleich({ year: 2026, month: 10 });
    expect(zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
  });

  it("Privatanteil: der Storno nimmt genau die gebuchte Vorsteuer zurück", async () => {
    await reset("SKR04", "ist");
    const { id } = await bookedDocument({ net: 3_333, tax: 633, privateShare: 30 });
    const sep = await vat.computeVatFigures({ year: 2026, month: 9 });
    await sentReturn(2026, 9);
    await cancellation.cancelDocument(actor, id, {}, "2026-10-05");
    expect((await vat.computeVatFigures({ year: 2026, month: 10 })).kz66).toBe(-sep.kz66);
    expect(Object.values(await balances(id)).every((s) => s === 0)).toBe(true);
  });

  it("schon bezahlt: erst die Zuordnung aufheben; danach lässt sich der Beleg nicht mehr zuordnen", async () => {
    await reset("SKR03", "ist");
    const { id } = await bookedDocument({});
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([["20.09.26", "20.09.26", "Gebucht", "Testfirma", "JetBrains", "R", "Ausgang", "DE02100100100006820101", "-141,61", "", "", ""]]),
        filename: "a.csv",
      },
      null,
    );
    const [transaction] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "document", transactionId: transaction!.id, documentId: id, amount: -14_161 });
    await expect(cancellation.cancelDocument(actor, id, {}, "2026-10-05")).rejects.toThrow(/Zuordnung auf/);
    const [allocation] = await sql`select id from allocations where document_id = ${id}`;
    await bank.reverseAllocation(actor, allocation!.id);
    await cancellation.cancelDocument(actor, id, {}, "2026-10-05");
    await expect(bank.allocate(actor, { kind: "document", transactionId: transaction!.id, documentId: id, amount: -14_161 })).rejects.toThrow(/storniert/);
    // Zahlung, Gegenzeile und beide Belegbuchungen ergeben in der EÜR nichts
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "ausgabe:software")?.amount ?? 0).toBe(0);
  });

  it("lehnt ab: ungebucht, Anlagegut, abgeschlossenes Jahr", async () => {
    await reset("SKR03", "soll");
    fileSeq++;
    const draft = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, fileSeq % 256]), filename: "e.jpg" });
    await expect(cancellation.cancelDocument(actor, draft.id, {}, "2026-10-05")).rejects.toThrow(/noch nicht gebucht/);
    const asset = await bookedDocument({ category: "anlage", net: 50_000, tax: 9_500 });
    await expect(cancellation.cancelDocument(actor, asset.id, {}, "2026-10-05")).rejects.toThrow(/Anlagegütern/);
    // Auch an der App vorbei nimmt die Datenbank keinen Storno eines ungebuchten Belegs
    const [entry] = await sql`select id from journal_entries limit 1`;
    await expect(
      sql`insert into document_cancellations (document_id, date, journal_entry_id) values (${draft.id}, '2026-10-05', ${entry!.id})`,
    ).rejects.toThrow(/nicht gebucht/);

    const { id } = await bookedDocument({});
    await sql`insert into year_closings (year) values (2026)`;
    await expect(cancellation.cancelDocument(actor, id, {}, "2026-10-05")).rejects.toThrow(/2026 ist abgeschlossen/);
    expect(await sql`select count(*)::int as n from document_cancellations`).toEqual([{ n: 0 }]);
  });

  it("Neu erfassen: Entwurf mit derselben Datei und denselben Feldern, einmal je Storno; derselbe Upload landet dort", async () => {
    await reset("SKR03", "soll");
    const { id, bytes } = await bookedDocument({});
    await expect(cancellation.reenterDocument(actor, id)).rejects.toThrow(/stornierten Beleg/);
    await cancellation.cancelDocument(actor, id, {}, "2026-10-05");

    const reentry = await cancellation.reenterDocument(actor, id);
    expect(await cancellation.reenterDocument(actor, id)).toBe(reentry);
    const [original, copy] = [(await documents.getDocument(id))!, (await documents.getDocument(reentry))!];
    expect(copy.document).toMatchObject({
      status: "neu",
      lockedAt: null,
      sha256: original.document.sha256,
      supplierName: original.document.supplierName,
      invoiceNumber: original.document.invoiceNumber,
      documentDate: "2026-09-15",
      category: "software",
      replacesDocumentId: id,
    });
    expect(copy.amounts.map(({ taxRate, net, tax }) => ({ taxRate, net, tax }))).toEqual([{ taxRate: 1900, net: 11_900, tax: 2_261 }]);
    expect(await cancellation.documentCancellation(id)).toMatchObject({ reentryId: reentry });
    expect(await documents.uploadDocument(actor, { bytes, filename: "nochmal.jpg" })).toEqual({ id: reentry, duplicate: true });

    // Richtig erfasst und gebucht: September noch nicht gemeldet, also stehen Beleg, Storno und Neuerfassung dort
    await documents.updateDocument(actor, reentry, {
      supplierName: copy.document.supplierName,
      supplierUstId: "",
      invoiceNumber: copy.document.invoiceNumber,
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument(actor, reentry);
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(1_900);
    expect((await vat.computeVatFigures({ year: 2026, month: 10 })).kz66).toBe(0);
    expect((await reports.openPositions("2026-10-05")).payables.map((p) => [p.id, p.open])).toEqual([[reentry, 11_900]]);

    // Ein gelöschter Entwurf gibt die Neuerfassung wieder frei, die Datei bleibt beim stornierten Beleg
    const other = await bookedDocument({});
    await cancellation.cancelDocument(actor, other.id, {}, "2026-10-05");
    const draft = await cancellation.reenterDocument(actor, other.id);
    await documents.deleteDocument(actor, draft);
    expect(await cancellation.reenterDocument(actor, other.id)).not.toBe(draft);
  });
});
