import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { TYPISIERTE_SPALTEN } from "./beschreibung.ts";

// Keine KI-Auslesung im Test
vi.mock("../belege/extraction.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../belege/extraction.ts")>()),
  extractionAvailable: () => false,
}));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 0xff, 0xd9]);
const SECRET = "GEHEIMES-ZERTIFIKAT-4711";
const CALENDAR_HASH = "KALENDER-TOKEN-HASH-4711";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 01.10.2026:";"1.000,00 €"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode(`﻿${header}${columns}${body}\n`);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const text = (bytes: Uint8Array | undefined) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

describe.skipIf(!testDatabaseUrl)("Jahresarchiv (Postgres)", () => {
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let files: Record<string, Uint8Array>;
  let invoice: import("../rechnungen/invoices.ts").Invoice;
  let documentId: string;
  let vatSubmissionPrefix: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    exporter = await import("./export.ts");
    const invoices = await import("../rechnungen/invoices.ts");
    const contacts = await import("../stammdaten/contacts.ts");
    const documents = await import("../belege/documents.ts");
    const bank = await import("../bank/bank.ts");
    const cash = await import("../bank/cash.ts");

    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    await sql`update company set calendar_token_hash = ${CALENDAR_HASH}`;
    await sql`insert into elster_certificates (filename, ciphertext, valid_until)
      values ('zertifikat.pfx', ${Buffer.from(SECRET)}, '2028-01-01')`;

    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const finalize = async (issueDate: string, description: string) => {
      const draft = await invoices.createDraft(actor, {
        contactId: contact.id,
        issueDate,
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: [{ description, quantity: 1000, unit: "Psch.", unitPrice: 400_000, taxRate: 1900 }],
      });
      return invoices.finalizeInvoice(actor, draft.id);
    };
    invoice = await finalize("2026-09-05", "Leistungen August");
    await finalize("2025-12-15", "Leistungen Dezember");

    const upload = async (bytes: Uint8Array, supplierName: string, documentDate: string) => {
      const { id } = await documents.uploadDocument(actor, { bytes, filename: "quittung foto.jpg" });
      await documents.updateDocument(actor, id, {
        supplierName,
        supplierUstId: "DE123475223",
        invoiceNumber: "MF-2026-09",
        documentDate,
        dueDate: null,
        category: "telefon",
        payment: "bank",
        note: "Zeile 1\nZeile 2",
        amounts: [{ taxRate: 1900, net: 3857, tax: 733 }],
      });
      await documents.bookDocument(actor, id);
      return id;
    };
    documentId = await upload(JPEG, 'Müller; "Büro" GmbH/Filiale', "2026-09-29");
    await upload(new Uint8Array([...JPEG, 7]), "Altjahr AG", "2025-12-20");

    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          ["30.12.25", "30.12.25", "Gebucht", "Tristan Teufel", "Altjahr AG", "Rechnung Dezember", "Ausgang", "DE02100100100006820101", "-45,90", "", "", ""],
          [
            "01.10.26",
            "01.10.26",
            "Gebucht",
            "Nordwerk Software GmbH",
            "Tristan Teufel",
            `RE ${invoice.number}`,
            "Eingang",
            "DE02100100100006820101",
            "4.760,00",
            "",
            "",
            "",
          ],
          ["02.10.26", "02.10.26", "Gebucht", "Tristan Teufel", "Müller Büro", "MF-2026-09", "Ausgang", "DE02100100100006820102", "-45,90", "", "", ""],
        ]),
        filename: "dkb.csv",
      },
      null,
    );
    const txs = await sql`select id, booking_date::text as d from bank_transactions order by booking_date`;
    const tx2026in = txs.find((t) => t.d === "2026-10-01")!;
    const tx2026out = txs.find((t) => t.d === "2026-10-02")!;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx2026in.id, invoiceId: invoice.id, amount: 476_000 });
    await bank.allocate(actor, { kind: "document", transactionId: tx2026out.id, documentId, amount: -4590 });

    // Kassenbuch (#546): eine Einlage und eine Entnahme im Jahr, damit kasse/kassenbuch.csv Zeilen hat
    await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-03", amount: 15_000, text: "Wechselgeld" }, "2026-10-31");
    await cash.createCashEntry(actor, { kind: "entnahme", date: "2026-10-10", amount: 2_550 }, "2026-10-31");

    const [vatReturn] = await sql`insert into vat_returns (year, month, kz81, kz66, kz83, status)
      values (2026, 9, 400000, 733, 75267, 'draft') returning id`;
    await sql`insert into vat_return_submissions (vat_return_id, kind, ok, code, message, transfer_ticket, request_xml, response_xml, server_response_xml, protocol_pdf, created_at)
      values (${vatReturn!.id}, 'validate', true, 0, 'Plausibel; ohne Fehler', null, '<Elster>anfrage</Elster>', '<Antwort/>', '', ${Buffer.from("%PDF-1.4 protokoll")}, '2026-10-02T08:00:00Z')`;
    await sql`insert into vat_returns (year, month, kz81, status) values (2025, 12, 1, 'draft')`;
    const [submission] = await sql`select id from vat_return_submissions`;
    vatSubmissionPrefix = String(submission!.id).slice(0, 8);

    // Eine Buchung aus dem Datenimport: ihre Herkunft „import“ muss in der Spalte Quelle als Name stehen
    const ledger = await import("../buchhaltung/ledger.ts");
    const { db } = await import("../../db/index.ts");
    await db.transaction(async (tx) => {
      await ledger.post(tx, await ledger.openBooks(tx), {
        date: "2026-08-01",
        description: "Übernommene Buchung aus der Vorsoftware",
        sourceType: "import",
        sourceId: crypto.randomUUID(),
        lines: [
          { account: "1200", debit: 100_000, credit: 0, taxCode: null },
          { account: "8400", debit: 0, credit: 100_000, taxCode: null },
        ],
      });
    });

    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026, new Date("2026-10-02T10:00:00Z"))) chunks.push(chunk);
    files = unzipSync(Buffer.concat(chunks));
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("quotet nach RFC 4180 und formatiert Beträge mit Komma", () => {
    expect(exporter.csvField('Müller; "Büro"')).toBe('"Müller; ""Büro"""');
    expect(exporter.csvField("a\nb")).toBe('"a\nb"');
    expect(exporter.csvField("schlicht")).toBe("schlicht");
    expect(exporter.csvField(true)).toBe("ja");
    expect(exporter.csvField(null)).toBe("");
    expect(exporter.money(123456)).toBe("1234,56");
    expect(exporter.money(-5)).toBe("-0,05");
    expect(exporter.money(0)).toBe("0,00");
    expect(text(exporter.csv(["A", "B"], [["1", null]]))).toBe("﻿A;B\r\n1;\r\n");
  });

  it("macht Dateinamen sicher", () => {
    expect(exporter.safeName('Müller; "Büro" GmbH/Filiale')).toBe("Mueller-Buero-GmbH-Filiale");
    expect(exporter.safeName("../../etc/passwd")).toBe("etc-passwd");
    expect(exporter.safeName("")).toBe("unbekannt");
    expect(exporter.safeName("x".repeat(100)).length).toBe(40);
  });

  it("enthält die erwartete Dateistruktur", () => {
    const names = Object.keys(files).sort();
    expect(names).toEqual(
      [
        "LIESMICH.txt",
        "index.xml",
        `rechnungen/${invoice.number}.pdf`,
        `rechnungen/${invoice.number}.xml`,
        "rechnungen/rechnungen.csv",
        `belege/2026-09-29_Mueller-Buero-GmbH-Filiale_${documentId.slice(0, 8)}.jpg`,
        "belege/belege.csv",
        "buchungen/journal.csv",
        "anlagen/anlagenverzeichnis.csv",
        "kasse/kassenbuch.csv",
        "bank/DE12120300001234567890/umsaetze.csv",
        "bank/zuordnungen.csv",
        "bank/importe.csv",
        "stammdaten/kontakte.csv",
        "stammdaten/kontakt-versionen.csv",
        "stammdaten/bankkonten.csv",
        "stammdaten/firma.json",
        "protokoll/audit.csv",
        "protokoll/pruefwert.txt",
        "umsatzsteuer/2026-09/anmeldung.json",
        "umsatzsteuer/2026-09/übermittlungen.csv",
        `umsatzsteuer/2026-09/2026-10-02_validate_${vatSubmissionPrefix}_protokoll.pdf`,
        `umsatzsteuer/2026-09/2026-10-02_validate_${vatSubmissionPrefix}_anfrage.xml`,
        `umsatzsteuer/2026-09/2026-10-02_validate_${vatSubmissionPrefix}_antwort.xml`,
        "pruefsummen.sha256",
      ].sort(),
    );
    expect(text(files["LIESMICH.txt"])).toContain("Jahresarchiv 2026");
    expect(text(files["LIESMICH.txt"])).toContain("sha256sum -c pruefsummen.sha256");
  });

  it("legt Originale unverändert ab", () => {
    expect(files[`belege/2026-09-29_Mueller-Buero-GmbH-Filiale_${documentId.slice(0, 8)}.jpg`]).toEqual(JPEG);
    const pdf = files[`rechnungen/${invoice.number}.pdf`]!;
    expect(Buffer.from(pdf).equals(invoice.pdf!)).toBe(true);
    expect(sha256(pdf)).toBe(invoice.pdfSha256);
    expect(sha256(files[`rechnungen/${invoice.number}.xml`]!)).toBe(invoice.xmlSha256);
  });

  it("schreibt CSV mit BOM, Semikolon, Dezimalkomma und Quoting", async () => {
    const invoicesCsv = text(files["rechnungen/rechnungen.csv"]);
    expect(invoicesCsv.startsWith("﻿Nummer;Art;Datum;")).toBe(true);
    const invoiceLines = invoicesCsv.trim().split("\r\n");
    expect(invoiceLines).toHaveLength(2);
    expect(invoiceLines[1]).toContain(`${invoice.number};Rechnung;2026-09-05;`);
    expect(invoiceLines[1]).toContain(";4000,00;760,00;4760,00;EUR;;ZUGFeRD;");

    const belege = text(files["belege/belege.csv"]);
    expect(belege).toContain('2026-09-29;"Müller; ""Büro"" GmbH/Filiale";DE123475223;MF-2026-09;telefon;38,57;7,33;;;;38,57;7,33;45,90;0;EUR;;;Bank;gebucht;');
    expect(belege).toContain('"Zeile 1\nZeile 2"');
    expect(belege).toContain(`${sha256(JPEG)};quittung foto.jpg;2026-09-29_Mueller-Buero-GmbH-Filiale_${documentId.slice(0, 8)}.jpg`);

    const journal = text(files["buchungen/journal.csv"]);
    // Die Herkunft „import“ nennt ihren Namen; der rohe Enum-Wert darf nicht in der Spalte Quelle stehen
    expect(journal).toContain(";Übernommene Buchung aus der Vorsoftware;Import;");
    expect(journal).not.toContain(";Übernommene Buchung aus der Vorsoftware;import;");
    expect(journal).toContain(";1400;Forderungen aus Lieferungen und Leistungen;4760,00;;");
    expect(journal).toContain(";4920;Telefon;38,57;;VSt19;");
    // Nur Buchungen des Jahres: die erste Spalte ist das Datum. Nicht über den ganzen Text prüfen, zufällige UUIDs
    // können „2025-“ enthalten (etwa „…-2025-…“), dann schlug der Test ohne Grund fehl
    const daten = journal
      .replace(/^\uFEFF/, "")
      .split("\n")
      .slice(1)
      .filter(Boolean)
      .map((zeile) => zeile.slice(0, 10));
    expect(daten.length).toBeGreaterThan(0);
    expect(daten.every((datum) => datum.startsWith("2026-"))).toBe(true);

    const umsaetze = text(files["bank/DE12120300001234567890/umsaetze.csv"]);
    expect(umsaetze.trim().split("\r\n")).toHaveLength(3);
    expect(umsaetze).toContain("2026-10-01;2026-10-01;4760,00;EUR;Nordwerk Software GmbH;");
    expect(umsaetze).not.toContain("2025-12-30");

    const zuordnungen = text(files["bank/zuordnungen.csv"]);
    expect(zuordnungen).toContain(`2026-10-01;DE12120300001234567890;Rechnung;${invoice.number};;4760,00;`);
    expect(zuordnungen).toContain(`;Beleg;;2026-09-29_Mueller-Buero-GmbH-Filiale_${documentId.slice(0, 8)}.jpg;-45,90;`);

    expect(text(files["bank/importe.csv"])).toContain(";dkb.csv;");
    expect(text(files["stammdaten/kontakte.csv"])).toContain("10001;Nordwerk Software GmbH;Hafenstraße 5;");
    expect(JSON.parse(text(files["stammdaten/firma.json"]))).toMatchObject({ name: "Testfirma", steuernummer: "198/113/10010" });
    expect(text(files["protokoll/audit.csv"])).toContain(";invoices;");
    expect(text(files["protokoll/audit.csv"])).toMatch(/^\uFEFFZeitpunkt;.*;Nr\.;Ketten-Nr\.;Vorgänger-Hash;Hash\r\n/);
    expect(text(files["protokoll/audit.csv"])).toMatch(/;[0-9a-f]{64};[0-9a-f]{64}\r\n/);
    const [head] = await sql`select seq, encode(hash, 'hex') as hash from audit_chain`;
    expect(text(files["protokoll/pruefwert.txt"])).toMatch(/^Beim Erstellen dieses Archivs .*:\nNr\. \d+ · [0-9a-f]{64}$/m);
    expect(Number(head!.seq)).toBeGreaterThanOrEqual(Number(/Nr\. (\d+)/.exec(text(files["protokoll/pruefwert.txt"]))![1]));

    expect(JSON.parse(text(files["umsatzsteuer/2026-09/anmeldung.json"]))).toMatchObject({ year: 2026, month: 9, kz81: 400000, kz66: 733 });
    const uebermittlungen = text(files["umsatzsteuer/2026-09/übermittlungen.csv"]);
    expect(uebermittlungen).toContain(
      `2026-10-02T08:00:00.000Z;Prüfung;ja;0;"Plausibel; ohne Fehler";;2026-10-02_validate_${vatSubmissionPrefix}_protokoll.pdf;`,
    );
    expect(text(files[`umsatzsteuer/2026-09/2026-10-02_validate_${vatSubmissionPrefix}_anfrage.xml`])).toBe("<Elster>anfrage</Elster>");
  });

  describe("index.xml (#546)", () => {
    /** Zeilen einer CSV des Archivs, mit mehrzeiligen Feldern in Anführungszeichen */
    function zeilen(bytes: Uint8Array): string[][] {
      const t = text(bytes).replace(/^\uFEFF/, "");
      const rows: string[][] = [];
      let row: string[] = [];
      let feld = "";
      let an = false;
      for (let i = 0; i < t.length; i++) {
        const c = t[i]!;
        if (an) {
          if (c === '"' && t[i + 1] === '"') {
            feld += c;
            i++;
          } else if (c === '"') an = false;
          else feld += c;
        } else if (c === '"') an = true;
        else if (c === ";") {
          row.push(feld);
          feld = "";
        } else if (c === "\n") {
          row.push(feld.replace(/\r$/, ""));
          rows.push(row);
          row = [];
          feld = "";
        } else feld += c;
      }
      return rows;
    }

    it("beschreibt jede CSV des Archivs mit ihren Spalten in Dateireihenfolge und verweist auf die DTD", () => {
      const xml = text(files["index.xml"]);
      expect(xml).toContain('<!DOCTYPE DataSet SYSTEM "gdpdu-01-03-2019.dtd">');
      const csvs = Object.keys(files)
        .filter((n) => n.endsWith(".csv"))
        .sort();
      expect(csvs.length).toBeGreaterThan(8);
      const urls = [...xml.matchAll(/<URL>([^<]+)<\/URL>/g)].map((m) => m[1]);
      expect(urls).toEqual(csvs);
      for (const pfad of csvs) {
        const kopf = zeilen(files[pfad]!)[0]!;
        const teil = xml.slice(xml.indexOf(`<URL>${pfad}</URL>`), xml.indexOf("</Table>", xml.indexOf(`<URL>${pfad}</URL>`)));
        const namen = [...teil.matchAll(/<VariableColumn>\s*<Name>([^<]*)<\/Name>/g)].map((m) =>
          m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
        );
        expect(namen, pfad).toEqual(kopf);
      }
    });

    it("Betrags- und Datumsspalten passen zu allen Werten der Datei; Kopfzeile und Überschriften stehen in der Datei", () => {
      let geprueft = 0;
      for (const t of TYPISIERTE_SPALTEN) {
        for (const pfad of Object.keys(files).filter((n) => t.pfad.test(n))) {
          const [kopf, ...daten] = zeilen(files[pfad]!);
          for (const [spalten, muster] of [
            [t.zahlen, /^-?\d+,\d{2}$/],
            [t.daten, /^\d{4}-\d{2}-\d{2}$/],
          ] as const) {
            for (const name of spalten) {
              const i = kopf!.indexOf(name);
              expect(i, `${pfad}: Spalte „${name}“ fehlt`).toBeGreaterThanOrEqual(0);
              for (const row of daten) {
                if (row.length === 1 && row[0] === "") continue;
                expect(row[i] === "" || muster.test(row[i]!), `${pfad}: ${name} = ${row[i]}`).toBe(true);
                geprueft++;
              }
            }
          }
        }
      }
      // Rechnungen, Belege, Journal, Umsätze und Zuordnungen haben im Test Zeilen
      expect(geprueft).toBeGreaterThan(30);
    });

    it("das Kassenbuch ist beschrieben: Beträge als Numeric, Datum als Date, Nummer und Text als AlphaNumeric (#546)", () => {
      const pfad = "kasse/kassenbuch.csv";
      const [kopf, ...daten] = zeilen(files[pfad]!);
      // Anfangsbestand, Einlage und Entnahme
      expect(daten.filter((r) => r.length > 1).length).toBe(3);
      const xml = text(files["index.xml"]);
      const teil = xml.slice(xml.indexOf(`<URL>${pfad}</URL>`), xml.indexOf("</Table>", xml.indexOf(`<URL>${pfad}</URL>`)));
      const art = (spalte: string) => {
        const von = teil.indexOf(`<Name>${spalte}</Name>`);
        expect(von, spalte).toBeGreaterThanOrEqual(0);
        // Die index.xml ist eingerückt; verglichen wird ohne Leerraum
        return teil.slice(von, teil.indexOf("</VariableColumn>", von)).replace(/\s+/g, "");
      };
      for (const spalte of ["Einnahme", "Ausgabe", "Bestand"]) expect(art(spalte), spalte).toContain("<Numeric><Accuracy>2</Accuracy></Numeric>");
      expect(art("Datum")).toContain("<Date><Format>YYYY-MM-DD</Format></Date>");
      expect(art("Nr.")).toContain("<AlphaNumeric/>");
      expect(kopf).toContain("Einnahme");
    });

    it("steht in der LIESMICH und in den Prüfsummen", () => {
      expect(text(files["LIESMICH.txt"])).toContain("index.xml");
      expect(text(files["pruefsummen.sha256"])).toMatch(/^[0-9a-f]{64} {2}index\.xml$/m);
    });
  });

  it("Prüfsummen passen zu jeder Datei", () => {
    const lines = text(files["pruefsummen.sha256"]).trim().split("\n");
    expect(lines).toHaveLength(Object.keys(files).length - 1);
    for (const line of lines) {
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      expect(match).not.toBeNull();
      expect(sha256(files[match![2]!]!)).toBe(match![1]);
    }
  });

  it("lässt andere Jahre weg und gibt kein Zertifikat heraus", () => {
    const all = Object.entries(files).map(([name, bytes]) => `${name}\n${Buffer.from(bytes).toString("latin1")}`);
    for (const content of all) {
      // Das Protokoll ordnet nach Zeitpunkt der Änderung; im Test liegen alle Änderungen in 2026
      if (!content.startsWith("protokoll/")) {
        expect(content).not.toContain("2025-001");
        expect(content).not.toContain("Altjahr");
      }
      expect(content).not.toContain(SECRET);
      expect(content).not.toContain(CALENDAR_HASH);
      expect(content).not.toContain(Buffer.from(SECRET).toString("hex"));
      expect(content).not.toContain(Buffer.from(SECRET).toString("base64"));
    }
  });

  it("bricht ab, statt ein ZIP ohne ZIP64 mit zu vielen Dateien zu bauen", async () => {
    async function* many() {
      for (let i = 0; i <= 0xffff; i++) yield { path: `${i}.txt`, content: new Uint8Array(0), compress: false };
    }
    const run = async () => {
      for await (const chunk of exporter.zipArchive(many(), new Date())) void chunk;
    };
    await expect(run()).rejects.toThrow(/65\.535 Dateien/);
  });

  it("listet Jahre mit Daten", async () => {
    expect(await exporter.exportYears(new Date("2026-10-02T10:00:00Z"))).toEqual([2026, 2025]);
    expect(exporter.exportFilename(2025, new Date("2026-10-02T10:00:00Z"))).toBe("Haben-2025-2026-10-02.zip");
  });
});
