import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { weitereAngabenFeld } from "../../../components/ContactWeitereAngaben.tsx";
import { userClientError } from "../../errors.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Fehler des Servers zu Feldern in „Weitere Angaben“ (#1253): Das Formular klappt den Bereich dann auf */
describe.skipIf(!testDatabaseUrl)("Weitere Angaben am Kontakt: Fehler des Servers nennen das Feld", () => {
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

  /** Der Fehler, den der Browser bekommt, wenn der Server die Eingabe ablehnt */
  function serverFehler(aenderung: Record<string, unknown>): Error {
    const ergebnis = contacts.contactSchema.safeParse({ ...gueltig, ...aenderung });
    expect(ergebnis.success).toBe(false);
    return userClientError(ergebnis.error)!;
  }

  it("Skonto: Frist und Satz außerhalb der Grenzen", () => {
    for (const skonto of [[{ days: 121, percent: 200 }], [{ days: 0, percent: 200 }], [{ days: 10, percent: 10_000 }], [{ days: 10, percent: 0 }]]) {
      expect(weitereAngabenFeld(serverFehler({ skonto })), JSON.stringify(skonto)).toBe("skonto");
    }
  });

  it("Leitweg-ID über 46 Zeichen", () => {
    const fehler = serverFehler({ leitwegId: "9".repeat(47) });
    expect(fehler.message).toBe("Leitweg-ID: höchstens 46 Zeichen");
    expect(weitereAngabenFeld(fehler)).toBe("leitwegId");
  });

  it("Stundensatz über 100.000 €, den der Browser durchlässt, und negativer Stundensatz", () => {
    const zuHoch = serverFehler({ hourlyRateCents: 100_000_01 });
    expect(zuHoch.message).toBe("Stundensatz: höchstens 100.000 €");
    expect(weitereAngabenFeld(zuHoch)).toBe("hourlyRateCents");
    expect(weitereAngabenFeld(serverFehler({ hourlyRateCents: -1 }))).toBe("hourlyRateCents");
  });

  it("Debitor und Kreditor außerhalb des Bereichs", () => {
    expect(weitereAngabenFeld(serverFehler({ debitorNr: 5 }))).toBe("debitorNr");
    expect(weitereAngabenFeld(serverFehler({ kreditorNr: 5 }))).toBe("kreditorNr");
  });

  it("eine vergebene Nummer nennt das Feld, auch wenn der andere Kontakt wie ein Stichwort heißt", async () => {
    await leeren(sql)`truncate contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
    await contacts.createContact("test-user", { ...gueltig, name: "Debitor Müller GmbH", kreditorNr: 70087 });
    const doppelt = await contacts
      .createContact("test-user", { ...gueltig, name: "Zweiter" })
      .then(() => contacts.createContact("test-user", { ...gueltig, name: "Dritter", kreditorNr: 70087 }))
      .catch((error: unknown) => error);
    expect((doppelt as Error).message).toContain("Kreditor 70087 hat schon „Debitor Müller GmbH“");
    expect(weitereAngabenFeld(userClientError(doppelt)!)).toBe("kreditorNr");
    // Eine Nummer außerhalb des Bereichs, die erst der Server prüft (clean), nennt ebenfalls das Feld
    const ausserhalb = await contacts.createContact("test-user", { ...gueltig, name: "Vierter", debitorNr: 5 }).catch((error: unknown) => error);
    expect(weitereAngabenFeld(userClientError(ausserhalb)!)).toBe("debitorNr");
  });
});
