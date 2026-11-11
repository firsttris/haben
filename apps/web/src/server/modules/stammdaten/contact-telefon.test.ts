import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Telefonnummer am Kontakt (Postgres, #322)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  const input = (telefon?: string) => ({
    kundennummer: "",
    name: "Nordwerk GmbH",
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    ...(telefon === undefined ? {} : { telefon }),
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("speichert die Nummer ohne doppelte Leerzeichen und hält den alten Stand in den Versionen", async () => {
    const created = await contacts.createContact(actor, input("  +49  941 123456-0 "));
    expect(created.telefon).toBe("+49 941 123456-0");
    const updated = await contacts.updateContact(actor, created.id, input("0170 1234567"));
    expect(updated.telefon).toBe("0170 1234567");
    const [version] = await sql`select data from contact_versions where contact_id = ${created.id} and version = 1`;
    expect(version!.data).toMatchObject({ telefon: "+49 941 123456-0" });
  });

  it("ohne Angabe bleibt das Feld leer, wie bei bestehenden Kontakten", async () => {
    expect((await contacts.createContact(actor, input())).telefon).toBe("");
  });

  it("lehnt eine Nummer mit Buchstaben ab", () => {
    const parsed = contacts.contactSchema.safeParse(input("Zentrale 0941"));
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe("Telefon: nur Ziffern, Leerzeichen und + ( ) / - .");
  });
});
