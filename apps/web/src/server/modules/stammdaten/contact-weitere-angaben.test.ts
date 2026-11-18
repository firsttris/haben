import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { betrifftWeitereAngaben } from "../../../components/ContactWeitereAngaben.tsx";
import { userMessage } from "../../errors.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Meldungen des Servers zu Feldern in „Weitere Angaben“ (#1253): Das Formular klappt den Bereich dann auf */
describe.skipIf(!testDatabaseUrl)("Weitere Angaben am Kontakt: Meldungen des Servers nennen das Feld", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  const gueltig = {
    kundennummer: "",
    name: "Muster",
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    isCustomer: true,
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Die Meldung, die der Browser sieht, wenn der Server die Eingabe ablehnt */
  function serverMeldung(aenderung: Record<string, unknown>): string {
    const ergebnis = contacts.contactSchema.safeParse({ ...gueltig, ...aenderung });
    expect(ergebnis.success).toBe(false);
    return userMessage(ergebnis.error)!;
  }

  it("Skonto: Frist und Satz außerhalb der Grenzen", () => {
    for (const skonto of [[{ days: 121, percent: 200 }], [{ days: 0, percent: 200 }], [{ days: 10, percent: 10_000 }], [{ days: 10, percent: 0 }]]) {
      const meldung = serverMeldung({ skonto });
      expect(betrifftWeitereAngaben(meldung), meldung).toBe(true);
    }
  });

  it("Leitweg-ID über 46 Zeichen", () => {
    const meldung = serverMeldung({ leitwegId: "9".repeat(47) });
    expect(meldung).toBe("Leitweg-ID: höchstens 46 Zeichen");
    expect(betrifftWeitereAngaben(meldung)).toBe(true);
  });

  it("Stundensatz über 100.000 €, den der Browser durchlässt", () => {
    const meldung = serverMeldung({ hourlyRateCents: 100_000_01 });
    expect(meldung).toBe("Stundensatz: höchstens 100.000 €");
    expect(betrifftWeitereAngaben(meldung)).toBe(true);
  });

  it("negativer Stundensatz, Debitor und Kreditor außerhalb des Bereichs", () => {
    for (const aenderung of [{ hourlyRateCents: -1 }, { debitorNr: 5 }, { kreditorNr: 5 }]) {
      const meldung = serverMeldung(aenderung);
      expect(betrifftWeitereAngaben(meldung), meldung).toBe(true);
    }
  });
});
