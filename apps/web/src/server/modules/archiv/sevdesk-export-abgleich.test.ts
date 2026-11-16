import { strToU8 } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, innerZip, zip } from "../../../../../../packages/import/src/sevdesk/export/testzip.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abgleich je Jahr für Belege aus der Export-ZIP von sevDesk (#1106), nachgebaut aus dem Auszug der Testdaten 2.0
 * (test-fixtures/sevdesk): Rechnung (Erlöskonto, GUID …01), Ausgabebeleg (Aufwandskonto, GUID …02, Belegbild auf
 * Wunsch weggelassen), ein Darlehen ohne Beleglink (ohne Belegbild im Export). Dazu erfundene Zeilen: eine zweite Zeile
 * der Rechnung mit anderer Belegfeld-1-Nummer, ein zweiter Beleg mit derselben Nummer wie die Rechnung und eigener GUID
 * (…09) an einem anderen Tag, die Zahlung der Rechnung (Bank an Debitor, ohne Beleglink) und eine Privatentnahme ohne
 * Belegnummer. Konten je Kontenrahmen: SKR03 Bank 1200, Privat 1800; SKR04 Bank 1800, Privat 2100 (packages/core/src/posting.ts).
 */

type Kontenrahmen = "SKR03" | "SKR04";
const KONTEN: Record<Kontenrahmen, { erloes: string; aufwand: string; darlehen: string; bank: string; privat: string }> = {
  SKR03: { erloes: "8400", aufwand: "4985", darlehen: "0630", bank: "1200", privat: "1800" },
  SKR04: { erloes: "4400", aufwand: "6300", darlehen: "3150", bank: "1800", privat: "2100" },
};
const STAPEL = "EXTF_Buchungsstapel_20240101_20241231.csv";
const NAME = "BITTE-ENTPACKEN_Buchungsstapel_und_Belegbilder_1_1_20240101_bis_20241231.zip";
const GUID_ZWEITER = "00000000-0000-4000-8000-000000000009";
const [kopf, spalten, rechnung, ausgabe] = new TextDecoder().decode(fixture("buchhaltung-2.0/extf-buchungsstapel-auszug.csv")).split("\n") as string[];
const AUSGABEBILD = new TextDecoder().decode(fixture("buchhaltung-2.0/document-rechnungseingang.xml")).match(/[^"]*\.pdf/)![0];

/** Zeile ohne Beleglink und ohne Netto, Steuer und Satz in Beleginfo: keine Belegdaten, nur eine Buchung */
const ohneBelegdaten = (zeile: string) =>
  zeile
    .replace(/"BEDI ""[^"]+"""/, "")
    .replace(/"Umsatzsteuerprozent";19;/, '"Umsatzsteuerprozent";;')
    .replace(";84,03;", ";;")
    .replace(";15,97;", ";;");

function stapel(kontenrahmen: Kontenrahmen, extra: { zweiteZeile?: boolean; gleicheNummer?: boolean } = {}): Uint8Array {
  const k = KONTEN[kontenrahmen];
  const darlehen = ausgabe!
    .replace(/"BEDI ""[^"]+"""/, "")
    .replace(/^100,00;"H"/, '500,00;"S"')
    .replace(";70002;4985;9;", `;70002;${k.darlehen};;`)
    .replace(";1111111111111111112;", ";DL-1;")
    .replace(";84,03;", ";500,00;")
    .replace(";15,97;", ";;");
  // Zahlung der Rechnung: Bank im Soll an Debitor, Belegfeld 1 die Rechnungsnummer, an einem anderen Tag
  const zahlung = ohneBelegdaten(rechnung!)
    .replace(/^100,00;"H"/, '100,00;"S"')
    .replace(";8400;10001;;1501;", `;${k.bank};10001;;2001;`);
  const privat = ohneBelegdaten(rechnung!)
    .replace(/^100,00;"H"/, '50,00;"S"')
    .replace(';8400;10001;;1501;"XX-1111111111";', `;${k.privat};${k.bank};;2501;"";`);
  const zeilen = [rechnung!, ausgabe!, darlehen, zahlung, privat];
  // Versand als zweite Zeile derselben Rechnung, mit eigener Nummer in Belegfeld 1
  if (extra.zweiteZeile) zeilen.push(rechnung!.replace(/^100,00/, "10,00").replace('"XX-1111111111"', '"XX-VERSAND"'));
  // Ein zweiter Beleg mit derselben Nummer wie die Rechnung und eigener GUID
  if (extra.gleicheNummer)
    zeilen.push(
      rechnung!
        .replace(/^100,00/, "200,00")
        .replace(";1501;", ";1601;")
        .replace(/000000000001""/, `${GUID_ZWEITER.slice(-12)}""`),
    );
  return strToU8([kopf, spalten, ...zeilen.map((z) => z.replace(";8400;", `;${k.erloes};`).replace(";4985;", `;${k.aufwand};`))].join("\n"));
}

function exportZip(kontenrahmen: Kontenrahmen, opts: { ohneAusgabebild?: boolean; zweiteZeile?: boolean; gleicheNummer?: boolean } = {}) {
  return zip({
    [STAPEL]: stapel(kontenrahmen, opts),
    "EXTF_GP_Stamm_20240101_20241231.csv": fixture("buchhaltung-2.0/extf-gp-stamm.csv"),
    "DATEV_Rechnungsausgang_20240101_20241231.zip": innerZip(fixture("buchhaltung-2.0/document-rechnungsausgang.xml")),
    "DATEV_Rechnungseingang_20240101_20241231.zip": innerZip(
      fixture("buchhaltung-2.0/document-rechnungseingang.xml"),
      opts.ohneAusgabebild ? [AUSGABEBILD] : [],
    ),
  });
}

describe.skipIf(!testDatabaseUrl)("sevDesk ohne API: Abgleich je Jahr (Postgres)", () => {
  let sev: typeof import("./sevdesk-export.ts");
  let archive: typeof import("./archive.ts");
  let lex: typeof import("./lexoffice.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    sev = await import("./sevdesk-export.ts");
    archive = await import("./archive.ts");
    lex = await import("./lexoffice.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: Kontenrahmen, versteuerung: "ist" | "soll") {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
  }

  async function run(bytes: Uint8Array) {
    await sev.analyseSevdeskExport(bytes, NAME);
    const id = await sev.startSevdeskExportImport(actor, { wait: true });
    expect((await sev.sevdeskExportImportStatus(id))!.status).toBe("fertig");
  }

  /** IDEA-Export, ELSTER-Protokoll und Kontoauszug, damit nur die Prüfungen der Belege offen sein können */
  async function archivieren() {
    for (const kind of ["idea", "elster", "kontoauszug"] as const) {
      await archive.addArchiveFile(actor, { bytes: strToU8(`erfunden ${kind}`), filename: `${kind}-2024.txt`, kind, year: 2024 });
    }
  }

  const jahr = async () => (await lex.reconciliation()).years.find((y) => y.year === 2024)!;
  const check = (year: Awaited<ReturnType<typeof jahr>>, label: string) => year.checks.find((c) => c.label === label);

  describe.each([
    ["SKR03", "soll"],
    ["SKR03", "ist"],
    ["SKR04", "soll"],
    ["SKR04", "ist"],
  ] as const)("%s, %s", (kontenrahmen, versteuerung) => {
    it("zeigt die vier Zustände mit Zahl; „Datei fehlt“ verhindert „vollständig“", async () => {
      await company(kontenrahmen, versteuerung);
      await run(exportZip(kontenrahmen, { ohneAusgabebild: true }));
      await archivieren();
      const year = await jahr();
      expect(year.sevdeskExport).toEqual({ withFile: 1, missingFile: 1, withoutImage: 1 });
      expect(check(year, "Belege aus dem sevDesk-Export übernommen")).toEqual({
        ok: true,
        label: "Belege aus dem sevDesk-Export übernommen",
        detail: "3 Belege, 1 mit Datei, 1 ohne Belegbild im Export, 1 Datei fehlt im Export",
      });
      expect(check(year, "Belege und Rechnungen per API abgerufen")).toBeUndefined();
      // Nur die fehlende Datei, nicht das Darlehen ohne Belegbild
      expect(check(year, "Jeder Beleg hat eine Datei")).toMatchObject({ ok: false, detail: "1 ohne Datei" });
      // Ohne Beleg wie bei den anderen Quellen: die Privatentnahme ohne Belegnummer; die Zahlung findet die Rechnung über die Nummer
      expect(year.bookings).toEqual({ total: 5, unmatched: 0, withoutNumber: 1 });
      expect(year.ready).toBe(false);
    });

    it(`ohne fehlende Datei: ${versteuerung === "soll" ? "vollständig" : "bei Ist nicht vollständig, mit Grund"}`, async () => {
      await company(kontenrahmen, versteuerung);
      await run(exportZip(kontenrahmen));
      await archivieren();
      const year = await jahr();
      expect(year.sevdeskExport).toEqual({ withFile: 2, missingFile: 0, withoutImage: 1 });
      expect(check(year, "Jeder Beleg hat eine Datei")).toMatchObject({ ok: true, detail: "alle mit Datei" });
      expect(year.bookings).toMatchObject({ unmatched: 0 });
      if (versteuerung === "soll") {
        expect(year.checks.filter((c) => !c.ok)).toEqual([]);
        expect(year.ready).toBe(true);
        expect(year.vatIssue).toBeNull();
      } else {
        expect(year.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(["Zahlungshistorie vollständig"]);
        expect(year.ready).toBe(false);
        expect(year.vatIssue).toMatch(/ordnet Zahlungen keinem Beleg zu/);
      }
    });

    it("eine weitere Zeile desselben Belegs findet ihn über die GUID, auch mit anderer Nummer", async () => {
      await company(kontenrahmen, versteuerung);
      await run(exportZip(kontenrahmen, { zweiteZeile: true }));
      const year = await jahr();
      expect(year.sevdeskExport).toMatchObject({ withFile: 2 });
      expect(year.bookings).toEqual({ total: 6, unmatched: 0, withoutNumber: 1 });
    });

    it("zwei Belege mit gleicher Nummer zählen getrennt; die Zahlung zur Nummer bleibt gefunden", async () => {
      await company(kontenrahmen, versteuerung);
      await run(exportZip(kontenrahmen, { gleicheNummer: true }));
      expect((await jahr()).bookings).toEqual({ total: 6, unmatched: 0, withoutNumber: 1 });
      // Fehlt der zweite Beleg in Haben, findet seine Buchung nicht den ersten mit derselben Nummer
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from lexoffice_vouchers where raw->>'guid' = ${GUID_ZWEITER}`;
      });
      expect((await jahr()).bookings).toEqual({ total: 6, unmatched: 1, withoutNumber: 1 });
      const offen = await archive.listDatevBookings({ year: 2024, search: "", unmatched: true, page: 0 });
      // Die Liste zeigt auch Buchungen ohne Belegnummer (Privatentnahme); mit Nummer nur die eine
      expect(offen.rows.filter((r) => r.voucherField1 !== "").map((r) => [r.date, r.voucherField1, r.amount])).toEqual([
        ["2024-01-16", "XX-1111111111", 20000],
      ]);
    });
  });

  it("Jahr mit Belegen aus der API: Buchungen aus dem Export finden sie weiter über die Nummer", async () => {
    await company("SKR03", "soll");
    const [imp] = await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{"phase":"fertig"}'::jsonb, 'sevdesk') returning id`;
    for (const [id, number, direction] of [
      ["invoice/1", "XX-1111111111", "einnahme"],
      ["voucher/2", "1111111111111111112", "ausgabe"],
    ] as const) {
      await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, source, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
        values (${id}, ${imp!.id}, 'sevdesk', 'invoice', ${direction}, ${number}, '2024-01-15', 'paid', 'Kunde', 8403, 1597, 10000, '[]'::jsonb, '[]'::jsonb, null, '{}'::jsonb)`;
    }
    await run(exportZip("SKR03"));
    const year = await jahr();
    expect(year.sevdeskExport).toBeNull();
    expect(check(year, "Belege und Rechnungen per API abgerufen")).toMatchObject({ ok: true });
    // Das Darlehen (DL-1) hat keinen Beleg aus der API: wie vor #1106 ohne passenden Beleg
    expect(year.bookings).toEqual({ total: 5, unmatched: 1, withoutNumber: 1 });
  });
  it("Mischjahr bei Ist (Lexoffice bis zum Wechsel, dann Export): nicht vollständig, solange die Umsatzsteuer fehlt", async () => {
    await company("SKR03", "ist");
    const [imp] = await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{"phase":"fertig"}'::jsonb, 'lexoffice') returning id`;
    const [v] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, source, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values ('lex-1', ${imp!.id}, 'lexoffice', 'purchaseinvoice', 'ausgabe', 'LX-1', '2024-01-05', 'paid', 'Lieferant', 1000, 190, 1190, '[]'::jsonb, '[]'::jsonb, null, '{}'::jsonb) returning id`;
    await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size) values (${v!.id}, 'pdf', 'lx-1.pdf', 'application/pdf', ${"a".repeat(64)}, 1)`;
    await run(exportZip("SKR03"));
    await archivieren();
    const year = await jahr();
    expect(year.sevdeskExport).toMatchObject({ withFile: 2, missingFile: 0 });
    expect(year.vatIssue).toMatch(/ordnet Zahlungen keinem Beleg zu/);
    // Ohne Umsatzsteuer je Monat ist das Jahr nicht vollständig, wie in einem Jahr nur aus dem Export
    expect(year.ready).toBe(false);
  });
});
