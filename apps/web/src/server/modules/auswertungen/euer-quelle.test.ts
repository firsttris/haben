import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

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
 * EÜR aus dem Journal (#542, #1116, docs/adr/journal-als-quelle.md): euerForYear rechnet aus dem Journal (euer-quelle.ts).
 * Die festen Werte sind die, die bis #1116 die Nebenbücher als Gegenprobe lieferten.
 */
describe.skipIf(!testDatabaseUrl)("EÜR aus dem Journal (Postgres)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let reports: typeof import("./reports.ts");
  let pauschalen: typeof import("../buchhaltung/pauschalen.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    abgleich = await import("./abgleich.ts");
    reports = await import("./reports.ts");
    pauschalen = await import("../buchhaltung/pauschalen.ts");
    assets = await import("../buchhaltung/assets.ts");
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
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
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
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
  /** Ein Jahr mit Teilzahlungen über den Jahreswechsel, Beleg mit Privatanteil, Bewirtung und Pauschale */
  async function geschaeftsjahr() {
    const a = await invoice("2026-11-10", [
      { net: 33_333, rate: 1900 },
      { net: 12_345, rate: 700 },
    ]);
    const doc = await bookedDocument("2026-11-20", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
    await bookedDocument("2026-12-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { payment: "privat" });
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-12", tage: 9, description: "" }, "2026-12-31");
    const txs = await transactions([
      eingang("01.12.26", `RE ${a.number} Teil 1`, "100,01"),
      eingang("10.01.27", `RE ${a.number} Rest`, `${((a.gross - 10_001) / 100).toFixed(2).replace(".", ",")}`),
      ausgang("05.12.26", "Lieferant", "-29,75"),
    ]);
    await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount === 10_001)!.id, invoiceId: a.id, amount: 10_001 });
    await bank.allocate(actor, {
      kind: "invoice",
      transactionId: txs.find((t) => t.booking_date === "2027-01-10")!.id,
      invoiceId: a.id,
      amount: a.gross - 10_001,
    });
    await bank.allocate(actor, { kind: "document", transactionId: txs.find((t) => t.amount === -2_975)!.id, documentId: doc, amount: -2_975 });
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Zeilen, Gewinn und Monate aus dem Journal, Teilzahlung über den Jahreswechsel (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await geschaeftsjahr();
        const nur = (einnahmen: number, ausgaben: number, monat: number) => ({
          einnahmen: Array.from({ length: 12 }, (_, i) => (i === monat ? einnahmen : 0)),
          ausgaben: Array.from({ length: 12 }, (_, i) => (i === monat ? ausgaben : 0)),
        });
        // Bis #1116 die Werte der Gegenprobe aus den Nebenbüchern, bei Ist und Soll gleich (EÜR nach Zahlung)
        const erwartet = {
          2026: {
            zeilen: {
              einnahmenSteuerpflichtig: 8_640,
              vereinnahmteUst: 1_361,
              "ausgabe:edv": 10_000,
              "ausgabe:telefon": 1_750,
              "pauschale:homeoffice": 5_400,
              vorsteuer: 2_232,
            },
            gewinn: -9_381,
            monthly: nur(8_640, 17_150, 11),
          },
          2027: { zeilen: { einnahmenSteuerpflichtig: 37_038, vereinnahmteUst: 5_836 }, gewinn: 42_874, monthly: nur(37_038, 0, 0) },
        };
        for (const year of [2026, 2027] as const) {
          const journal = await reports.euerForYear(year);
          const zeilen = Object.fromEntries([...journal.einnahmen, ...journal.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount]));
          expect({ zeilen, gewinn: journal.gewinn, monthly: journal.monthly }, String(year)).toEqual(erwartet[year]);
          expect(journal.bewirtungNichtAbziehbar).toBe(0);
        }
        expect((await reports.euerForYear(2026)).gewinn).not.toBe(0);
        await pruefe(2026, 2027);
      }, 60_000);
    }

    it(`es zählt, was im Journal steht; Verprobung und Beleg gegen Buchung zeigen die Änderung (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen);
      await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { payment: "privat" });
      // An Haben vorbei: der Aufwand im Journal um 1 € erhöht
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set debit = debit + 100 where debit = 10000`;
      });
      // Bisher 100 € Aufwand und 19 € Vorsteuer, jetzt 1 € Aufwand mehr
      expect((await reports.euerForYear(2026)).gewinn).toBe(-12_000);
      // Die Vorsteuer passt nicht mehr zur Bemessungsgrundlage: Bei einem Beleg ein Hinweis zum Prüfen (die Buchung folgt sonst
      // dem Beleg); die Abweichung zeigt „Vorgang gegen Buchung“
      const jahr = await abgleich.abgleichJahr(2026, "2026-12-31");
      expect(jahr.hinweise).toContainEqual(expect.stringMatching(/^Bitte prüfen: Vorsteuer 19 % zur Bemessungsgrundlage /));
      expect(abgleich.abweichungen(jahr.zeilen)).toEqual([
        // Die Buchung passt nicht mehr zum Beleg: 101 € Aufwand statt 100 €
        expect.objectContaining({
          bereich: "beleg",
          zeitraum: "2026-03",
          journal: 10_100,
          quelle: 10_000,
          posten: expect.stringMatching(new RegExp(`^Beleg .*: Konto ${kontenrahmen === "SKR03" ? "4806" : "6495"}$`)),
        }),
      ]);
    }, 60_000);

    it(`AfA und Privatnutzung: vor dem Buchen aus dem Anlagenverzeichnis, danach aus dem Journal (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      await assets.createAsset(actor, {
        name: "Firmenwagen",
        kind: "kfz",
        method: "linear",
        acquisitionDate: "2023-01-10",
        cost: 3_600_000,
        usefulLifeMonths: 72,
        openingDate: "2025-01-01",
        openingBookValue: 2_400_000,
        disposalDate: null,
        privateUse: { listPrice: 4_000_000, drive: "elektro", rate: 100, vat: true },
        note: "",
      });
      await invoice("2025-06-01", [{ net: 10_000, rate: 1900 }]);
      const vorher = await reports.euerForYear(2025);
      expect(vorher.ausgaben.find((l) => l.key === "afa")!.amount).toBeGreaterThan(0);
      // Bis #1116 auch der Gewinn der Gegenprobe aus den Nebenbüchern
      expect(vorher.gewinn).toBe(-47_040);
      await assets.bookDepreciation(actor, 2025, "2025-12-15");
      const nachher = await reports.euerForYear(2025);
      expect(nachher.gewinn).toBe(vorher.gewinn);
      expect([...nachher.einnahmen, ...nachher.ausgaben].map((l) => [l.key, l.amount])).toEqual(
        [...vorher.einnahmen, ...vorher.ausgaben].map((l) => [l.key, l.amount]),
      );
    }, 60_000);
  }
});
