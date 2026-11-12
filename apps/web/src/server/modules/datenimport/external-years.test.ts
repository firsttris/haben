import {
  ACCOUNTS,
  documentPaymentPosting,
  documentPosting,
  invoicePaymentPosting,
  invoiceCashPaymentPosting,
  invoicePosting,
  totalsFromTaxes,
  type Kontenrahmen,
  type Versteuerung,
  type PostingLine,
} from "@haben/core";
import type postgres from "postgres";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { ExternalImport } from "./external-schema.ts";

// § 11 EStG: Der Umzug ist kein Zufluss. § 16/18 UStG: Die Jahreswerte enthalten auch extern angemeldete Monate.
describe.skipIf(!testDatabaseUrl)("JSON-Umzug: Jahreswerte und offene Posten (Postgres, #634)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let annual: typeof import("../jahreserklaerung/index.ts");
  let archive: typeof import("../archiv/index.ts");
  let database: typeof import("../../db/index.ts");
  const totals = totalsFromTaxes([{ rate: 1900, base: 100000, tax: 19000 }]);
  const actor = "import-pruefung";
  type Journal = Extract<ExternalImport["entries"][number], { kind: "journal" }> & { settles?: string };
  const entry = (externalId: string, date: string, lines: PostingLine[], settles?: string): Journal => ({
    kind: "journal",
    externalId,
    date,
    description: `Erfundener Prüffall ${externalId}`,
    lines: lines.map(({ basis, ...line }) => ({ ...line, ...(basis == null ? {} : { basis }) })),
    ...(settles ? { settles } : {}),
  });
  const run = (entries: Journal[], kontenrahmen: Kontenrahmen) =>
    imports.runExternalImport(actor, { version: 2, source: "pruefung-634", kontenrahmen, entries }, async () => new Uint8Array());
  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    reports = await import("../auswertungen/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    annual = await import("../jahreserklaerung/index.ts");
    archive = await import("../archiv/index.ts");
    database = await import("../../db/index.ts");
  }, 30000);
  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });
  async function reset(kr: Kontenrahmen, mode: Versteuerung) {
    await leeren(sql)`truncate company, journal_entries, external_imports, lexoffice_imports, vat_returns, vat_frequencies, cash_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,steuernummer,bundesland,iban,versteuerung,kontenrahmen,journal_ab)
      values (1,'Erfundener Testbetrieb','Musterweg 1','93047','Regensburg','test@example.com','198/113/10010','BY','DE89370400440532013000',${mode},${kr},2026)`;
  }
  const income = (euer: Awaited<ReturnType<typeof reports.euerForYear>>) => euer.einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount ?? 0;
  const expense = (euer: Awaited<ReturnType<typeof reports.euerForYear>>) => euer.ausgaben.find((l) => l.key === "ausgabe:edv")?.amount ?? 0;

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const mode of ["ist", "soll"] as const) {
      it(`${kr}/${mode}: offene Quellrechnungen sind am Umzugstag keine Einnahmen oder Ausgaben`, async () => {
        await reset(kr, mode);
        await run(
          [
            entry("AR", "2026-12-10", invoicePosting(totals, kr, mode)),
            entry("ER", "2026-12-11", documentPosting(totals, "edv", kr, "einzelunternehmen", "bank")),
          ],
          kr,
        );
        const euer = await reports.euerForYear(2026);
        expect(income(euer)).toBe(0);
        expect(expense(euer)).toBe(0);
        expect(euer.gewinn).toBe(0);
        const figures = await vat.computeVatFigures({ year: 2026, month: 12 });
        expect(figures.kz81).toBe(mode === "soll" ? 100000 : 0);
        expect(figures.kz66).toBe(19000);
      });

      it(`${kr}/${mode}: Umzug zum 1.1., Vorjahresposten zählen erst mit Zahlung im Folgejahr`, async () => {
        await reset(kr, mode);
        await run(
          [
            entry("alt-AR", "2025-12-10", invoicePosting(totals, kr, mode)),
            entry("alt-ER", "2025-12-11", documentPosting(totals, "edv", kr, "einzelunternehmen", "bank")),
          ],
          kr,
        );
        expect(income(await reports.euerForYear(2025))).toBe(0);
        expect((await vat.computeVatFigures({ year: 2025, month: 12 })).kz81).toBe(0);
        // Eigene Quellidentitäten statt Belegnummer, auch bei einer späteren Importdatei.
        const payments = [
          entry("alt-AR-teil", "2026-01-15", invoicePaymentPosting(totals, 59500, kr, mode), "alt-AR"),
          entry("alt-AR-rest", "2026-02-15", invoicePaymentPosting(totals, 59500, kr, mode), "alt-AR"),
          entry("alt-ER-zahlung", "2026-02-16", documentPaymentPosting(-119000, kr), "alt-ER"),
        ];
        await run(payments, kr);
        expect((await run(payments, kr)).duplicates).toBe(3);
        const euer = await reports.euerForYear(2026);
        expect(income(euer)).toBe(100000);
        expect(expense(euer)).toBe(100000);
        expect(euer.monthly.einnahmen.slice(0, 2)).toEqual([50000, 50000]);
        expect(euer.gewinn).toBe(0);
        const yearly = await annual.annualOverview(2026, "2027-03-01");
        expect(yearly.ust.figures.base19).toBe(mode === "ist" ? 100000 : 0);
        expect(yearly.ust.figures.vorsteuer).toBe(0);
        expect(await sql`select id from invoices union all select id from documents`).toHaveLength(0);
        expect(await sql`select id from journal_entries`).toHaveLength(5);
      });

      it(`${kr}/${mode}: Umzug mitten im Jahr, bereits extern abgegebener Monat bleibt versiegelt`, async () => {
        await reset(kr, mode);
        await run(
          [
            entry(
              "januar",
              "2026-01-15",
              invoicePosting(totals, kr, "soll").map((l) => (l.account === ACCOUNTS[kr].forderungen ? { ...l, account: ACCOUNTS[kr].bank } : l)),
            ),
          ],
          kr,
        );
        const january = { year: 2026, month: 1 };
        const draft = await vat.saveDraft(actor, january, { mode: "berechnet" });
        const filed = await vat.vermerkeAbgabe(
          actor,
          draft.id,
          {
            filedOn: "2026-02-10",
            transferTicket: "extern-pruefung-634",
            kz83: 19000,
            file: { filename: "extern.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF") },
          },
          "2026-02-10",
        );
        // Nachgelieferte Originalbuchung: Jahreswerte ändern sich, der Abgabestand nicht.
        await run(
          [
            entry(
              "januar-nachtrag",
              "2026-01-20",
              invoicePosting(totals, kr, "soll").map((l) => (l.account === ACCOUNTS[kr].forderungen ? { ...l, account: ACCOUNTS[kr].bank } : l)),
            ),
            entry(
              "juli",
              "2026-07-15",
              invoicePosting(totals, kr, "soll").map((l) => (l.account === ACCOUNTS[kr].forderungen ? { ...l, account: ACCOUNTS[kr].bank } : l)),
            ),
          ],
          kr,
        );
        expect((await annual.annualOverview(2026, "2027-03-01")).ust.figures.base19).toBe(300000);
        expect(income(await reports.euerForYear(2026))).toBe(300000);
        expect((await vat.returnsForPeriod(january))[0]).toMatchObject({ id: filed.id, status: "sent", kz81: 100000, kz83: 19000 });
        await expect(vat.saveDraft(actor, january, { mode: "berechnet" })).rejects.toThrow(/berichtigte/);
        await expect(sql`update vat_returns set kz81 = 200000 where id = ${filed.id}`).rejects.toThrow(/festgeschrieben/);
        const correction = await vat.createCorrection(actor, january);
        expect(correction.correctsId).toBe(filed.id);
      });
    }

  it("errät fehlende Zahlungsbezüge alter Pakete nicht und nennt sie im Abgleich", async () => {
    await reset("SKR03", "ist");
    await run([entry("ohne-Bezug", "2026-02-15", invoicePaymentPosting(totals, 119000, "SKR03", "ist"))], "SKR03");
    expect(income(await reports.euerForYear(2026))).toBe(0);
    expect((await reports.euerAbgleich(2026)).hinweise.join(" ")).toMatch(/Import.*Zahlungsbezug/);
  });

  it("weist fehlende, zirkuläre, überhöhte und kontenfremde Zahlungsbezüge ohne Teilübernahme ab", async () => {
    for (const [id, lines, target] of [
      ["fehlt", invoicePaymentPosting(totals, 119000, "SKR03", "ist"), "nicht-vorhanden"],
      ["selbst", invoicePaymentPosting(totals, 119000, "SKR03", "ist"), "selbst"],
      ["zu-viel", invoicePaymentPosting(totals, 119001, "SKR03", "ist"), "AR"],
      ["anderes-Konto", documentPaymentPosting(-119000, "SKR03"), "AR"],
      ["doppelter-Erloes", invoicePosting(totals, "SKR03", "ist"), "AR"],
    ] as const) {
      await reset("SKR03", "ist");
      await expect(
        run([entry("AR", "2026-01-15", invoicePosting(totals, "SKR03", "ist")), entry(id, "2026-02-15", [...lines], target)], "SKR03"),
      ).rejects.toThrow(/Zahlungsbezug ungültig/);
      expect(await sql`select id from journal_entries`).toHaveLength(0);
    }
  });

  it("erhält Cent-Reste über Jahreswechsel und Rückzahlung ohne zweite Erlösbuchung", async () => {
    await reset("SKR04", "ist");
    const tiny = totalsFromTaxes([{ rate: 1900, base: 5, tax: 1 }]);
    await run(
      [
        entry("klein", "2026-12-28", invoicePosting(tiny, "SKR04", "ist")),
        entry("z1", "2026-12-30", invoicePaymentPosting(tiny, 3, "SKR04", "ist"), "klein"),
        entry("z2", "2027-01-02", invoicePaymentPosting(tiny, 3, "SKR04", "ist"), "klein"),
        entry("rueck", "2027-01-02", invoicePaymentPosting(tiny, -6, "SKR04", "ist"), "klein"),
      ],
      "SKR04",
    );
    const first = await reports.euerForYear(2026);
    const next = await reports.euerForYear(2027);
    expect(income(first)).toBe(2);
    expect(income(next)).toBe(-2);
    expect(first.gewinn + next.gewinn).toBe(0);
    expect(await sql`select id from journal_entries`).toHaveLength(4);
  });

  it("prüft beim Kontenrahmenwechsel nur neu zugeordnete Posten derselben Quelle", async () => {
    await reset("SKR03", "ist");
    await run(
      [
        entry("AR-2025", "2025-01-15", invoicePosting(totals, "SKR03", "ist")),
        entry("zahlung-2025", "2025-02-15", invoicePaymentPosting(totals, 119000, "SKR03", "ist"), "AR-2025"),
      ],
      "SKR03",
    );
    await sql`update company set kontenrahmen='SKR04'`;
    await run(
      [
        entry("AR-2026", "2026-01-15", invoicePosting(totals, "SKR04", "ist")),
        entry("zahlung-2026", "2026-02-15", invoicePaymentPosting(totals, 119000, "SKR04", "ist"), "AR-2026"),
      ],
      "SKR04",
    );
    expect(income(await reports.euerForYear(2026))).toBe(100000);
    expect((await vat.computeVatFigures({ year: 2026, month: 2 })).kz81).toBe(100000);
  });

  it("pflegt Zahlungsbezüge alter Importe idempotent nach, ohne Originale oder Kassenbewegungen neu zu buchen", async () => {
    await reset("SKR03", "ist");
    await run(
      [
        entry("AR-alt", "2026-01-15", invoicePosting(totals, "SKR03", "ist")),
        entry("zahlung-alt", "2026-02-15", invoiceCashPaymentPosting(totals, 119000, "SKR03", "ist")),
      ],
      "SKR03",
    );
    const before = await sql`select id,payload_hash,payload from external_imports order by id`;
    const cashBefore = await sql`select id,amount,journal_entry_id from cash_entries`;
    expect(income(await reports.euerForYear(2026))).toBe(0);
    const patch = {
      version: 2 as const,
      source: "pruefung-634",
      kontenrahmen: "SKR03" as const,
      entries: [],
      settlements: [{ paymentExternalId: "zahlung-alt", originalExternalId: "AR-alt" }],
    };
    const apply = () => imports.runExternalImport(actor, patch, async () => new Uint8Array());
    expect(await apply()).toMatchObject({ created: 0, settlements: { created: 1, duplicates: 0 } });
    expect(await apply()).toMatchObject({ created: 0, settlements: { created: 0, duplicates: 1 } });
    expect(income(await reports.euerForYear(2026))).toBe(100000);
    expect(await sql`select id,payload_hash,payload from external_imports order by id`).toEqual(before);
    expect(await sql`select id from journal_entries`).toHaveLength(2);
    expect(cashBefore).toHaveLength(1);
    expect(await sql`select id,amount,journal_entry_id from cash_entries`).toEqual(cashBefore);
    expect(await sql`select id from external_import_settlements`).toHaveLength(1);
    const [stored] = await sql`select id from external_import_settlements`;
    expect(await sql`select actor from audit_log where table_name='external_import_settlements' and row_id=${stored!.id}`).toEqual([{ actor }]);
    await expect(sql`update external_import_settlements set original_import_id=payment_import_id`).rejects.toThrow(/nur ergänzt/);
    await expect(sql`delete from external_import_settlements`).rejects.toThrow(/nur ergänzt/);
    await expect(sql`truncate external_import_settlements`).rejects.toThrow(/TRUNCATE/);
    await expect(
      imports.runExternalImport(
        actor,
        {
          ...patch,
          entries: [entry("AR-andere", "2026-01-16", invoicePosting(totals, "SKR03", "ist"))],
          settlements: [{ paymentExternalId: "zahlung-alt", originalExternalId: "AR-andere" }],
        },
        async () => new Uint8Array(),
      ),
    ).rejects.toThrow(/bleibt unverändert/);
    await expect(imports.runExternalImport(actor, { ...patch, source: "andere-Quelle" }, async () => new Uint8Array())).rejects.toThrow(/Quellbuchung fehlt/);
    expect(await sql`select id from journal_entries`).toHaveLength(2);
    const chunks: Uint8Array[] = [];
    for await (const chunk of archive.exportYear(2026)) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const exported = JSON.parse(new TextDecoder().decode(files["importe/zahlungszuordnungen.json"]));
    expect(exported.settlements).toHaveLength(1);
    expect(exported.settlements[0]).toMatchObject({
      record: { id: stored!.id },
      source: "pruefung-634",
      externalId: "zahlung-alt",
      originalExternalId: "AR-alt",
    });
  });

  it("folgt beim Wechsel von Ist zu Soll dem Besteuerungsjahr der ursprünglichen importierten Rechnung", async () => {
    await reset("SKR03", "ist");
    await run([entry("AR-ist", "2025-12-15", invoicePosting(totals, "SKR03", "ist"))], "SKR03");
    await sql`update company set versteuerung='soll'`;
    await run([entry("zahlung-ist", "2026-02-15", invoicePaymentPosting(totals, 119000, "SKR03", "ist"), "AR-ist")], "SKR03");
    expect((await vat.computeVatFigures({ year: 2026, month: 2 })).kz81).toBe(100000);
    expect(income(await reports.euerForYear(2026))).toBe(100000);
  });
});
