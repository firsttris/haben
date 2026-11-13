import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Ansprechpartner am Kontakt (#424): mehrere je Kontakt mit Name, E-Mail, Telefon und Funktion. Änderbar, aber nie
 * löschbar (Trigger), deaktivieren statt löschen; jede Änderung steht im Audit-Log. Wählbar am Entwurf sind nur aktive
 * Personen des eigenen Kunden, die schon gewählte bleibt auch deaktiviert erhalten. Alle Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Ansprechpartner am Kontakt (Postgres, #424)", () => {
  let sql: postgres.Sql;
  let persons: typeof import("./contact-persons.ts");
  const actor = "test-user";
  let contactId: string;
  let otherContactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    persons = await import("./contact-persons.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate invoices, quotes, contact_persons, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
    [{ id: contactId }, { id: otherContactId }] =
      (await sql`insert into contacts (name) values ('Nordwerk Software GmbH'), ('Rheinpixel GmbH') returning id`) as unknown as [
        { id: string },
        { id: string },
      ];
  });

  const person = (overrides: Record<string, unknown> = {}) => ({
    name: "Mara Beispiel",
    email: "mara@nordwerk.example",
    telefon: "+49 40 1234567",
    funktion: "Einkauf",
    ...overrides,
  });

  it("legt Personen an, ändert und deaktiviert sie; die aktiven stehen zuerst, jeder Schritt steht im Audit-Log", async () => {
    const mara = await persons.createContactPerson(actor, contactId, person());
    const jonas = await persons.createContactPerson(actor, contactId, person({ name: "Jonas Muster", email: "", telefon: "", funktion: "" }));
    expect((await persons.listContactPersons(contactId)).map((p) => p.name)).toEqual(["Jonas Muster", "Mara Beispiel"]);

    await persons.updateContactPerson(actor, mara, person({ name: "Mara Beispielmann" }));
    await persons.setContactPersonActive(actor, jonas, false);
    const liste = await persons.listContactPersons(contactId);
    expect(liste.map((p) => [p.name, p.deactivatedAt !== null])).toEqual([
      ["Mara Beispielmann", false],
      ["Jonas Muster", true],
    ]);
    await persons.setContactPersonActive(actor, jonas, true);
    expect((await persons.listContactPersons(contactId)).every((p) => p.deactivatedAt === null)).toBe(true);

    const audit = await sql`select action, actor from audit_log where table_name = 'contact_persons' order by id`;
    expect(audit.map((a) => a.action)).toEqual(["INSERT", "INSERT", "UPDATE", "UPDATE", "UPDATE"]);
    expect(new Set(audit.map((a) => a.actor))).toEqual(new Set([actor]));
    expect(await persons.listContactPersons(otherContactId)).toEqual([]);
  });

  it("prüft die Eingabe: Name Pflicht, E-Mail eine Adresse, Kontakt muss es geben", async () => {
    await expect(persons.createContactPerson(actor, contactId, person({ name: "   " }))).rejects.toThrow(/Name fehlt/);
    await expect(persons.createContactPerson(actor, contactId, person({ email: "keine-adresse" }))).rejects.toThrow(/E-Mail-Adresse ungültig/);
    await expect(persons.createContactPerson(actor, contactId, person({ email: "a@b.example, c@d.example" }))).rejects.toThrow(/E-Mail-Adresse ungültig/);
    await expect(persons.createContactPerson(actor, "00000000-0000-4000-8000-000000000000", person())).rejects.toThrow(/Kontakt nicht gefunden/);
    await expect(persons.updateContactPerson(actor, "00000000-0000-4000-8000-000000000000", person())).rejects.toThrow(/nicht gefunden/);
    expect(await persons.listContactPersons(contactId)).toEqual([]);
  });

  it("löscht nie, auch nicht an der Anwendung vorbei: DELETE und TRUNCATE lehnt die Datenbank ab", async () => {
    const id = await persons.createContactPerson(actor, contactId, person());
    await expect(sql`delete from contact_persons where id = ${id}`).rejects.toThrow(/nur ergänzt|darf nicht/);
    // Auf die Tabelle zeigen Fremdschlüssel (Rechnungen, Angebote): ohne CASCADE lehnt Postgres schon vor den Triggern ab
    await expect(sql`truncate contact_persons cascade`).rejects.toThrow(/darf nicht geleert werden/);
    expect(await persons.listContactPersons(contactId)).toHaveLength(1);
  });

  it("contactPersonProblem: nur Personen des eigenen Kunden, nur aktive, die gewählte bleibt", async () => {
    const aktiv = await persons.createContactPerson(actor, contactId, person());
    const weg = await persons.createContactPerson(actor, contactId, person({ name: "Ehemals Beispiel" }));
    await persons.setContactPersonActive(actor, weg, false);
    const fremd = await persons.createContactPerson(actor, otherContactId, person({ name: "Fremde Person" }));

    expect(await persons.contactPersonProblem(sql as never, contactId, null)).toBeNull();
    await expectProblem(contactId, aktiv, null, null);
    await expectProblem(contactId, weg, null, "Der Ansprechpartner ist deaktiviert.");
    // schon am Entwurf gewählt: bleibt, auch deaktiviert
    await expectProblem(contactId, weg, weg, null);
    await expectProblem(contactId, fremd, null, "Der Ansprechpartner gehört zu einem anderen Kunden.");
    await expectProblem(null, aktiv, null, "Ansprechpartner brauchen einen Kunden.");
    await expectProblem(contactId, "00000000-0000-4000-8000-000000000000", null, "Ansprechpartner nicht gefunden.");
  });

  async function expectProblem(contact: string | null, personId: string, current: string | null, expected: string | null) {
    const db = (await import("../../db/index.ts")).db;
    expect(await persons.contactPersonProblem(db, contact, personId, current)).toBe(expected);
  }

  it("ansprechpartnerSnapshot: Name und die Angaben, die es gibt", async () => {
    const db = (await import("../../db/index.ts")).db;
    const voll = await persons.createContactPerson(actor, contactId, person());
    const knapp = await persons.createContactPerson(actor, contactId, person({ name: "Jonas Muster", email: "", telefon: "", funktion: "" }));
    expect(await persons.ansprechpartnerSnapshot(db, voll)).toEqual({
      name: "Mara Beispiel",
      email: "mara@nordwerk.example",
      telefon: "+49 40 1234567",
      funktion: "Einkauf",
    });
    expect(await persons.ansprechpartnerSnapshot(db, knapp)).toEqual({ name: "Jonas Muster" });
    expect(await persons.ansprechpartnerSnapshot(db, null)).toBeUndefined();
  });
});
