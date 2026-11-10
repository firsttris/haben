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
/*
 * Gewinn nach der DATEV-Formel im Abgleich (#542, Schritt 5c; Fälle aus dem TDD-Review von Pull Request #567): Erfolgs-
 * und Steuerkonten, Forderungen und Verbindlichkeiten, korrigiert um den offenen Anteil von Privatanteil und Anlage. Die
 * Zeilen „EÜR: …“ gibt es nur im Einzelunternehmen; eine GmbH bilanziert. Eigene Datei mit eigener Datenbank.
 */
describe.skipIf(!testDatabaseUrl)("Gewinn nach der DATEV-Formel im Abgleich (Postgres)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
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
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(
    versteuerung: "ist" | "soll",
    kontenrahmen: "SKR03" | "SKR04" = "SKR03",
    kleinunternehmer = false,
    rechtsform: "einzelunternehmen" | "gmbh" = "einzelunternehmen",
  ) {
    await leeren(sql)`truncate asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports, bank_accounts,
      cash_entries, write_offs, year_closings, loans, journal_lines, journal_entries, document_splits, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, kleinunternehmer, rechtsform)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer}, ${rechtsform})`;
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
      category?: "edv" | "telefon" | "sonstiges" | "hardware" | "anlage";
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

  const pruefe = async (...years: number[]) => {
    for (const year of years) {
      const euer = await abgleich.euerAbgleich(year);
      expect(euer.hinweise, String(year)).toEqual([]);
      expect(abgleich.abweichungen(euer.zeilen), String(year)).toEqual([]);
    }
  };
  const formel = async (year: number) => (await abgleich.euerAbgleich(year)).zeilen.find((z) => z.posten === "EÜR: Gewinn nach der DATEV-Formel");

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`GmbH: Körperschaftsteuer-Vorauszahlung (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, false, "gmbh");
      const a = await invoice("2026-02-01", [{ net: 100_000, rate: 1900 }]);
      const txs = await transactions([eingang("10.02.26", `RE ${a.number}`, "1.190,00"), ausgang("10.03.26", "Finanzamt", "-543,00")]);
      await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount > 0)!.id, invoiceId: a.id, amount: 119_000 });
      await bank.allocate(actor, {
        kind: "steuer",
        transactionId: txs.find((t) => t.amount < 0)!.id,
        amount: -54_300,
        steuer: { art: "kst", jahr: 2026, posten: "steuer" },
      });
      await pruefe(2026);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Bareinnahme ohne Rechnung und Homeoffice-Pauschale (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen);
      await (await import("../bank/cash-income.ts")).createCashIncome(
        actor,
        { date: "2026-03-01", amount: 11_900, text: "Verkauf", steuer: { behandlung: "regulaer", steuersatz: 1900 } } as never,
        "2026-12-31",
      );
      const pauschalen = await import("../buchhaltung/pauschalen.ts");
      await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-03", tage: 10 }, "2026-12-31");
      await pruefe(2026);
      expect((await formel(2026))!.journal).not.toBe(0);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`GmbH: manuelle Umbuchung auf ein Aufwandskonto (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, false, "gmbh");
      const manual = await import("../buchhaltung/manual.ts");
      const a = await invoice("2026-02-01", [{ net: 100_000, rate: 1900 }]);
      const [tx] = await transactions([eingang("10.02.26", `RE ${a.number}`, "1.190,00")]);
      await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: a.id, amount: 119_000 });
      // Sonstige betriebliche Aufwendungen an Gesellschafter-Verrechnungskonto (Auslage des Gesellschafters)
      const aufwand = kontenrahmen === "SKR03" ? "4900" : "6300";
      const gesellschafter = kontenrahmen === "SKR03" ? "0730" : "3510";
      await manual.createManualEntry(
        actor,
        {
          date: "2026-03-01",
          description: "Auslage Gesellschafter",
          lines: [
            { account: aufwand, debit: 10_000, credit: 0 },
            { account: gesellschafter, debit: 0, credit: 10_000 },
          ],
        },
        "2026-12-31",
      );
      await pruefe(2026);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Beleg mit Privatanteil im Voraus bezahlt (Zahlung Dezember, Belegdatum Januar) (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const doc = await bookedDocument("2027-01-05", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { privateShare: 30, category: "telefon" });
        const [tx] = await transactions([ausgang("20.12.26", "Lieferant", "-119,00")]);
        await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc, amount: -11_900 });
        await pruefe(2026, 2027);
      }, 60_000);
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Einzelunternehmen: Steuerzahlungen (Gewerbesteuer, Säumniszuschlag, Einkommensteuer, Umsatzsteuer Vorjahr) (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen);
      const txs = await transactions([
        ausgang("10.02.26", "Finanzamt", "-500,00"),
        ausgang("11.02.26", "Finanzamt", "-12,00"),
        ausgang("12.02.26", "Finanzamt", "-800,00"),
        ausgang("13.02.26", "Finanzamt", "-300,00"),
        ausgang("14.02.26", "Finanzamt", "-7,00"),
      ]);
      const by = (amount: number) => txs.find((t) => t.amount === amount)!.id;
      await bank.allocate(actor, { kind: "steuer", transactionId: by(-50_000), amount: -50_000, steuer: { art: "gewst", jahr: 2026, posten: "steuer" } });
      await bank.allocate(actor, {
        kind: "steuer",
        transactionId: by(-1_200),
        amount: -1_200,
        steuer: { art: "gewst", jahr: 2025, posten: "saeumnis" } as never,
      });
      await bank.allocate(actor, { kind: "steuer", transactionId: by(-80_000), amount: -80_000, steuer: { art: "est", jahr: 2025, posten: "steuer" } });
      await bank.allocate(actor, { kind: "steuer", transactionId: by(-30_000), amount: -30_000, steuer: { art: "ust", jahr: 2025, posten: "steuer" } });
      await bank.allocate(actor, { kind: "steuer", transactionId: by(-700), amount: -700, steuer: { art: "ust", jahr: 2025, posten: "zinsen233a" } });
      await pruefe(2026);
      expect((await formel(2026))!.journal).toBe(-30_700);
    }, 60_000);

    it(`Einzelunternehmen: Darlehen mit Auszahlung, Tilgung und Zinsen (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      const darlehen = await import("../bank/darlehen.ts");
      const loanId = await darlehen.createLoan(actor, {
        name: "Hausbank",
        lender: "bank",
        term: "ohne",
        purpose: "betrieb",
        openingBalance: 0,
        openingDate: null,
      });
      const txs = await transactions([eingang("02.01.26", "Auszahlung", "20.000,00"), ausgang("01.02.26", "Hausbank", "-1.000,00")]);
      await bank.allocate(actor, {
        kind: "darlehen",
        transactionId: txs.find((t) => t.amount > 0)!.id,
        amount: 2_000_000,
        darlehen: { loanId, part: "auszahlung" },
      });
      await bank.allocateSplit(actor, {
        transactionId: txs.find((t) => t.amount < 0)!.id,
        parts: [
          { kind: "darlehen", amount: -80_000, darlehen: { loanId, part: "tilgung" } },
          { kind: "darlehen", amount: -20_000, darlehen: { loanId, part: "zins" } },
        ],
      });
      await pruefe(2026);
      expect((await formel(2026))!.journal).toBe(-20_000);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Anlage auf Ziel, Teilzahlung über den Jahreswechsel, AfA gebucht (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const assets = await import("../buchhaltung/assets.ts");
        docSeq++;
        const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq, 9, 9]), filename: `a${docSeq}.jpg` });
        await documents.updateDocument(actor, id, {
          supplierName: "Händler",
          supplierUstId: "",
          invoiceNumber: "A-1",
          documentDate: "2026-11-15",
          dueDate: null,
          category: "anlage",
          payment: "bank",
          note: "",
          privateShare: 0,
          reverseCharge: null,
          amounts: [{ taxRate: 1900, net: 300_001, tax: 57_000 }],
          asset: { name: "Server", kind: "edv", method: "linear", usefulLifeMonths: 36 },
        } as never);
        await documents.bookDocument(actor, id);
        const txs = await transactions([ausgang("20.12.26", "Händler", "-1.000,00"), ausgang("15.01.27", "Händler", "-2.570,01")]);
        for (const t of txs) await bank.allocate(actor, { kind: "document", transactionId: t.id, documentId: id, amount: t.amount });
        await assets.bookDepreciation(actor, 2026, "2026-12-31");
        await assets.bookDepreciation(actor, 2027, "2027-12-31");
        await pruefe(2026, 2027);
        expect(await formel(2026)).toBeDefined();
      }, 60_000);
    }

    it(`Kfz mit Privatnutzung (1 %), AfA und Entnahme gebucht (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      const assets = await import("../buchhaltung/assets.ts");
      await assets.createAsset(actor, {
        name: "VW Passat",
        kind: "kfz",
        method: "linear",
        acquisitionDate: "2024-01-10",
        cost: 3_600_000,
        usefulLifeMonths: 72,
        openingDate: "2026-01-01",
        openingBookValue: 2_400_000,
        disposalDate: null,
        note: "",
        privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true },
      });
      await assets.bookDepreciation(actor, 2026, "2026-12-31");
      await pruefe(2026);
      expect((await formel(2026))!.journal).not.toBe(0);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Beleg nach § 13b mit Privatanteil, im selben Jahr bezahlt (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const doc = await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], {
          privateShare: 30,
          category: "edv",
          reverseCharge: "eu",
        });
        const [tx] = await transactions([ausgang("05.03.26", "Lieferant", "-100,00")]);
        await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc, amount: -10_000 });
        await pruefe(2026);
      }, 60_000);
    }
  }

  for (const [vorher, nachher] of [
    ["SKR03", "SKR04"],
    ["SKR04", "SKR03"],
  ] as const) {
    it(`Beleg mit Privatanteil im Vorjahr in ${vorher}, Zahlung nach dem Wechsel zu ${nachher}`, async () => {
      await reset("soll", vorher);
      const doc = await bookedDocument("2025-12-10", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
      await sql`update company set kontenrahmen = ${nachher} where id = 1`;
      const [tx] = await transactions([ausgang("15.01.26", "Lieferant", "-59,51")]);
      await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc, amount: -5_951 });
      await pruefe(2025, 2026);
      expect((await formel(2025))!.journal).toBe(0);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Beleg mit Privatanteil, Storno im Folgejahr nach Abschluss des Jahres (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen);
      const doc = await bookedDocument("2026-12-10", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
      await sql`insert into year_closings (year) values (2026)`;
      const cancellation = await import("../belege/cancellation.ts");
      await cancellation.cancelDocument(actor, doc, { reason: "doppelt" }, "2027-01-20");
      const [d] = await sql`select e.date::text as date from journal_entries e where e.source_id = ${doc} and e.reverses_id is not null`;
      expect(d!.date).toBe("2027-01-20");
      await pruefe(2026, 2027);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const bezahlt of ["-110,00", "-125,00"]) {
      it(`Beleg in Fremdwährung mit Privatanteil, Kursdifferenz ${bezahlt} (${kontenrahmen})`, async () => {
        await reset("ist", kontenrahmen);
        docSeq++;
        const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq, 8, 8]), filename: `u${docSeq}.jpg` });
        await documents.updateDocument(actor, id, {
          supplierName: "Lieferant",
          supplierUstId: "",
          invoiceNumber: "U-1",
          documentDate: "2026-03-01",
          dueDate: null,
          category: "telefon",
          payment: "bank",
          note: "",
          privateShare: 30,
          reverseCharge: null,
          currency: "USD",
          exchangeRate: "1,25",
          amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 12_500, originalTax: 2_375 }],
        } as never);
        await documents.bookDocument(actor, id);
        const [tx] = await transactions([ausgang("05.03.26", "Lieferant", bezahlt)]);
        await bank.allocateWithRest(actor, { transactionId: tx!.id, target: { kind: "document", documentId: id }, rest: "kursdifferenz" });
        await pruefe(2026);
      }, 60_000);
    }
  }
});
