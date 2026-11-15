import { ACCOUNTS, invoicePosting, totalsFromTaxes, type Kontenrahmen, type Versteuerung } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Kz 48 aus dem Journal ohne Rechnung (Umzug aus einem anderen Programm): Die Voranmeldung meldet sie ab dem Stichjahr
// aus dem Journal, und die Jahreswerte enthalten auch extern angemeldete Monate (§ 18 Abs. 3 UStG). Ohne Befreiungsgrund
// kennt Haben die Nummer in § 4 UStG nicht; der Betrag darf nicht stillschweigend aus der Erklärung fallen.
describe.skipIf(!testDatabaseUrl)("Umsatzsteuererklärung: Kz 48 aus Buchungen ohne Rechnung (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("../datenimport/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let annual: typeof import("./index.ts");
  let database: typeof import("../../db/index.ts");
  const totals = totalsFromTaxes([{ rate: 0, base: 100_000, tax: 0 }]);
  const actor = "kz48-pruefung";

  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("../datenimport/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    annual = await import("./index.ts");
    database = await import("../../db/index.ts");
  }, 30_000);
  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });

  async function reset(kr: Kontenrahmen, mode: Versteuerung) {
    await leeren(sql)`truncate company, journal_entries, external_imports, lexoffice_imports, vat_returns, vat_frequencies, cash_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,steuernummer,bundesland,iban,versteuerung,kontenrahmen,journal_ab)
      values (1,'Erfundener Testbetrieb','Musterweg 1','93047','Regensburg','test@example.com','198/113/10010','BY','DE89370400440532013000',${mode},${kr},2026)`;
  }

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const mode of ["ist", "soll"] as const) {
      it(`${kr}/${mode}: importierte steuerfreie Erlöse ohne Rechnung sperren statt zu fehlen`, async () => {
        await reset(kr, mode);
        // Steuerfreie Erlöse direkt auf die Bank gebucht, wie aus dem Journal des bisherigen Programms
        const lines = invoicePosting(totals, kr, "soll", "steuerfrei").map(({ basis, ...l }) => ({
          ...l,
          ...(basis == null ? {} : { basis }),
          account: l.account === ACCOUNTS[kr].forderungen ? ACCOUNTS[kr].bank : l.account,
        }));
        await imports.runExternalImport(
          actor,
          {
            version: 2,
            source: "pruefung-kz48",
            kontenrahmen: kr,
            entries: [{ kind: "journal", externalId: "lehre-maerz", date: "2026-03-15", description: "Erfundener Prüffall Lehrhonorar", lines }],
          },
          async () => new Uint8Array(),
        );
        // Die Voranmeldung meldet den Betrag in Kz 48
        expect((await vat.computeVatFigures({ year: 2026, month: 3 })).kz48).toBe(100_000);

        const { ust } = await annual.annualOverview(2026, "2027-03-01");
        const zugeordnet = (ust.figures.kz48Zeile46 ?? 0) + (ust.figures.kz48Zeile47 ?? 0);
        const gesperrt = ust.kz48Gesperrt.reduce((s, e) => s + e.betrag, 0);
        // Jeder Cent aus Kz 48 der Voranmeldungen steht in Zeile 46/47 oder sperrt die Erklärung
        expect(zugeordnet + gesperrt).toBe(100_000);
        expect(ust.issues.some((i) => i.tone === "fehler" && /§ 4 UStG/.test(i.text) && /03\/2026/.test(i.text))).toBe(true);
      });
    }
});
