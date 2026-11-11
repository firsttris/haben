import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abrechenbare Leistungen (#417), erster Teil: Zeiteinträge je Kunde erfassen, ändern, löschen und von außen (etwa
 * Kimai) mit einer Kennung idempotent anlegen. Der Stundensatz steht als Kopie am Eintrag, die Vorgabe kommt vom
 * Kunden. Jede Änderung steht im Audit-Log. Alle Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Leistungseinträge (Postgres, #417)", () => {
  let sql: postgres.Sql;
  let entries: typeof import("./service-entries.ts");
  const actor = "test-user";
  let contactId: string;
  let otherContactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    entries = await import("./service-entries.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate service_entries, invoices, quotes, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
    [{ id: contactId }, { id: otherContactId }] = (await sql`
      insert into contacts (name, hourly_rate_cents) values ('Nordwerk Software GmbH', 9500), ('Rheinpixel GmbH', null) returning id`) as unknown as [
      { id: string },
      { id: string },
    ];
  });

  const eintrag = (overrides: Record<string, unknown> = {}) => ({
    contactId,
    workedOn: "2026-03-02",
    minutes: 90,
    description: "Konzept Datenmodell",
    ...overrides,
  });

  it("legt einen Eintrag an und nimmt den Stundensatz des Kunden als Kopie", async () => {
    const id = await entries.createServiceEntry(actor, eintrag());
    const [row] = await entries.listServiceEntries({ contactId });
    expect(row).toMatchObject({ id, contactId, workedOn: "2026-03-02", minutes: 90, description: "Konzept Datenmodell", hourlyRateCents: 9500 });

    // Ändert sich der Satz am Kunden, bleibt der Eintrag bei seinem Satz
    await sql`update contacts set hourly_rate_cents = 12000 where id = ${contactId}`;
    expect((await entries.listServiceEntries({ contactId }))[0]!.hourlyRateCents).toBe(9500);
  });

  it("ein eigener Satz am Eintrag geht vor; ohne Satz am Kunden bleibt er leer", async () => {
    await entries.createServiceEntry(actor, eintrag({ hourlyRateCents: 8000 }));
    await entries.createServiceEntry(actor, eintrag({ contactId: otherContactId }));
    const rows = await entries.listServiceEntries({});
    expect(rows.map((r) => [r.contactId, r.hourlyRateCents]).sort()).toEqual(
      [
        [contactId, 8000],
        [otherContactId, null],
      ].sort(),
    );
  });

  it("prüft die Eingabe: Dauer, Datum, Kunde, Satz", async () => {
    await expect(entries.createServiceEntry(actor, eintrag({ minutes: 0 }))).rejects.toThrow();
    await expect(entries.createServiceEntry(actor, eintrag({ minutes: 24 * 60 + 1 }))).rejects.toThrow();
    await expect(entries.createServiceEntry(actor, eintrag({ minutes: 1.5 }))).rejects.toThrow();
    await expect(entries.createServiceEntry(actor, eintrag({ workedOn: "02.03.2026" }))).rejects.toThrow();
    await expect(entries.createServiceEntry(actor, eintrag({ workedOn: "2026-02-30" }))).rejects.toThrow();
    await expect(entries.createServiceEntry(actor, eintrag({ hourlyRateCents: -1 }))).rejects.toThrow();
    // Grenzen der Datenbank gehören in die Eingabeprüfung, nicht als roher Fehler zum Nutzer
    await expect(entries.createServiceEntry(actor, eintrag({ hourlyRateCents: 3_000_000_000 }))).rejects.toThrow(/Stundensatz/);
    await expect(entries.createServiceEntry(actor, eintrag({ workedOn: "0000-01-01" }))).rejects.toThrow(/Datum/);
    await expect(entries.createServiceEntry(actor, eintrag({ contactId: "00000000-0000-4000-8000-000000000000" }))).rejects.toThrow("Kunde nicht gefunden.");
    expect(await entries.listServiceEntries({})).toHaveLength(0);
  });

  it("ändert und löscht einen Eintrag; jeder Schritt steht im Audit-Log", async () => {
    const id = await entries.createServiceEntry(actor, eintrag());
    await entries.updateServiceEntry(actor, id, eintrag({ minutes: 120, description: "Konzept und Review", hourlyRateCents: 9000 }));
    expect((await entries.listServiceEntries({}))[0]).toMatchObject({ minutes: 120, description: "Konzept und Review", hourlyRateCents: 9000 });
    await entries.deleteServiceEntry(actor, id);
    expect(await entries.listServiceEntries({})).toHaveLength(0);
    await expect(entries.updateServiceEntry(actor, id, eintrag())).rejects.toThrow("Eintrag nicht gefunden.");
    await expect(entries.deleteServiceEntry(actor, id)).rejects.toThrow("Eintrag nicht gefunden.");

    const audit = await sql`select action, actor from audit_log where table_name = 'service_entries' and row_id = ${id} order by id`;
    expect(audit.map((a) => a.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);
    expect(audit.every((a) => a.actor === actor)).toBe(true);
  });

  it("filtert nach Kunde und Zeitraum; neueste Arbeitstage zuerst", async () => {
    await entries.createServiceEntry(actor, eintrag({ workedOn: "2026-03-02" }));
    await entries.createServiceEntry(actor, eintrag({ workedOn: "2026-03-31" }));
    await entries.createServiceEntry(actor, eintrag({ workedOn: "2026-04-01" }));
    await entries.createServiceEntry(actor, eintrag({ contactId: otherContactId, workedOn: "2026-03-15" }));
    const maerz = await entries.listServiceEntries({ contactId, from: "2026-03-01", to: "2026-03-31" });
    expect(maerz.map((r) => r.workedOn)).toEqual(["2026-03-31", "2026-03-02"]);
    expect(await entries.listServiceEntries({ from: "2026-03-10", to: "2026-03-20" })).toHaveLength(1);
  });

  describe("von außen angelegt (Kennung)", () => {
    const extern = (overrides: Record<string, unknown> = {}) =>
      eintrag({ source: "kimai", externalId: "4711", ...overrides }) as unknown as import("./service-entries.ts").ExternalServiceEntryInput;

    it("legt beim ersten Mal an und aktualisiert beim zweiten, ohne zu verdoppeln", async () => {
      const first = await entries.upsertExternalServiceEntry(actor, extern());
      const second = await entries.upsertExternalServiceEntry(actor, extern({ minutes: 100, description: "Konzept, nachgetragen" }));
      expect(first.created).toBe(true);
      expect(second).toEqual({ id: first.id, created: false });
      const rows = await entries.listServiceEntries({});
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: "kimai", externalId: "4711", minutes: 100, description: "Konzept, nachgetragen" });
    });

    it("gleiche Kennung aus einer anderen Quelle ist ein anderer Eintrag", async () => {
      await entries.upsertExternalServiceEntry(actor, extern());
      await entries.upsertExternalServiceEntry(actor, extern({ source: "toggl" }));
      expect(await entries.listServiceEntries({})).toHaveLength(2);
    });

    it("Quelle und Kennung gehören zusammen", async () => {
      await expect(entries.upsertExternalServiceEntry(actor, eintrag({ source: "kimai" }) as never)).rejects.toThrow();
      await expect(entries.upsertExternalServiceEntry(actor, eintrag({ externalId: "4711" }) as never)).rejects.toThrow();
    });

    it("zwei gleichzeitige Aufrufe mit derselben Kennung ergeben einen Eintrag", async () => {
      await Promise.all([entries.upsertExternalServiceEntry(actor, extern()), entries.upsertExternalServiceEntry(actor, extern())]);
      expect(await entries.listServiceEntries({})).toHaveLength(1);
    });
  });
});
