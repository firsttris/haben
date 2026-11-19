import type { EuerLine, EuerResult } from "@haben/core";
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
 * Zeilen, Gewinn und Monate gegen feste Werte (ERWARTET), die bis #1116 die Nebenbücher als Gegenprobe lieferten.
 */
/** Was euerForYear liefert, kurz: Zeilen mit Betrag (und Notiz), Gewinn, nachrichtliche Beträge, Monate */
function kurz(e: EuerResult) {
  const zeilen = (l: EuerLine[]) => l.map((z) => (z.note ? [z.key, z.amount, z.note] : [z.key, z.amount]));
  return {
    einnahmen: zeilen(e.einnahmen),
    ausgaben: zeilen(e.ausgaben),
    gewinn: e.gewinn,
    bewirtung: e.bewirtungNichtAbziehbar,
    gewerbesteuer: e.gewerbesteuerNichtAbziehbar,
    monate: e.monthly,
  };
}

describe.skipIf(!testDatabaseUrl)("EÜR aus dem Journal bei Wechseln zum Jahreswechsel und mit Anlagen (Postgres)", () => {
  let reports: typeof import("./reports.ts");
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
    reports = await import("./reports.ts");
    assets = await import("../buchhaltung/assets.ts");
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** EÜR des Jahres gegen die festen Werte (ERWARTET), je Test und Jahr; ein zweiter Aufruf im selben Test hat „|2“ */
  const aufrufe = new Map<string, number>();
  async function wieErwartet(year: number) {
    const test = `${expect.getState().currentTestName!.split(" > ").at(-1)}|${year}`;
    const n = (aufrufe.get(test) ?? 0) + 1;
    aufrufe.set(test, n);
    const key = n === 1 ? test : `${test}|${n}`;
    expect(kurz(await reports.euerForYear(year)), key).toEqual(ERWARTET[key]);
  }

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
      category?: "edv" | "telefon" | "sonstiges" | "hardware" | "anlage" | "bewirtung" | "geschenke";
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

  /** Alles, was euerForYear liefert */
  const gleich = async (...years: number[]) => {
    for (const year of years) {
      await wieErwartet(year);
    }
  };

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const [vorher, nachher] of [
      [true, false],
      [false, true],
    ] as const) {
      it(`Kleinunternehmer ${vorher} → ${nachher} zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (${kontenrahmen})`, async () => {
        await reset("ist", kontenrahmen, vorher);
        const draft = await invoices.createDraft(actor, {
          contactId,
          issueDate: "2025-12-10",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          ...(vorher ? { taxTreatment: "kleinunternehmer" } : {}),
          lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 33_333, taxRate: vorher ? 0 : 1900 }],
        } as never);
        const a = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
        const b = await bookedDocument("2025-12-12", [{ taxRate: 1900, net: 5_001, tax: 950 }], { category: "bewirtung" });
        await sql`update company set kleinunternehmer = ${nachher} where id = 1`;
        const txs = await transactions([eingang("10.02.26", `RE ${a.number} Teil`, "100,01"), ausgang("11.02.26", "Restaurant", "-33,33")]);
        await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount === 10_001)!.id, invoiceId: a.id, amount: 10_001 });
        await bank.allocate(actor, { kind: "document", transactionId: txs.find((t) => t.amount === -3_333)!.id, documentId: b, amount: -3_333 });
        await gleich(2025, 2026);
      }, 60_000);
    }
  }
  for (const [vorher, nachher] of [
    ["SKR03", "SKR04"],
    ["SKR04", "SKR03"],
  ] as const) {
    it(`Kontenrahmenwechsel ${vorher} → ${nachher} zum Jahreswechsel: Restzahlungen auf Rechnungen und Belege (Privatanteil, Bewirtung, 7 %) aus dem Vorjahr`, async () => {
      await reset("ist", vorher, false);
      const a = await invoice("2025-11-10", [{ net: 33_333, rate: 1900 }]);
      const b = await bookedDocument("2025-11-12", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
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
        privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true },
        note: "",
      } as never);
      let txs = await transactions([eingang("20.11.25", `RE ${a.number} Teil`, "100,01"), ausgang("21.11.25", "Telefon", "-19,51")]);
      await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount === 10_001)!.id, invoiceId: a.id, amount: 10_001 });
      await bank.allocate(actor, { kind: "document", transactionId: txs.find((t) => t.amount === -1_951)!.id, documentId: b, amount: -1_951 });
      const c = await bookedDocument("2025-12-20", [{ taxRate: 700, net: 3_333, tax: 233 }], { category: "bewirtung" });
      const d = await invoice("2025-12-22", [{ net: 11_111, rate: 700 }]);
      await assets.bookDepreciation(actor, 2025, "2025-12-31");
      txs = await transactions([
        ausgang("28.12.25", "Restaurant", "-11,11"),
        eingang("29.12.25", `RE ${d.number} Teil`, "33,33"),
        eingang("15.01.26", `RE ${a.number} Rest`, "296,65"),
        ausgang("16.01.26", "Telefon", "-40,00"),
        eingang("17.01.26", `RE ${d.number} Rest`, "85,56"),
      ]);
      const id = (amount: number) => txs.find((t) => t.amount === amount)!.id;
      await bank.allocate(actor, { kind: "document", transactionId: id(-1_111), documentId: c, amount: -1_111 });
      await bank.allocate(actor, { kind: "invoice", transactionId: id(3_333), invoiceId: d.id, amount: 3_333 });
      await sql`update company set kontenrahmen = ${nachher} where id = 1`;
      await bank.allocate(actor, { kind: "invoice", transactionId: id(29_665), invoiceId: a.id, amount: 29_665 });
      await bank.allocate(actor, { kind: "document", transactionId: id(-4_000), documentId: b, amount: -4_000 });
      await bank.allocate(actor, { kind: "invoice", transactionId: id(8_556), invoiceId: d.id, amount: 8_556 });
      await gleich(2025, 2026);
    }, 60_000);
  }
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const ku of [false, true]) {
      it(`Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (${kontenrahmen}, Kleinunternehmer ${ku})`, async () => {
        await reset("ist", kontenrahmen, ku);
        const base = { usefulLifeMonths: null, disposalDate: null, privateUse: null, note: "" };
        await assets.createAsset(actor, {
          ...base,
          name: "Altwagen",
          kind: "kfz",
          method: "linear",
          acquisitionDate: "2022-01-10",
          cost: 3_600_011,
          usefulLifeMonths: 72,
          openingDate: "2026-01-01",
          openingBookValue: 1_200_003,
          disposalDate: "2026-06-30",
        } as never);
        await assets.createAsset(actor, {
          ...base,
          name: "E-Auto",
          kind: "kfz",
          method: "linear",
          acquisitionDate: "2025-04-10",
          cost: 4_800_007,
          usefulLifeMonths: 72,
          openingDate: "2026-01-01",
          openingBookValue: 4_000_001,
          privateUse: { listPrice: 5_123_400, drive: "elektro", rate: 100, vat: !ku },
        } as never);
        await assets.createAsset(actor, {
          ...base,
          name: "Regal",
          kind: "buero",
          method: "sammelposten",
          acquisitionDate: "2026-03-01",
          cost: 55_555,
          openingDate: "2026-03-01",
          openingBookValue: 55_555,
        } as never);
        await assets.createAsset(actor, {
          ...base,
          name: "Monitor",
          kind: "edv",
          method: "gwg",
          acquisitionDate: "2026-03-01",
          cost: 70_001,
          openingDate: "2026-03-01",
          openingBookValue: 70_001,
        } as never);
        await assets.createAsset(actor, {
          ...base,
          name: "Maschine",
          kind: "sonstiges",
          method: "degressiv",
          acquisitionDate: "2025-07-15",
          cost: 1_234_567,
          usefulLifeMonths: 120,
          openingDate: "2026-01-01",
          openingBookValue: 1_049_382,
        } as never);
        if (ku) await bookedDocument("2026-06-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }]);
        else await invoice("2026-06-01", [{ net: 10_000, rate: 1900 }]);
        await gleich(2026);
        await assets.bookDepreciation(actor, 2026, "2026-12-15");
        await gleich(2026);
      }, 60_000);
    }
  }
});

/**
 * Feste Werte der EÜR je Test und Jahr. Bis #1116 verglich der Test die EÜR aus dem Journal mit der aus den Nebenbüchern;
 * die Werte sind die der Nebenbücher, wie sie die Rechnung aus dem Journal seither ergeben muss.
 */
const ERWARTET: Record<string, ReturnType<typeof kurz>> = {
  "Kleinunternehmer true → false zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (SKR03)|2025": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: 0,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kleinunternehmer true → false zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (SKR03)|2026": {
    einnahmen: [
      ["einnahmenKleinunternehmer", 10001],
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["ausgabe:bewirtung", 2333, "Abziehbarer Teil (70 %)"],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: 7668,
    bewirtung: 1000,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 10001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 2333, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kleinunternehmer false → true zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (SKR03)|2025": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: 0,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kleinunternehmer false → true zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (SKR03)|2026": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 8404],
      ["einnahmenSteuerfrei", 0],
      ["vereinnahmteUst", 1597],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["ausgabe:bewirtung", 1961, "Abziehbarer Teil (70 %)"],
      ["vorsteuer", 532],
      ["gezahlteUst", 0],
    ],
    gewinn: 7508,
    bewirtung: 840,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 8404, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 1961, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kleinunternehmer true → false zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (SKR04)|2025": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: 0,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kleinunternehmer true → false zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (SKR04)|2026": {
    einnahmen: [
      ["einnahmenKleinunternehmer", 10001],
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["ausgabe:bewirtung", 2333, "Abziehbarer Teil (70 %)"],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: 7668,
    bewirtung: 1000,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 10001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 2333, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kleinunternehmer false → true zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (SKR04)|2025": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: 0,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kleinunternehmer false → true zum Jahreswechsel: offene Rechnung und offener Beleg aus dem Vorjahr, im Folgejahr in Teilen bezahlt (SKR04)|2026": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 8404],
      ["einnahmenSteuerfrei", 0],
      ["vereinnahmteUst", 1597],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["ausgabe:bewirtung", 1961, "Abziehbarer Teil (70 %)"],
      ["vorsteuer", 532],
      ["gezahlteUst", 0],
    ],
    gewinn: 7508,
    bewirtung: 840,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 8404, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 1961, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kontenrahmenwechsel SKR03 → SKR04 zum Jahreswechsel: Restzahlungen auf Rechnungen und Belege (Privatanteil, Bewirtung, 7 %) aus dem Vorjahr|2025": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 11519],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 480000],
      ["vereinnahmteUst", 1815],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["ausgabe:telefon", 1148],
      ["ausgabe:bewirtung", 727, "Abziehbarer Teil (70 %)"],
      ["afa", 600000],
      ["vorsteuer", 291],
      ["gezahlteUst", 0],
    ],
    gewinn: -108832,
    bewirtung: 311,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8404, 3115], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1148, 727] },
  },
  "Kontenrahmenwechsel SKR03 → SKR04 zum Jahreswechsel: Restzahlungen auf Rechnungen und Belege (Privatanteil, Bewirtung, 7 %) aus dem Vorjahr|2026": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 32925],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 480000],
      ["vereinnahmteUst", 5296],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["ausgabe:telefon", 2353],
      ["afa", 600000],
      ["vorsteuer", 447],
      ["gezahlteUst", 0],
    ],
    gewinn: -84579,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [32925, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [2353, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Kontenrahmenwechsel SKR04 → SKR03 zum Jahreswechsel: Restzahlungen auf Rechnungen und Belege (Privatanteil, Bewirtung, 7 %) aus dem Vorjahr|2025": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 11519],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 480000],
      ["vereinnahmteUst", 1815],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["ausgabe:telefon", 1148],
      ["ausgabe:bewirtung", 727, "Abziehbarer Teil (70 %)"],
      ["afa", 600000],
      ["vorsteuer", 291],
      ["gezahlteUst", 0],
    ],
    gewinn: -108832,
    bewirtung: 311,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8404, 3115], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1148, 727] },
  },
  "Kontenrahmenwechsel SKR04 → SKR03 zum Jahreswechsel: Restzahlungen auf Rechnungen und Belege (Privatanteil, Bewirtung, 7 %) aus dem Vorjahr|2026": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 32925],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 480000],
      ["vereinnahmteUst", 5296],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["ausgabe:telefon", 2353],
      ["afa", 600000],
      ["vorsteuer", 447],
      ["gezahlteUst", 0],
    ],
    gewinn: -84579,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [32925, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [2353, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (SKR03, Kleinunternehmer false)|2026": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 614400],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["afa", 1376721],
      ["gwg", 70001],
      ["sammelposten", 11111],
      ["restbuchwert", 900002],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: -1743435,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (SKR03, Kleinunternehmer false)|2026|2": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 614400],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["afa", 1376721],
      ["gwg", 70001],
      ["sammelposten", 11111],
      ["restbuchwert", 900002],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: -1743435,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (SKR03, Kleinunternehmer true)|2026": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 614400],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["afa", 1376721],
      ["gwg", 70001],
      ["sammelposten", 11111],
      ["restbuchwert", 900002],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: -1743435,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (SKR03, Kleinunternehmer true)|2026|2": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 614400],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["afa", 1376721],
      ["gwg", 70001],
      ["sammelposten", 11111],
      ["restbuchwert", 900002],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: -1743435,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (SKR04, Kleinunternehmer false)|2026": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 614400],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["afa", 1376721],
      ["gwg", 70001],
      ["sammelposten", 11111],
      ["restbuchwert", 900002],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: -1743435,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (SKR04, Kleinunternehmer false)|2026|2": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 614400],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["afa", 1376721],
      ["gwg", 70001],
      ["sammelposten", 11111],
      ["restbuchwert", 900002],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: -1743435,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (SKR04, Kleinunternehmer true)|2026": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 614400],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["afa", 1376721],
      ["gwg", 70001],
      ["sammelposten", 11111],
      ["restbuchwert", 900002],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: -1743435,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  "Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (SKR04, Kleinunternehmer true)|2026|2": {
    einnahmen: [
      ["einnahmenSteuerpflichtig", 0],
      ["einnahmenSteuerfrei", 0],
      ["privateKfz", 614400],
      ["vereinnahmteUst", 0],
      ["erstatteteUst", 0],
    ],
    ausgaben: [
      ["afa", 1376721],
      ["gwg", 70001],
      ["sammelposten", 11111],
      ["restbuchwert", 900002],
      ["vorsteuer", 0],
      ["gezahlteUst", 0],
    ],
    gewinn: -1743435,
    bewirtung: 0,
    gewerbesteuer: 0,
    monate: { einnahmen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ausgaben: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
};
