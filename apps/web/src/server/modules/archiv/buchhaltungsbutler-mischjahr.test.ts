import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Review PR #571, Runde 5: Mischjahre (Lexoffice/sevDesk und BuchhaltungsButler im selben Jahr), SKR04

const BB_HEADERS = [
  "Datum",
  "Buchungstext",
  "Betrag",
  "Währung",
  "Sollkonto",
  "Habenkonto",
  "Steuerschlüssel",
  "Buchungsnummer",
  "Rechnungsnummern",
  "Gegenpartei",
  "Umsatzsteuer",
  "Zugewiesene Beträge",
  "Beleglinks",
  "Festschreibung",
  "Kommentar",
  "Leistungsdatum",
];
const DATEV_HEADERS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Buchungstext",
  ...Array.from({ length: 16 }, (_, i) => `Beleginfo - ${i % 2 === 0 ? "Art" : "Inhalt"} ${Math.floor(i / 2) + 1}`),
];
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF");

interface Row {
  id: string;
  debit: string;
  credit: string;
  bu: string;
  rate: string;
  receipt: boolean;
  amount?: string;
}

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((r) => r.map((f) => `"${f}"`).join(";")).join("\r\n"));

function parts(rows: Row[], skr = "03") {
  const meta = Array.from({ length: 30 }, () => "");
  Object.assign(meta, {
    0: "EXTF",
    1: "700",
    2: "21",
    3: "Buchungsstapel",
    4: "12",
    12: "20230101",
    13: "4",
    14: "20230101",
    15: "20231231",
    21: "EUR",
    26: skr,
  });
  const datev: string[][] = [meta, DATEV_HEADERS];
  const bb: string[][] = [BB_HEADERS];
  const receipts: Record<string, Uint8Array> = {};
  for (const r of rows) {
    const amount = r.amount ?? "119,00";
    const number = r.receipt ? `R-${r.id}` : "";
    const url = r.receipt ? `https://bb.example/${r.id}.pdf` : "";
    const info = [
      "Buchungsnummer",
      r.id,
      ...(r.receipt
        ? ["URL", url, "Gegenpartei", "Muster GmbH", "Rechnungsnummer", number, "Betrag", amount, "Umsatzsteuer", r.rate, "Rechnungsdatum", "04.01.2023"]
        : []),
    ];
    // Soll/Haben-Kennzeichen S: Konto ist das Sollkonto
    datev.push([amount, "S", "EUR", r.debit, r.credit, r.bu, "0401", number, "Muster GmbH", ...info]);
    bb.push(["04.01.2023", "Muster GmbH", amount, "EUR", r.debit, r.credit, r.bu, r.id, number, "Muster GmbH", r.rate, amount, url, "1", "", "04.01.2023"]);
    if (r.receipt) receipts[`Belege/${r.id}.pdf`] = PDF;
  }
  return [
    { name: "EXTF_Buchungsstapel.csv", bytes: csv(datev) },
    { name: "BB_Buchungsstapel.csv", bytes: csv(bb) },
    { name: "Belege.zip", bytes: zipSync(receipts) },
  ];
}

describe.skipIf(!testDatabaseUrl)("BuchhaltungsButler im Mischjahr und Nummernkreis (Postgres)", () => {
  let bb: typeof import("./buchhaltungsbutler.ts");
  let lex: typeof import("./lexoffice.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    bb = await import("./buchhaltungsbutler.ts");
    lex = await import("./lexoffice.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(versteuerung: "ist" | "soll", rechtsform = "einzelunternehmen", kontenrahmen = "SKR03") {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await sql`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
  }

  /** Rechnung aus Lexoffice (Januar bis Juni), danach Wechsel zu BuchhaltungsButler */
  async function lexofficeInvoice(source: "lexoffice" | "sevdesk", net: number, tax: number) {
    const [run] =
      await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb, ${source}) returning id`;
    await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, source, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, ${run!.id}, ${source}, 'invoice', 'einnahme', 'RE-100', '2023-03-10', 'paid', 'Kunde AG', ${net}, ${tax}, ${net + tax},
        ${JSON.stringify([{ rate: 1900, net, tax }])}::jsonb, '[]'::jsonb, null, '{}'::jsonb)`;
  }

  async function year2023() {
    const { years } = await lex.reconciliation();
    return years.find((y) => y.year === 2023)!;
  }

  beforeEach(() => company("soll"));

  it("Mischjahr Lexoffice und BuchhaltungsButler: die Einnahmen aus dem BB-Teil fehlen nicht in den Summen", async () => {
    await lexofficeInvoice("lexoffice", 50000, 9500);
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "1200", credit: "8400", bu: "3", rate: "19", receipt: true }]));
    const y = await year2023();
    expect(y.einnahmen).toMatchObject({ net: 60000, tax: 11400 });
  });

  it("Mischjahr sevDesk und BuchhaltungsButler: die Ausgaben aus dem BB-Teil fehlen nicht in den Summen", async () => {
    await lexofficeInvoice("sevdesk", 50000, 9500);
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "4964", credit: "1200", bu: "9", rate: "19", receipt: true }]));
    const y = await year2023();
    expect(y.ausgaben).toMatchObject({ net: 10000, tax: 1900 });
  });

  it("SKR04: Erlös auf dem Automatikkonto 4400 zählt aus dem DATEV-Stapel mit Umsatzsteuer", async () => {
    await company("soll", "einzelunternehmen", "SKR04");
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "1800", credit: "4400", bu: "", rate: "19", receipt: true }], "04"));
    const y = await year2023();
    expect(y.sumsFrom).toBe("datev");
    expect(y.einnahmen).toMatchObject({ net: 10000, tax: 1900 });
  });

  it("GmbH, Ist: Gutschrift an einen Kunden mindert die Einnahmen aus dem DATEV-Stapel", async () => {
    await company("ist", "gmbh");
    await bb.startBuchhaltungsbutlerImport(
      "test-user",
      parts([
        { id: "1", debit: "10000", credit: "8400", bu: "", rate: "19", receipt: true },
        { id: "2", debit: "8400", credit: "10000", bu: "", rate: "19", receipt: true, amount: "11,90" },
      ]),
    );
    const y = await year2023();
    expect(y.einnahmen).toMatchObject({ net: 9000, tax: 1710 });
    expect(y.vat).toEqual([]);
  });
  it("nennt die letzte Rechnungsnummer eines BuchhaltungsButler-Jahres, damit der Nummernkreis in Haben weiterläuft", async () => {
    await bb.startBuchhaltungsbutlerImport(
      "test-user",
      parts([
        { id: "1", debit: "10000", credit: "8400", bu: "", rate: "19", receipt: true },
        { id: "2", debit: "10000", credit: "8400", bu: "", rate: "19", receipt: true },
      ]),
    );
    const y = await year2023();
    expect(y.lastInvoiceNumber).toBe("R-2");
  });
});
