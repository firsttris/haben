import type { SevContact } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

function contact(id: string, name: string, category: string | null): SevContact {
  return { id, name, category: category === null ? null : { id: category }, customerNumber: `SD-${id}` };
}

describe.skipIf(!testDatabaseUrl)("sevDesk-Kontaktrollen (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let contacts: SevContact[] = [];
  const actor = "sevdesk-rollen-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    const { SevdeskClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith("/Tools/bookkeepingSystemVersion")
        ? { objects: { version: "2.0" } }
        : { objects: url.pathname.endsWith("/Contact") && url.searchParams.get("offset") === "0" ? contacts : [] };
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory((options) => new SevdeskClient({ ...options, fetch: fetchFn, minIntervalMs: 0 }));
    await sevdesk.saveSevdeskKey(actor, TOKEN);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function runImport() {
    await sevdesk.startSevdeskImport(actor, { wait: true });
    expect(await sevdesk.latestSevdeskImport()).toMatchObject({ status: "fertig" });
  }

  it("legt Lieferanten und Kunden getrennt an; unklare Kategorien erhalten nur die Kunden-Ausgangsrolle samt Nummer", async () => {
    contacts = [
      contact("1", "Neuer Lieferant", "2"),
      contact("2", "Neuer Kunde", "3"),
      contact("3", "Neuer Partner", "4"),
      contact("4", "Neuer Interessent", "28"),
      contact("5", "Ohne Kategorie", null),
      contact("6", "Unbekannte Kategorie", "999"),
    ];
    await runImport();
    const rows = await sql`select sevdesk_id, is_customer, is_supplier, kundennummer, lieferantennummer from contacts order by sevdesk_id`;
    expect(rows.map((row) => [row.sevdesk_id, row.is_customer, row.is_supplier, row.kundennummer, row.lieferantennummer])).toEqual([
      ["1", false, true, null, null],
      ["2", true, false, "SD-2", null],
      ["3", true, false, "SD-3", null],
      ["4", true, false, "SD-4", null],
      ["5", true, false, "SD-5", null],
      ["6", true, false, "SD-6", null],
    ]);
  });

  it("ergänzt beim Verknüpfen die eindeutige Rolle und behält manuelle Rollen und Nummern", async () => {
    await sql`insert into contacts (name, is_customer, is_supplier, kundennummer, lieferantennummer) values
      ('Vorhandener Kunde', true, false, 'H-10', 'BEIM-10'),
      ('Vorhandener Lieferant', false, true, null, 'BEIM-11'),
      ('Vorhandener Partner', false, true, null, 'BEIM-12')`;
    contacts = [contact("10", "vorhandener kunde", "2"), contact("11", "Vorhandener Lieferant", "3"), contact("12", "Vorhandener Partner", "4")];
    await runImport();
    expect((await sevdesk.latestSevdeskImport())!.progress).toMatchObject({ contacts: 0, contactsLinked: 3 });
    const rows =
      await sql`select sevdesk_id, is_customer, is_supplier, kundennummer, lieferantennummer from contacts where sevdesk_id in ('10', '11', '12') order by sevdesk_id`;
    expect(rows.map((row) => [row.sevdesk_id, row.is_customer, row.is_supplier, row.kundennummer, row.lieferantennummer])).toEqual([
      ["10", true, true, "H-10", "BEIM-10"],
      ["11", true, true, null, "BEIM-11"],
      ["12", false, true, null, "BEIM-12"],
    ]);
  });

  it("ergänzt beim erneuten Abruf fehlende Rollen alter Importe ohne Nummern oder zweite Rollen zu löschen und bleibt danach unverändert", async () => {
    await sql`insert into contacts (name, sevdesk_id, is_customer, is_supplier, kundennummer, lieferantennummer) values
      ('Alter Lieferantenimport', '20', true, false, 'ALT-20', 'BEIM-20'),
      ('Manuell beide Rollen', '21', true, true, 'H-21', 'BEIM-21'),
      ('Bisher nur Lieferant', '22', false, true, null, 'BEIM-22'),
      ('Unklarer Bestandskontakt', '23', false, true, null, 'BEIM-23')`;
    contacts = [
      contact("20", "Alter Lieferantenimport", "2"),
      contact("21", "Manuell beide Rollen", "2"),
      contact("22", "Bisher nur Lieferant", "3"),
      contact("23", "Unklarer Bestandskontakt", null),
    ];
    await runImport();
    const rows =
      await sql`select sevdesk_id, is_customer, is_supplier, kundennummer, lieferantennummer, version from contacts where sevdesk_id in ('20', '21', '22', '23') order by sevdesk_id`;
    expect(rows.map((row) => [row.sevdesk_id, row.is_customer, row.is_supplier, row.kundennummer, row.lieferantennummer])).toEqual([
      ["20", true, true, "ALT-20", "BEIM-20"],
      ["21", true, true, "H-21", "BEIM-21"],
      ["22", true, true, null, "BEIM-22"],
      ["23", false, true, null, "BEIM-23"],
    ]);
    expect(rows.map((row) => row.version)).toEqual([2, 1, 2, 1]);
    const changes = await sql`select actor from audit_log where table_name = 'contacts' and action = 'UPDATE' and new_value->>'sevdesk_id' in ('20', '22')`;
    expect(changes).toHaveLength(2);
    expect(changes.every((row) => row.actor === actor)).toBe(true);
    await runImport();
    expect((await sevdesk.latestSevdeskImport())!.progress).toMatchObject({ contacts: 0, contactsLinked: 0 });
    expect(
      await sql`select sevdesk_id, is_customer, is_supplier, kundennummer, lieferantennummer, version from contacts where sevdesk_id in ('20', '21', '22', '23') order by sevdesk_id`,
    ).toEqual(rows);
  });
});
