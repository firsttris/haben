import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kontakte mit gleicher USt-IdNr. finden (Postgres)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  const input = (name: string, ustId: string, roles: { isCustomer?: boolean; isSupplier?: boolean } = {}) => ({
    kundennummer: "",
    name,
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId,
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    ...roles,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("findet den Kontakt gleich welcher Rolle, mit Rollen und ohne Rücksicht auf Leerzeichen und Schreibweise", async () => {
    const kunde = await contacts.createContact(actor, input("Kundenfirma", "DE123456789"));
    await contacts.createContact(actor, input("Lieferfirma", "DE999999999", { isCustomer: false, isSupplier: true }));
    expect(await contacts.findContactsByUstId("de 123 456 789")).toEqual([
      { id: kunde.id, name: "Kundenfirma", ustId: "DE123456789", isCustomer: true, isSupplier: false, archived: false },
    ]);
    expect((await contacts.findContactsByUstId("DE999999999")).map((c) => c.name)).toEqual(["Lieferfirma"]);
  });

  it("nimmt den Kontakt aus, den das Formular gerade ändert", async () => {
    const kunde = await contacts.createContact(actor, input("Kundenfirma", "DE123456789"));
    expect(await contacts.findContactsByUstId("DE123456789", kunde.id)).toEqual([]);
    const zweiter = await contacts.createContact(actor, input("Zweite Firma", "DE123456789"));
    expect((await contacts.findContactsByUstId("DE123456789", kunde.id)).map((c) => c.id)).toEqual([zweiter.id]);
  });

  it("nennt auch archivierte Kontakte, als solche gekennzeichnet", async () => {
    const kunde = await contacts.createContact(actor, input("Alte Firma", "DE123456789"));
    await contacts.setContactArchived(actor, kunde.id, true);
    expect(await contacts.findContactsByUstId("DE123456789")).toMatchObject([{ name: "Alte Firma", archived: true }]);
  });

  it("findet bei leerer USt-IdNr. nichts, auch nicht die Kontakte ohne", async () => {
    await contacts.createContact(actor, input("Ohne USt", ""));
    expect(await contacts.findContactsByUstId("")).toEqual([]);
    expect(await contacts.findContactsByUstId("  ")).toEqual([]);
  });
});
