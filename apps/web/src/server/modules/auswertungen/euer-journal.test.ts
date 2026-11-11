import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const eingang = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];
const ausgang = (date: string, name: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Testfirma",
  name,
  "Zahlung",
  "Ausgang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

/*
 * EÜR aus dem Journal (#542, Schritt 5b) im Abgleich: Einnahmen und Ausgaben nach Zahlung, jede Zahlung anteilig auf die
 * Rechnung bzw. den Beleg verteilt, die sie ausgleicht (euer-journal.ts). Eigene Datei mit eigener Datenbank, damit die
 * Siegel der vielen Zuordnungen hier die Integritätsprüfung in abgleich.test.ts nicht über ihre Grenze je Tabelle treiben.
 */
describe.skipIf(!testDatabaseUrl)("EÜR aus dem Journal im Abgleich (Postgres)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let cash: typeof import("../bank/cash.ts");
  let cashInvoice: typeof import("../bank/cash-invoice.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    abgleich = await import("./abgleich.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    cash = await import("../bank/cash.ts");
    cashInvoice = await import("../bank/cash-invoice.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04" = "SKR03", kleinunternehmer = false) {
    await leeren(sql)`truncate asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports, bank_accounts,
      cash_entries, write_offs, journal_lines, journal_entries, document_splits, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer})`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "a@b.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  }

  async function invoice(issueDate: string, lines: { net: number; rate: 1900 | 700 }[]) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: lines.map((l) => ({ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: l.net, taxRate: l.rate })),
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function bookedDocument(
    date: string,
    amounts: { taxRate: 1900 | 700 | 0; net: number; tax: number }[],
    extra: {
      payment?: "bank" | "privat";
      privateShare?: number;
      reverseCharge?: "eu" | "drittland" | null;
      category?: "edv" | "telefon" | "sonstiges" | "hardware";
      splits?: { category: "software" | "buero"; taxRate: 1900 | 700 | 0; net: number }[];
    } = {},
  ) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 7]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: extra.category ?? "edv",
      payment: extra.payment ?? "bank",
      note: "",
      amounts,
      privateShare: extra.privateShare ?? 0,
      reverseCharge: extra.reverseCharge ?? null,
      ...(extra.splits ? { splits: extra.splits } : {}),
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function transactions(rows: string[][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows), filename: `${crypto.randomUUID()}.csv` }, null);
    return sql<
      { id: string; booking_date: string; amount: number }[]
    >`select id, booking_date::text, amount from bank_transactions order by booking_date, amount`;
  }

  // EÜR aus dem Journal (#542, Schritt 5b): Jede Zahlung zählt im Jahr der Zahlung mit ihrem Anteil an Rechnung bzw. Beleg
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`EÜR je Zeile aus dem Journal: Teilzahlungen über den Jahreswechsel (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        // 3 × 39,67 € auf 119 €: einzeln gerundet wären es 18,99 € Steuer, zusammen genau 19 € (settlementTaxShares)
        const a = await invoice("2026-12-10", [{ net: 10_000, rate: 1900 }]);
        await bookedDocument("2026-12-15", [
          { taxRate: 1900, net: 10_001, tax: 1_900 },
          { taxRate: 700, net: 3_333, tax: 233 },
        ]);
        const txs = await transactions([
          eingang("20.12.26", `RE ${a.number} Teil 1`, "39,67"),
          eingang("08.01.27", `RE ${a.number} Teil 2`, "39,67"),
          eingang("10.01.27", `RE ${a.number} Teil 3`, "39,66"),
          ausgang("05.01.27", "Lieferant", "-50,00"),
        ]);
        const by = (amount: number) => txs.find((t) => t.amount === amount)!.id;
        const [doc] = await sql`select id from documents`;
        const raten = txs.filter((t) => t.amount > 0);
        for (const t of raten) await bank.allocate(actor, { kind: "invoice", transactionId: t.id, invoiceId: a.id, amount: t.amount });
        await bank.allocate(actor, { kind: "document", transactionId: by(-5_000), documentId: doc!.id, amount: -5_000 });

        for (const year of [2026, 2027]) {
          const euer = await abgleich.euerAbgleich(year);
          expect(euer.hinweise, String(year)).toEqual([]);
          expect(abgleich.abweichungen(euer.zeilen), String(year)).toEqual([]);
        }
        // Verglichen wurde wirklich: Einnahmen in beiden Jahren nach Zahlung, die Ausgabe erst 2027
        const zeile = async (year: number, posten: string) => (await abgleich.euerAbgleich(year)).zeilen.find((z) => z.posten === posten);
        expect((await zeile(2026, "EÜR: Umsatzsteuerpflichtige Betriebseinnahmen (netto)"))!.journal).toBeGreaterThan(0);
        expect((await zeile(2027, "EÜR: Umsatzsteuerpflichtige Betriebseinnahmen (netto)"))!.journal).toBeGreaterThan(0);
        expect(await zeile(2026, "EÜR: Gezahlte Vorsteuerbeträge")).toBeUndefined();
        expect((await zeile(2027, "EÜR: Gezahlte Vorsteuerbeträge"))!.journal).toBeGreaterThan(0);
      }, 60_000);
    }
  }

  // Review #562: Der Anteil einer Zahlung richtet sich nach dem gespeicherten Anteil (settlementTaxShares), nicht nach dem Datum
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`EÜR aus dem Journal: frühere Teilzahlung aufgehoben (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const a = await invoice("2026-01-10", [{ net: 10_000, rate: 1900 }]);
        const txs = await transactions([eingang("01.02.26", `RE ${a.number} Teil 1`, "39,67"), eingang("15.02.26", `RE ${a.number} Teil 2`, "39,67")]);
        for (const t of txs) await bank.allocate(actor, { kind: "invoice", transactionId: t.id, invoiceId: a.id, amount: t.amount });
        // Die erste Zahlung war für eine andere Rechnung gedacht und wird aufgehoben
        const [first] = await sql`select a.id from allocations a join bank_transactions t on t.id = a.transaction_id where t.booking_date = '2026-02-01'`;
        await bank.reverseAllocation(actor, first!.id);
        const euer = await abgleich.euerAbgleich(2026);
        expect(euer.hinweise).toEqual([]);
        expect(abgleich.abweichungen(euer.zeilen)).toEqual([]);
      }, 60_000);

      it(`EÜR aus dem Journal: Zahlungen in anderer Reihenfolge zugeordnet, als sie gebucht sind (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const a = await invoice("2026-12-01", [{ net: 10_000, rate: 1900 }]);
        const txs = await transactions([eingang("20.12.26", `RE ${a.number} Teil 1`, "39,67"), eingang("08.01.27", `RE ${a.number} Teil 2`, "39,67")]);
        // Erst die Januar-Zahlung zugeordnet, dann die vom Dezember
        for (const t of [...txs].reverse()) await bank.allocate(actor, { kind: "invoice", transactionId: t.id, invoiceId: a.id, amount: t.amount });
        for (const year of [2026, 2027]) {
          const euer = await abgleich.euerAbgleich(year);
          expect(euer.hinweise, String(year)).toEqual([]);
          expect(abgleich.abweichungen(euer.zeilen), String(year)).toEqual([]);
        }
      }, 60_000);

      it(`EÜR aus dem Journal: Rest nach Teilzahlung als Forderungsausfall ausgebucht (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        // Zahlung und Ausbuchung entstehen in einer Transaktion: gleiches Datum, gleiches created_at; mehrere Rechnungen,
        // damit eine Reihenfolge nach der zufälligen id mindestens einmal die Ausbuchung zuerst liefert
        const rechnungen = [];
        for (let i = 0; i < 6; i++) rechnungen.push(await invoice("2026-01-10", [{ net: 10_000, rate: 1900 }]));
        const txs = await transactions(
          rechnungen.flatMap((r, i) => [
            eingang(`0${i + 1}.02.26`, `RE ${r.number} Teil 1`, "39,67"),
            eingang(`${10 + i}.03.26`, `RE ${r.number} Rest`, "78,56"),
          ]),
        );
        for (const [i, r] of rechnungen.entries()) {
          const teil = txs.find((t) => t.booking_date === `2026-02-0${i + 1}`)!;
          const rest = txs.find((t) => t.booking_date === `2026-03-${10 + i}`)!;
          await bank.allocate(actor, { kind: "invoice", transactionId: teil.id, invoiceId: r.id, amount: teil.amount });
          // 77 Cent bleiben offen und werden als Forderungsausfall ausgebucht
          await bank.allocateWithRest(actor, { transactionId: rest.id, target: { kind: "invoice", invoiceId: r.id }, rest: "forderungsausfall" });
        }
        const euer = await abgleich.euerAbgleich(2026);
        expect(euer.hinweise).toEqual([]);
        expect(abgleich.abweichungen(euer.zeilen)).toEqual([]);
      }, 60_000);

      it(`EÜR aus dem Journal: Teilzahlung auf einen Beleg mit Privatanteil (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const doc = await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
        const [tx] = await transactions([ausgang("05.03.26", "Lieferant", "-29,75")]);
        await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc, amount: -2_975 });
        const euer = await abgleich.euerAbgleich(2026);
        expect(euer.hinweise).toEqual([]);
        expect(abgleich.abweichungen(euer.zeilen)).toEqual([]);
      }, 60_000);
    }
  }

  // Review #562: Ein Einzelunternehmen darf den Kontenrahmen zum Jahreswechsel wechseln, auch mit offenen Rechnungen
  // (settings-guard.ts sperrt dann nur die Versteuerung)
  for (const [vorher, nachher] of [
    ["SKR03", "SKR04"],
    ["SKR04", "SKR03"],
  ] as const) {
    it(`EÜR aus dem Journal: Rechnung im Vorjahr in ${vorher}, Zahlung nach dem Wechsel zu ${nachher}`, async () => {
      await reset("soll", vorher);
      const a = await invoice("2025-12-10", [{ net: 10_000, rate: 1900 }]);
      await sql`update company set kontenrahmen = ${nachher} where id = 1`;
      const [tx] = await transactions([eingang("15.01.26", `RE ${a.number}`, "119,00")]);
      await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: a.id, amount: 11_900 });
      const euer = await abgleich.euerAbgleich(2026);
      expect(euer.hinweise).toEqual([]);
      expect(abgleich.abweichungen(euer.zeilen)).toEqual([]);
    }, 60_000);
  }

  const pruefe = async (...years: number[]) => {
    for (const year of years) {
      const euer = await abgleich.euerAbgleich(year);
      expect(euer.hinweise, String(year)).toEqual([]);
      expect(abgleich.abweichungen(euer.zeilen), String(year)).toEqual([]);
    }
  };

  // Review #562, Runde 2: aufgeteilte Belege ohne Vorsteuerabzug fassen Netto und Steuer je Kategorie in einer Zeile zusammen
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`EÜR aus dem Journal: Teilzahlung auf einen aufgeteilten Beleg ohne Vorsteuerabzug (Kleinunternehmer, ${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, true);
      const doc = await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 4_333, tax: 823 }], {
        category: "sonstiges",
        splits: [
          { category: "software", taxRate: 1900, net: 1_000 },
          { category: "buero", taxRate: 1900, net: 3_333 },
        ],
      });
      const [tx] = await transactions([ausgang("05.03.26", "Lieferant", "-12,34")]);
      await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc, amount: -1_234 });
      await pruefe(2026);
    }, 60_000);

    it(`EÜR aus dem Journal: Teilzahlung auf einen aufgeteilten Beleg nach § 13b ohne Vorsteuerabzug (Kleinunternehmer, ${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, true);
      const doc = await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 4_333, tax: 823 }], {
        category: "sonstiges",
        reverseCharge: "eu",
        splits: [
          { category: "software", taxRate: 1900, net: 1_000 },
          { category: "buero", taxRate: 1900, net: 3_333 },
        ],
      });
      const [tx] = await transactions([ausgang("05.03.26", "Lieferant", "-6,19")]);
      await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc, amount: -619 });
      await pruefe(2026);
    }, 60_000);
  }

  // Review #562, Runde 2: Die Gegenbuchung übernimmt die Zeilen der aufgehobenen Buchung, auch nach einem Wechsel des Kontenrahmens
  for (const [vorher, nachher] of [
    ["SKR03", "SKR04"],
    ["SKR04", "SKR03"],
  ] as const) {
    // Eine Gegenbuchung dreht die Zeilen der aufgehobenen Buchung um. Nach einem Wechsel des Kontenrahmens bucht sie mit den
    // Konten derselben Rolle im neuen Rahmen (kontoImKontenrahmen); die alten Kontonummern bedeuteten dort etwas anderes
    const gegenbuchung = async () =>
      sql`select e.kontenrahmen, l.account from journal_entries e join journal_lines l on l.entry_id = e.id where e.reverses_id is not null`;
    const konten = (kr: "SKR03" | "SKR04") => new Set<string>(Object.values(ACCOUNTS[kr]).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v))));

    it(`Bareinnahme im Vorjahr in ${vorher}: Storno nach dem Wechsel zu ${nachher} bucht im neuen Kontenrahmen`, async () => {
      await reset("soll", vorher);
      const a = await invoice("2025-12-01", [{ net: 10_000, rate: 1900 }]);
      const bar = await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: a.id, date: "2025-12-20", amount: 11_900 }, "2025-12-20");
      await sql`update company set kontenrahmen = ${nachher} where id = 1`;
      await cash.reverseCashEntry(actor, bar.id, "2026-01-15");
      const zeilen = await gegenbuchung();
      expect(zeilen.map((z) => z.kontenrahmen)).toEqual(zeilen.map(() => nachher));
      expect(zeilen.map((z) => z.account).sort()).toEqual([ACCOUNTS[nachher].forderungen, ACCOUNTS[nachher].kasse].sort());
      expect(zeilen.every((z) => konten(nachher).has(z.account))).toBe(true);
      await pruefe(2025, 2026);
    }, 60_000);

    it(`Ausbuchung im Vorjahr in ${vorher}: Aufheben nach dem Wechsel zu ${nachher} bucht im neuen Kontenrahmen, Zahlung danach zuordenbar`, async () => {
      await reset("soll", vorher);
      const a = await invoice("2025-11-01", [{ net: 10_000, rate: 1900 }]);
      await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: a.id, date: "2025-12-15" });
      const [row] = await sql`select id from write_offs`;
      await sql`update company set kontenrahmen = ${nachher} where id = 1`;
      // Zahlt der Kunde doch (§ 17 Abs. 2 Nr. 1 Satz 2 UStG): Ausbuchung aufheben und die Zahlung zuordnen
      const [tx] = await transactions([eingang("02.03.26", `RE ${a.number}`, "119,00")]);
      await bank.reverseWriteOff(actor, row!.id, "2026-03-02");
      await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: a.id, amount: 11_900 });
      const zeilen = await gegenbuchung();
      expect(zeilen.map((z) => z.kontenrahmen)).toEqual(zeilen.map(() => nachher));
      expect(zeilen.map((z) => z.account)).toContain(ACCOUNTS[nachher].forderungen);
      expect(zeilen.map((z) => z.account)).toContain(ACCOUNTS[nachher].forderungsverluste);
      await pruefe(2025, 2026);
    }, 60_000);

    // Vor #570 übernahm die Gegenbuchung die alten Kontonummern unverändert; die EÜR aus dem Journal liest sie weiter richtig
    it(`Gegenbuchung von vor #570 mit den Konten aus ${vorher} unter ${nachher}: EÜR aus dem Journal ohne Abweichung`, async () => {
      await reset("soll", vorher);
      const a = await invoice("2025-12-01", [{ net: 10_000, rate: 1900 }]);
      const bar = await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: a.id, date: "2025-12-20", amount: 11_900 }, "2025-12-20");
      await sql`update company set kontenrahmen = ${nachher} where id = 1`;
      // Wie das Storno bis #570 buchte: Kassenzeile und Gegenbuchung mit den Zeilen der Bareinnahme, nur die Seiten getauscht
      const { withActor } = await import("../../db/actor.ts");
      const { openBooks, post } = await import("../buchhaltung/index.ts");
      const [original] = await sql`select journal_entry_id as id, number from cash_entries where id = ${bar.id}`;
      const zeilen = await sql`select account, debit, credit, tax_code from journal_lines where entry_id = ${original!.id}`;
      await withActor(actor, async (tx) => {
        const id = crypto.randomUUID();
        const entryId = await post(tx, await openBooks(tx), {
          date: "2026-01-15",
          description: "Storno",
          sourceType: "kasse",
          sourceId: id,
          reversesId: original!.id,
          lines: zeilen.map((z) => ({ account: z.account, debit: z.credit, credit: z.debit, taxCode: z.tax_code })),
        });
        const { schema } = await import("../../db/index.ts");
        await tx.insert(schema.cashEntries).values({
          id,
          number: original!.number + 1,
          date: "2026-01-15",
          amount: -11_900,
          kind: "rechnung",
          text: "Storno",
          invoiceId: a.id,
          reversesId: bar.id,
          journalEntryId: entryId,
        });
      });
      await pruefe(2025, 2026);
    }, 60_000);

    // Review #570: Einlage, Entnahme, Abhebung und Einzahlung rechnet das Storno ohnehin im neuen Kontenrahmen
    it(`Einlage im Vorjahr in ${vorher}: Storno nach dem Wechsel zu ${nachher} bucht im neuen Kontenrahmen`, async () => {
      await reset("ist", vorher);
      const einlage = await cash.createCashEntry(actor, { kind: "einlage", date: "2025-12-01", amount: 50_000 }, "2025-12-01");
      await sql`update company set kontenrahmen = ${nachher} where id = 1`;
      await cash.reverseCashEntry(actor, einlage.id, "2026-01-15");
      const zeilen = await gegenbuchung();
      expect(zeilen.map((z) => z.kontenrahmen)).toEqual([nachher, nachher]);
      expect(zeilen.map((z) => z.account)).toContain(ACCOUNTS[nachher].kasse);
      await pruefe(2025, 2026);
    }, 60_000);
  }

  // Gewinn nach der DATEV-Formel (#542, Schritt 5c): Erfolgs- und Steuerkonten, Forderungen und Verbindlichkeiten
  const formel = async (year: number) => (await abgleich.euerAbgleich(year)).zeilen.find((z) => z.posten === "EÜR: Gewinn nach der DATEV-Formel");
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Gewinn nach der DATEV-Formel: Beleg mit Privatanteil, offen über den Jahreswechsel (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        // Der private Teil steckt in den Verbindlichkeiten, ist aber keine Ausgabe; erst bezahlt wirkt der betriebliche Teil
        const doc = await bookedDocument("2026-12-10", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
        const a = await invoice("2026-12-01", [{ net: 10_000, rate: 1900 }]);
        const txs = await transactions([
          eingang("15.12.26", `RE ${a.number}`, "119,00"),
          ausgang("05.01.27", "Lieferant", "-20,00"),
          ausgang("20.01.27", "Lieferant", "-39,51"),
        ]);
        await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount === 11_900)!.id, invoiceId: a.id, amount: 11_900 });
        for (const t of txs.filter((t) => t.amount < 0))
          await bank.allocate(actor, { kind: "document", transactionId: t.id, documentId: doc, amount: t.amount });
        await pruefe(2026, 2027);
        expect(await formel(2026)).toMatchObject({ journal: 11_900, quelle: 11_900 });
        expect((await formel(2027))!.journal).toBeLessThan(0);
      }, 60_000);
    }

    it(`Gewinn nach der DATEV-Formel: Hardware (GWG) als Ausgabe, nicht als Anlage (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen);
      const doc = await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 50_000, tax: 9_500 }], { category: "hardware" });
      const [tx] = await transactions([ausgang("05.03.26", "Lieferant", "-595,00")]);
      await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc, amount: -59_500 });
      await pruefe(2026);
      expect(await formel(2026)).toMatchObject({ journal: -59_500, quelle: -59_500 });
    }, 60_000);
  }
});
