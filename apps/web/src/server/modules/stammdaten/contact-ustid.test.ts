import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

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
    await leeren(sql)`truncate contact_versions, contacts, company cascade`;
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

  it("nennt aktive Kontakte vor archivierten, auch wenn der archivierte alphabetisch zuerst steht", async () => {
    const alt = await contacts.createContact(actor, input("AAA Altfirma", "DE123456789"));
    await contacts.setContactArchived(actor, alt.id, true);
    const neu = await contacts.createContact(actor, input("ZZZ Neufirma", "DE123456789"));
    const found = await contacts.findContactsByUstId("DE123456789");
    expect(found.map((c) => [c.name, c.archived])).toEqual([
      ["ZZZ Neufirma", false],
      ["AAA Altfirma", true],
    ]);
    expect(found[0]!.id).toBe(neu.id);
  });

  it("nennt den Kontakt mit der gewünschten Rolle zuerst, auch wenn mehr als fünf Kontakte die USt-IdNr. tragen", async () => {
    // Sechs Kunden (Niederlassungen), alphabetisch vor dem Lieferanten, den man im Dialog „Neuer Lieferant“ wählen könnte
    for (const name of ["A Filiale", "B Filiale", "C Filiale", "D Filiale", "E Filiale", "F Filiale"]) {
      await contacts.createContact(actor, input(name, "DE123456789"));
    }
    const zentrale = await contacts.createContact(actor, input("Z Zentrale", "DE123456789", { isCustomer: true, isSupplier: true }));
    const found = await contacts.findContactsByUstId("DE123456789", undefined, { isSupplier: true });
    expect(found).toHaveLength(5);
    expect(found[0]!.id).toBe(zentrale.id);
    // Ohne gewünschte Rolle bleibt es bei Name und aktiv vor archiviert
    expect((await contacts.findContactsByUstId("DE123456789")).map((c) => c.name)).toEqual(["A Filiale", "B Filiale", "C Filiale", "D Filiale", "E Filiale"]);
  });

  it("findet bei leerer USt-IdNr. nichts, auch nicht die Kontakte ohne", async () => {
    await contacts.createContact(actor, input("Ohne USt", ""));
    expect(await contacts.findContactsByUstId("")).toEqual([]);
    expect(await contacts.findContactsByUstId("  ")).toEqual([]);
  });

  it("liefert für die Auswahl bei Lieferanten nur Lieferanten mit Lieferantennummer, bei Kunden alle mit Kundennummer", async () => {
    await contacts.createContact(actor, { ...input("Kundenfirma", ""), kundennummer: "K-1" });
    await contacts.createContact(actor, { ...input("Lieferfirma", "DE999999999", { isCustomer: false, isSupplier: true }), lieferantennummer: "L-9" });
    expect((await contacts.listContactChoices("lieferant")).map((c) => [c.name, c.nummer])).toEqual([["Lieferfirma", "L-9"]]);
    // Wie bisher alle Kontakte: ein gewählter Nicht-Kunde bleibt im Feld sichtbar; die Combobox filtert nach der Rolle
    expect((await contacts.listContactChoices("kunde")).map((c) => [c.name, c.nummer, c.isCustomer])).toEqual([
      ["Kundenfirma", "K-1", true],
      ["Lieferfirma", null, false],
    ]);
  });
});
