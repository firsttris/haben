import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Belegverrechnung im Jahresarchiv (#274): Sie hat weder Bankumsatz noch Buchung und steht nur in
 * `document_settlements`. Ohne eigene Datei im Archiv wäre der Vorgang, der die offenen Posten beider Belege
 * verändert, in der GoBD-Ablage nicht nachvollziehbar.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 0xff, 0xd9]);
const text = (bytes: Uint8Array | undefined) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

describe.skipIf(!testDatabaseUrl)("Jahresarchiv: Verrechnungen von Belegen (Postgres)", () => {
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;
  let files: Record<string, Uint8Array>;
  const actor = "test-user";
  let rechnung: string;
  let gutschrift: string;
  let vorjahr: string;
  let erste: string;
  let zweite: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    exporter = await import("./export.ts");
    const { storeFile } = await import("../../storage.ts");
    // Je Beleg eine eigene Datei: der SHA-256 ist der Schlüssel des Dokumentenspeichers
    const sha256Rechnung = await storeFile(JPEG);
    const sha256Gutschrift = await storeFile(new Uint8Array([...JPEG, 7]));
    const sha256Vorjahr = await storeFile(new Uint8Array([...JPEG, 8]));

    rechnung = crypto.randomUUID();
    gutschrift = crypto.randomUUID();
    vorjahr = crypto.randomUUID();
    await sql`insert into documents (id, filename, sha256, mime_type, size, status, payment, supplier_name, category,
                                     document_date, due_date, net, tax, gross)
      values (${rechnung}, 'rechnung.jpg', ${sha256Rechnung}, 'image/jpeg', ${JPEG.length}, 'gebucht', 'bank', 'Nordlicht Technik GmbH',
              'telefon', '2026-03-01', '2027-12-31', 100000, 19000, 119000),
             (${gutschrift}, 'gutschrift.jpg', ${sha256Gutschrift}, 'image/jpeg', ${JPEG.length + 1}, 'gebucht', 'bank', 'Nordlicht Technik GmbH',
              'telefon', '2026-03-02', '2027-12-31', -40000, -7600, -47600)`;
    // Der Gegenbeleg des zweiten Vorgangs liegt im Vorjahr und ist deshalb nicht selbst im Archiv
    await sql`insert into documents (id, filename, sha256, mime_type, size, status, payment, supplier_name, category,
                                     document_date, due_date, net, tax, gross)
      values (${vorjahr}, 'gutschrift-alt.jpg', ${sha256Vorjahr}, 'image/jpeg', ${JPEG.length + 1}, 'gebucht', 'bank', 'Altjahr Handel',
              'telefon', '2025-12-20', '2026-06-30', -8403, -1597, -10000)`;

    const [ersteZeile] = await sql`insert into document_settlements (document_id, counter_document_id, date, amount, note, created_by)
      values (${rechnung}, ${gutschrift}, '2026-05-10', -47600, 'Gutschrift GS-7', ${actor})
      returning id`;
    erste = ersteZeile!.id as string;
    const [gegenzeile] = await sql`insert into document_settlements (document_id, counter_document_id, date, amount, note, created_by)
      values (${gutschrift}, ${rechnung}, '2026-05-10', 47600, 'Gutschrift GS-7', ${actor})
      returning id`;
    zweite = gegenzeile!.id as string;
    // Vorgang über die Jahresgrenze: Gutschrift aus 2025 gegen die Rechnung aus 2026
    await sql`insert into document_settlements (document_id, counter_document_id, date, amount, note, created_by)
      values (${rechnung}, ${vorjahr}, '2026-01-10', -10000, 'Gutschrift vom 20.12.2025', ${actor}),
             (${vorjahr}, ${rechnung}, '2026-01-10', 10000, 'Gutschrift vom 20.12.2025', ${actor})`;
    // Aufgehoben: je Zeile eine Gegenzeile mit dem Tag der Aufhebung
    await sql`insert into document_settlements (document_id, counter_document_id, date, amount, note, reverses_id, created_by)
      values (${rechnung}, ${gutschrift}, '2026-06-01', 47600, 'Aufhebung: Gutschrift GS-7', ${erste}, ${actor}),
             (${gutschrift}, ${rechnung}, '2026-06-01', -47600, 'Aufhebung: Gutschrift GS-7', ${zweite}, ${actor})`;

    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026, new Date("2026-07-01T10:00:00Z"))) chunks.push(chunk);
    files = unzipSync(Buffer.concat(chunks));
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt die Verrechnungen beider Belege als eigene Datei ab, samt Aufhebung", () => {
    expect(Object.keys(files)).toContain("belege/verrechnungen.csv");
    const csv = text(files["belege/verrechnungen.csv"]);
    expect(csv.startsWith("﻿Datum;Beleg;Gegenbeleg;Betrag;Notiz;Hebt auf;Angelegt;Beleg-ID;Gegenbeleg-ID;Verrechnungs-ID\r\n")).toBe(true);
    const rechnungName = `2026-03-01_Nordlicht-Technik-GmbH_${rechnung.slice(0, 8)}.jpg`;
    const gutschriftName = `2026-03-02_Nordlicht-Technik-GmbH_${gutschrift.slice(0, 8)}.jpg`;
    // Je Verrechnung beide Seiten: negativ beim Beleg, positiv bei der Gutschrift; der Betrag wie gespeichert
    expect(csv).toContain(`2026-05-10;${rechnungName};${gutschriftName};-476,00;Gutschrift GS-7;;`);
    expect(csv).toContain(`2026-05-10;${gutschriftName};${rechnungName};476,00;Gutschrift GS-7;;`);
    expect(csv).toContain(`;${rechnung};${gutschrift};${erste}\r\n`);
    expect(csv).toContain(`;${gutschrift};${rechnung};${zweite}\r\n`);
    // Gegenbeleg aus dem Vorjahr: kein Pfad im Archiv, aber Datum, Lieferant und ID benennen ihn
    expect(csv).toContain(`2026-01-10;${rechnungName};2025-12-20_Altjahr-Handel_${vorjahr.slice(0, 8)}.jpg;-100,00;Gutschrift vom 20.12.2025;;`);
    // Aufhebung: Betrag umgekehrt, „Hebt auf“ nennt die Ursprungszeile
    expect(csv).toContain(`2026-06-01;${rechnungName};${gutschriftName};476,00;Aufhebung: Gutschrift GS-7;${erste};`);
    expect(csv).toContain(`2026-06-01;${gutschriftName};${rechnungName};-476,00;Aufhebung: Gutschrift GS-7;${zweite};`);
    // Kopf plus sechs Zeilen: zwei Verrechnungen und zwei Aufhebungen, je Verrechnung beide Seiten
    expect(csv.trim().split("\r\n")).toHaveLength(7);
  });

  it("nimmt die Datei in die Prüfsummen auf", () => {
    expect(text(files["pruefsummen.sha256"])).toContain("  belege/verrechnungen.csv");
  });

  it("erwähnt die Datei im LIESMICH", () => {
    expect(text(files["LIESMICH.txt"])).toContain("belege/verrechnungen.csv");
  });
});
