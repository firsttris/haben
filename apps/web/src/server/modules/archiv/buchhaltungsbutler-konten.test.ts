import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { datevYearSums } from "@haben/import";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Abgleich je Jahr (Einnahmen, Umsatzsteuer je Monat) nach einem BuchhaltungsButler-Import

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

describe.skipIf(!testDatabaseUrl)("BuchhaltungsButler im Jahresabgleich: Summen aus dem DATEV-Stapel (Postgres)", () => {
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

  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", rechtsform: string) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
  }

  async function year2023() {
    const { years } = await lex.reconciliation();
    return years.find((y) => y.year === 2023)!;
  }

  type Case = [name: string, skr: "SKR03" | "SKR04", rechtsform: string, rows: Row[]];
  const R = (id: string, debit: string, credit: string, bu: string, amount: string, receipt = true): Row => ({
    id,
    debit,
    credit,
    bu,
    rate: bu === "3" || bu === "9" ? "19" : "0",
    receipt,
    amount,
  });
  // Buchungen aus den Review-Runden zu #571: jede, deren Einordnung aus den Konten geschätzt werden müsste
  const CASES: Case[] = [
    ["Anlagekauf über den Kreditor", "SKR03", "gmbh", [R("1", "0420", "70000", "9", "1.190,00"), R("2", "70000", "1200", "", "1.190,00", false)]],
    ["Anlagenverkauf bei Buchverlust (8801)", "SKR03", "gmbh", [R("1", "1200", "8801", "3", "1.190,00")]],
    ["Wareneinkauf auf Bestand Waren (3980)", "SKR03", "gmbh", [R("1", "3980", "70000", "9", "119,00")]],
    ["Kfz-Steuer (7685)", "SKR04", "einzelunternehmen", [R("1", "7685", "1800", "", "180,00")]],
    ["Zinsaufwand (2110)", "SKR03", "einzelunternehmen", [R("1", "2110", "1200", "", "50,00")]],
    ["Erstattung der Kfz-Steuer (1800 an 7685)", "SKR04", "einzelunternehmen", [R("1", "1800", "7685", "", "50,00")]],
    [
      "Umsatzsteuer-Zahlung und Darlehen",
      "SKR04",
      "einzelunternehmen",
      [R("1", "3820", "1800", "", "300,00", false), R("2", "1800", "3150", "", "5.000,00", false)],
    ],
    ["Darlehensauszahlung (0630)", "SKR03", "einzelunternehmen", [R("1", "1200", "0630", "", "10.000,00")]],
    ["Privatentnahme (2100)", "SKR04", "einzelunternehmen", [R("1", "2100", "1800", "", "500,00")]],
    ["Körperschaftsteuer (2200)", "SKR03", "gmbh", [R("1", "2200", "1200", "", "5.000,00")]],
    ["Körperschaftsteuer (7600)", "SKR04", "gmbh", [R("1", "7600", "1800", "", "5.000,00")]],
    ["Gesellschafter (3510)", "SKR04", "gmbh", [R("1", "3510", "1800", "", "500,00")]],
  ];

  async function importCase(skr: "SKR03" | "SKR04", rechtsform: string, rows: Row[]) {
    await company(skr, "soll", rechtsform);
    await bb.startBuchhaltungsbutlerImport("test-user", parts(rows, skr === "SKR03" ? "03" : "04"));
    return year2023();
  }

  it.each(CASES)("%s (%s, %s): Summen aus dem DATEV-Stapel, keine Einordnung aus den BB-Belegen", async (_name, skr, rechtsform, rows) => {
    const y = await importCase(skr, rechtsform, rows);
    const stack = await sql<{ amount: number; side: "S" | "H"; account: string; contra_account: string; bu_key: string }[]>`
      select amount, side, account, contra_account, bu_key from datev_bookings`;
    const expected = datevYearSums(
      stack.map((b) => ({ amount: Number(b.amount), side: b.side, account: b.account, contraAccount: b.contra_account, buKey: b.bu_key })),
      skr,
    );
    expect(y.sumsFrom).toBe("datev");
    expect({ einnahmen: [y.einnahmen.net, y.einnahmen.tax], ausgaben: [y.ausgaben.net, y.ausgaben.tax] }).toEqual({
      einnahmen: [expected.einnahmen.net, expected.einnahmen.tax],
      ausgaben: [expected.ausgaben.net, expected.ausgaben.tax],
    });
    // Je Monat und für Neutrales fehlt die Grundlage: kein Ersatz aus geschätzten Belegen
    expect(y.vat).toEqual([]);
    expect(y.neutral).toEqual([]);
    expect(y.vatIssue).toBeNull();
    // Die Belege liegen trotzdem im Archiv und zählen als abgerufen, sofern der Export welche enthält
    expect(y.checks.find((c) => c.label === "Belege und Rechnungen per API abgerufen")?.ok).toBe(rows.some((r) => r.receipt));
  });

  it("zählt Anlagenverkauf bei Buchverlust als Einnahme mit Umsatzsteuer", async () => {
    const y = await importCase("SKR03", "gmbh", [R("1", "1200", "8801", "3", "1.190,00")]);
    expect(y.einnahmen).toMatchObject({ net: 100000, tax: 19000 });
  });

  it("zählt Wareneinkauf auf Bestand Waren als Ausgabe mit Vorsteuer", async () => {
    const y = await importCase("SKR03", "gmbh", [R("1", "3980", "70000", "9", "119,00")]);
    expect(y.ausgaben).toMatchObject({ net: 10000, tax: 1900 });
  });

  it.each([
    [
      "Umsatzsteuer-Zahlung und Darlehen",
      "SKR04",
      "einzelunternehmen",
      [R("1", "3820", "1800", "", "300,00", false), R("2", "1800", "3150", "", "5.000,00", false)],
    ],
    ["Darlehensauszahlung (0630)", "SKR03", "einzelunternehmen", [R("1", "1200", "0630", "", "10.000,00")]],
    ["Privatentnahme (2100)", "SKR04", "einzelunternehmen", [R("1", "2100", "1800", "", "500,00")]],
    ["Körperschaftsteuer (2200)", "SKR03", "gmbh", [R("1", "2200", "1200", "", "5.000,00")]],
    ["Körperschaftsteuer (7600)", "SKR04", "gmbh", [R("1", "7600", "1800", "", "5.000,00")]],
  ] as Case[])("%s (%s, %s) ist weder Einnahme noch Ausgabe", async (_name, skr, rechtsform, rows) => {
    const y = await importCase(skr, rechtsform, rows);
    expect([y.einnahmen.gross, y.ausgaben.gross]).toEqual([0, 0]);
  });

  it("SKR03: Erlös auf dem Automatikkonto 8400 ohne BU-Schlüssel und ohne Beleg trägt 19 % Umsatzsteuer", async () => {
    const y = await importCase("SKR03", "einzelunternehmen", [{ id: "1", debit: "1200", credit: "8400", bu: "", rate: "", receipt: false, amount: "119,00" }]);
    expect(y.einnahmen).toMatchObject({ net: 10000, tax: 1900, gross: 11900 });
  });

  it("liefert BB-Belege nicht in der Zeitraumabfrage für die Umsatzsteuer", async () => {
    await importCase("SKR03", "einzelunternehmen", [R("1", "1200", "8400", "3", "119,00")]);
    const result = await lex.legacyVouchersForPeriod({ period: "2023", direction: "alle", search: "", withPayments: false, limit: 100 });
    expect(result).toMatchObject({ total: 0, vouchers: [], neutral: [] });
  });
});
