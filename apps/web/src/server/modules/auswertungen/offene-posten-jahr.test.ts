import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { JahresPosten, OpenPosition } from "./reports.ts";

function posten(over: Partial<OpenPosition> = {}): OpenPosition {
  return {
    id: crypto.randomUUID(),
    number: "2026-0001",
    party: "Bürowelt Nord GmbH",
    date: "2026-03-05",
    dueDate: "2026-03-19",
    gross: 11_900,
    open: 11_900,
    daysOverdue: 0,
    ...over,
  };
}

function jahresPosten(over: Partial<JahresPosten> = {}): JahresPosten {
  return {
    jahr: 2026,
    forderungen: [],
    verbindlichkeiten: [],
    forderungenOffen: 0,
    verbindlichkeitenOffen: 0,
    altlasten: [],
    ueberfaellig: 0,
    ...over,
  };
}

/**
 * Die Abschlusskontrolle des Jahres (#1110): Was ist im Jahr offen geblieben, und was reicht aus früheren Jahren
 * herein. Ohne den zweiten Teil sieht der Abschluss sauber aus, obwohl ein Vorjahresbeleg noch offen steht.
 */
describe.skipIf(!testDatabaseUrl)("offene Posten nach Jahr (Postgres)", () => {
  let sql: postgres.Sql;
  let documents: typeof import("../belege/documents.ts");
  let reports: typeof import("./reports.ts");
  const actor = "test-user";
  let dateien = 0;

  /** Ein gebuchter Beleg, über die Bank zu zahlen; das Belegdatum bestimmt das Jahr des offenen Postens */
  async function beleg(documentDate: string, supplier: string) {
    // Je Beleg eigene Bytes: derselbe Hash gälte als dieselbe Datei und käme als gebuchter Beleg zurück
    dateien += 1;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, dateien]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `${supplier}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: supplier,
      supplierUstId: "",
      invoiceNumber: `RE-${documentDate}`,
      documentDate,
      dueDate: documentDate,
      category: "buero",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 100, tax: 19 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    reports = await import("./reports.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
  });

  it("bleibt der Hinweis leer, solange im Jahr und davor nichts offen ist", () => {
    expect(reports.jahresPostenHinweis(jahresPosten())).toEqual([]);
  });

  it("nennt die offenen Posten des Jahres, getrennt nach Forderung und Verbindlichkeit", () => {
    const zeilen = reports.jahresPostenHinweis(jahresPosten({ forderungen: [posten()], verbindlichkeiten: [posten(), posten()] }));
    expect(zeilen).toEqual(["1 Forderung aus dem Jahr offen, 2 Verbindlichkeit aus dem Jahr offen."]);
  });

  it("nennt die Altlasten aus früheren Jahren samt überfälligen", () => {
    const zeilen = reports.jahresPostenHinweis(
      jahresPosten({
        verbindlichkeiten: [posten()],
        altlasten: [posten({ date: "2025-11-20", daysOverdue: 380 }), posten({ date: "2024-04-01", daysOverdue: 900 })],
        ueberfaellig: 2,
      }),
    );
    expect(zeilen).toHaveLength(2);
    expect(zeilen[1]).toContain("2 offener Posten aus früheren Jahren, davon 2 überfällig");
    expect(zeilen[1]).toContain("Abschlusskontrolle 2026");
  });

  it("trennt das laufende Jahr von den Altlasten und lässt spätere Jahre aus", async () => {
    await beleg("2025-11-20", "Altlast GmbH");
    await beleg("2026-03-05", "Bürowelt Nord GmbH");
    const spaeter = await beleg("2027-01-15", "Zukunft GmbH");

    const offen = await reports.openPositionsImJahr(2026);
    expect(offen.jahr).toBe(2026);
    expect(offen.verbindlichkeiten.map((p) => p.party)).toEqual(["Bürowelt Nord GmbH"]);
    expect(offen.forderungen).toEqual([]);
    // Nur das Vorjahr ist Altlast; der Beleg aus 2027 gehört nicht in die Abschlusskontrolle 2026
    expect(offen.altlasten.map((p) => p.party)).toEqual(["Altlast GmbH"]);
    expect(offen.altlasten.some((p) => p.id === spaeter)).toBe(false);
    expect(offen.ueberfaellig).toBe(1);

    const zeilen = reports.jahresPostenHinweis(offen);
    expect(zeilen[0]).toContain("1 Verbindlichkeit aus dem Jahr offen");
    expect(zeilen[1]).toContain("1 offener Posten aus früheren Jahren");
  }, 30_000);
});
