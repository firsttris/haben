import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Vergabe fehlender DATEV-Personenkonten (Postgres, #327)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  let vergabe: typeof import("./personenkonten-vergabe.ts");
  const actor = "test-user";
  const input = (name: string, extra: Record<string, unknown> = {}) => ({
    kundennummer: "",
    name,
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    ...extra,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
    vergabe = await import("./personenkonten-vergabe.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate datev_personenkonten, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("vergibt nur fehlende Nummern, je Rolle im eigenen Bereich, und lässt vorhandene stehen", async () => {
    const neu = await contacts.createContact(actor, input("Neu GmbH", { isSupplier: true }));
    const mit = await contacts.createContact(actor, input("Mit GmbH", { debitorNr: 10042 }));
    const result = await vergabe.vergibPersonenkonten(actor, [
      { contactId: neu.id, rolle: "debitor" },
      { contactId: neu.id, rolle: "kreditor" },
      { contactId: mit.id, rolle: "debitor" },
    ]);
    expect(Object.fromEntries(result)).toEqual({ [`${neu.id}:debitor`]: 10043, [`${neu.id}:kreditor`]: 70000, [`${mit.id}:debitor`]: 10042 });
    expect(await sql`select name, debitor_nr, kreditor_nr from contacts order by name`).toEqual([
      { name: "Mit GmbH", debitor_nr: 10042, kreditor_nr: null },
      { name: "Neu GmbH", debitor_nr: 10043, kreditor_nr: 70000 },
    ]);
    // Steht im Änderungsprotokoll und in den Versionen wie eine Änderung von Hand, je vergebene Nummer eine Version
    expect(await sql`select count(*)::int as n from contact_versions where contact_id = ${neu.id}`).toEqual([{ n: 3 }]);
    expect(await sql`select count(*)::int as n from audit_log where table_name = 'contacts' and actor = ${actor}`).toEqual([{ n: 4 }]);
  });

  it("verwendet keine Nummer wieder, die einmal an einem Kontakt stand", async () => {
    const alt = await contacts.createContact(actor, input("Alt GmbH", { debitorNr: 10005 }));
    await contacts.updateContact(actor, alt.id, input("Alt GmbH", { debitorNr: null }));
    const neu = await contacts.createContact(actor, input("Neu GmbH"));
    const result = await vergabe.vergibPersonenkonten(actor, [{ contactId: neu.id, rolle: "debitor" }]);
    expect(result.get(`${neu.id}:debitor`)).toBe(10006);
  });

  it("vergibt bei gleichzeitigen Vorgängen verschiedene Nummern", async () => {
    const a = await contacts.createContact(actor, input("A GmbH"));
    const b = await contacts.createContact(actor, input("B GmbH"));
    const c = await contacts.createContact(actor, input("C GmbH"));
    const results = await Promise.all([
      vergabe.vergibPersonenkonten(actor, [{ contactId: a.id, rolle: "debitor" }]),
      vergabe.vergibPersonenkonten(actor, [{ contactId: b.id, rolle: "debitor" }]),
      vergabe.vergibPersonenkonten(actor, [
        { contactId: c.id, rolle: "debitor" },
        { contactId: a.id, rolle: "debitor" },
      ]),
    ]);
    const nummern = await sql`select name, debitor_nr from contacts order by name`;
    expect(new Set(nummern.map((r) => r.debitor_nr))).toEqual(new Set([10000, 10001, 10002]));
    // A bekommt genau eine Nummer, auch wenn zwei Vorgänge sie gleichzeitig brauchen
    expect(results[0]!.get(`${a.id}:debitor`)).toBe(results[2]!.get(`${a.id}:debitor`));
  });

  it("meldet einen vollen Bereich, statt eine Nummer außerhalb zu vergeben", async () => {
    // Alle Kreditornummern standen schon einmal an einem Kontakt (Versionen), das zählt wie vergeben. Über die Versionen
    // statt 30 000 Kontakte, damit der Test ohne Trigger je Zeile auch in der CI schnell bleibt
    const frueher = await contacts.createContact(actor, input("Früherer Lieferant", { isCustomer: false, isSupplier: true }));
    await sql`insert into contact_versions (contact_id, version, data)
      select ${frueher.id}, n - 69998, jsonb_build_object('kreditor_nr', n) from generate_series(70000, 99999) n`;
    const neu = await contacts.createContact(actor, input("Neu GmbH", { isSupplier: true }));
    await expect(vergabe.vergibPersonenkonten(actor, [{ contactId: neu.id, rolle: "kreditor" }])).rejects.toThrow(
      "Keine freie Kreditornummer mehr (70000 bis 99999).",
    );
  });
});
