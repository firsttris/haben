import { VERMERK } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Restlaufzeiten zum Stichtag (§ 268 Abs. 4 und 5 HGB) und Vermerke gegenüber Gesellschaftern (§ 42 Abs. 3 GmbHG):
 * Vorschlag, Bestätigung mit Audit, Hinterlegung und E-Bilanz.
 */
describe.skipIf(!testDatabaseUrl)("Restlaufzeiten und Bilanzvermerke (Postgres)", () => {
  let sql: postgres.Sql;
  let restlaufzeiten: typeof import("./restlaufzeiten.ts");
  let hinterlegung: typeof import("./hinterlegung.ts");
  let manual: typeof import("./manual.ts");
  let ledger: typeof import("./ledger.ts");
  const actor = "test-user";
  const today = "2027-02-10";
  const KEINE = { haftungsverhaeltnisse: "", organkredite: "", festgestelltAm: "2027-02-01" };

  beforeAll(async () => {
    sql = await setupTestDb();
    restlaufzeiten = await import("./restlaufzeiten.ts");
    hinterlegung = await import("./hinterlegung.ts");
    manual = await import("./manual.ts");
    ledger = await import("./ledger.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, write_offs, documents, invoices, asset_depreciations, assets, residual_terms,
      company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   sitz, registergericht, registernummer)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, 'gmbh', 'Bremen', 'Amtsgericht Bremen', 'HRB 12345 HB')`;
  }

  async function book(date: string, lines: [string, number, number][]) {
    const { withActor } = await import("../../db/actor.ts");
    return withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date,
        description: "Test",
        sourceType: "document",
        sourceId: crypto.randomUUID(),
        lines: lines.map(([account, debit, credit]) => ({ account, debit, credit, taxCode: null })),
      }),
    );
  }

  describe.each([
    ["SKR03", { bank: "1200", kapital: "0800", ges: "0730", darlehen: "0640", fordGes: "1383", verb: "1600", aufwand: "4930", ford: "1400", erloese: "8400" }],
    ["SKR04", { bank: "1800", kapital: "2900", ges: "3510", darlehen: "3160", fordGes: "1309", verb: "3300", aufwand: "6815", ford: "1200", erloese: "4400" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)("%s: vorschlagen, bestätigen, in Hinterlegung und E-Bilanz", async (versteuerung) => {
      await setup(kontenrahmen, versteuerung);
      // Eröffnung 2026: Bank 25.000 an Kapital; der Gesellschafter hat 4.000 vorgeschossen
      await manual.createManualEntry(
        actor,
        {
          kind: "eroeffnung",
          date: "2026-01-01",
          description: "Eröffnungsbilanz",
          lines: [
            { account: k.bank, debit: 2_900_000, credit: 0 },
            { account: k.kapital, debit: 0, credit: 2_500_000 },
            { account: k.ges, debit: 0, credit: 400_000 },
          ],
        },
        today,
      );
      // Im Jahr: Bankdarlehen 6.000 (Konto mit Restlaufzeit 1 bis 5 Jahre), Darlehen an den Gesellschafter 1.000 (> 1 Jahr)
      await book("2026-03-01", [
        [k.bank, 600_000, 0],
        [k.darlehen, 0, 600_000],
      ]);
      await book("2026-04-01", [
        [k.fordGes, 100_000, 0],
        [k.bank, 0, 100_000],
      ]);

      const ansicht = (await restlaufzeiten.restlaufzeitenAnsicht(2026))!;
      expect(ansicht.jahr.stand).toBe("fehlt");
      const zeile = (account: string) => ansicht.jahr.zeilen.find((z) => z.account === account)!;
      expect(zeile(k.darlehen)).toMatchObject({ eingabe: false, vorschlag: 600_000, betrag: 600_000 });
      expect(zeile(k.fordGes)).toMatchObject({ eingabe: false, vorschlag: 100_000, art: "forderung" });
      expect(zeile(k.ges)).toMatchObject({ eingabe: true, vorschlag: 0, wert: 0, betrag: 400_000 });
      expect(ansicht.jahr.zeilen.some((z) => z.account === k.bank)).toBe(false);
      // Vorjahresspalte aus der Eröffnung: nur das Verrechnungskonto
      expect(ansicht.vorjahr?.zeilen.map((z) => z.account)).toEqual([k.ges]);

      expect((await hinterlegung.hinterlegungStand(2026, today))?.maengel).toEqual([
        "Die Restlaufzeiten der Forderungen und Verbindlichkeiten zum 31.12.2026 sind noch nicht bestätigt (§ 268 Abs. 4 und 5 HGB).",
        "Die Restlaufzeiten der Forderungen und Verbindlichkeiten zum 31.12.2025 sind noch nicht bestätigt (§ 268 Abs. 4 und 5 HGB).",
      ]);
      await expect(hinterlegung.hinterlegungPdf(2026, KEINE, today)).rejects.toThrow("noch nicht bestätigt");
      // Ohne Bestätigung: Gesellschafter-Vermerke schon, Restlaufzeiten nicht
      const ohne = await restlaufzeiten.bilanzVermerkeFuer(2026, kontenrahmen);
      expect(ohne.jahr.map((v) => v.label)).toEqual([VERMERK.forderungenGesellschafter, VERMERK.verbindlichkeitenGesellschafter]);
      expect(await restlaufzeiten.ebilanzDavon(2026, kontenrahmen)).toBeNull();

      await expect(restlaufzeiten.saveRestlaufzeiten(actor, 2026, { jahr: [], vorjahr: [] })).rejects.toThrow(
        `Zum 31.12.2026 fehlt die Restlaufzeit für Konto ${k.ges}.`,
      );
      await expect(
        restlaufzeiten.saveRestlaufzeiten(actor, 2026, { jahr: [{ account: k.ges, ueber1Jahr: 400_001 }], vorjahr: [{ account: k.ges, ueber1Jahr: 0 }] }),
      ).rejects.toThrow("höchstens der ganze Betrag");
      // Der Gesellschafter hat 2.500 € bis 2028 gestundet
      await restlaufzeiten.saveRestlaufzeiten(actor, 2026, { jahr: [{ account: k.ges, ueber1Jahr: 250_000 }], vorjahr: [{ account: k.ges, ueber1Jahr: 0 }] });
      const [log] = await sql`select action, new_value from audit_log where table_name = 'residual_terms' order by seq desc limit 1`;
      expect(log?.action).toBe("INSERT");
      expect(JSON.stringify(log?.new_value)).toContain(k.ges);

      expect((await restlaufzeiten.restlaufzeitenAnsicht(2026))?.jahr.stand).toBe("bestaetigt");
      expect((await hinterlegung.hinterlegungStand(2026, today))?.maengel).toEqual([]);
      const bilanz = await hinterlegung.hinterlegungBilanzFuer(2026, KEINE, today);
      expect(bilanz.passiva.map((z) => [z.label, z.betrag, z.vorjahr])).toEqual([
        ["A. Eigenkapital", 2_500_000, 2_500_000],
        ["C. Verbindlichkeiten", 1_000_000, 400_000],
        [VERMERK.verbindlichkeitenBis1Jahr, 150_000, 400_000],
        [VERMERK.verbindlichkeitenUeber1Jahr, 850_000, 0],
        [VERMERK.verbindlichkeitenGesellschafter, 400_000, 400_000],
      ]);
      expect(bilanz.aktiva.map((z) => [z.label, z.betrag, z.vorjahr])).toEqual([
        ["B. Umlaufvermögen", 3_500_000, 2_900_000],
        [VERMERK.forderungenUeber1Jahr, 100_000, 0],
        [VERMERK.forderungenGesellschafter, 100_000, 0],
      ]);
      const { pdf } = await hinterlegung.hinterlegungPdf(2026, KEINE, today);
      expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");

      const davon = await restlaufzeiten.ebilanzDavon(2026, kontenrahmen);
      expect(davon).toMatchObject({
        "bs.eqLiab.liab.upTo1year": 150_000,
        "bs.eqLiab.liab.above1year": 850_000,
        "bs.eqLiab.liab.shareholders.above1year": 250_000,
        "bs.ass.currAss.receiv.above1year": 100_000,
      });

      // Eine spätere Buchung ins Verrechnungskonto ändert den Betrag: neu bestätigen
      await book("2026-12-30", [
        [k.bank, 50_000, 0],
        [k.ges, 0, 50_000],
      ]);
      expect((await restlaufzeiten.restlaufzeitenAnsicht(2026))?.jahr.stand).toBe("geaendert");
      expect((await hinterlegung.hinterlegungStand(2026, today))?.maengel).toEqual([
        "Die Salden zum 31.12.2026 haben sich seit der Bestätigung der Restlaufzeiten geändert; bitte neu bestätigen.",
      ]);
    });

    it.each(["ist", "soll"] as const)("%s: Vorschlag aus offenen Posten, Ausbuchungen und Korrekturen bis zum Stichtag mindern ihn", async (versteuerung) => {
      await setup(kontenrahmen, versteuerung);
      await book("2025-02-01", [
        [k.bank, 2_500_000, 0],
        [k.kapital, 0, 2_500_000],
      ]);
      // Beleg über 3.000 €, erst im Juni 2027 fällig; im Dezember 2025 sind 90 € Skonto ausgebucht
      await book("2025-11-01", [
        [k.aufwand, 300_000, 0],
        [k.verb, 0, 300_000],
      ]);
      const [beleg] = await sql`insert into documents (filename, sha256, mime_type, size, status, payment, gross, document_date, due_date)
        values ('rate.pdf', 'rlz-skonto', 'application/pdf', 1, 'gebucht', 'bank', 300000, '2025-11-01', '2027-06-30') returning id`;
      await sql`insert into write_offs (kind, document_id, date, amount) values ('skontoErhalten', ${beleg!.id}, '2025-12-15', -9000)`;
      await book("2025-12-15", [
        [k.verb, 9_000, 0],
        [k.aufwand, 0, 9_000],
      ]);
      // Rechnung über 5.000 €, erst im Juni 2027 fällig, per Korrekturrechnung um 2.000 € gemindert
      await book("2025-11-01", [
        [k.ford, 500_000, 0],
        [k.erloese, 0, 500_000],
      ]);
      await book("2025-12-01", [
        [k.ford, 0, 200_000],
        [k.erloese, 200_000, 0],
      ]);
      const [rechnung] = await sql`insert into invoices (kind, status, number, locked_at, issue_date, due_date, net, tax, gross)
        values ('rechnung', 'final', 'RLZ-1', now(), '2025-11-01', '2027-06-30', 500000, 0, 500000) returning id`;
      await sql`insert into invoices (kind, status, number, locked_at, issue_date, due_date, net, tax, gross, corrects_id)
        values ('korrektur', 'final', 'RLZ-2', now(), '2025-12-01', '2027-06-30', -200000, 0, -200000, ${rechnung!.id})`;
      // Eine kurzfristige Rechnung über 1.000 €, damit die Obergrenze (Saldo des Kontos) nicht greift
      await book("2025-12-01", [
        [k.ford, 100_000, 0],
        [k.erloese, 0, 100_000],
      ]);
      await book("2025-12-02", [
        [k.aufwand, 100_000, 0],
        [k.verb, 0, 100_000],
      ]);
      const zeilen = (await restlaufzeiten.restlaufzeitenAnsicht(2025))!.jahr.zeilen;
      expect(zeilen.find((z) => z.account === k.verb)).toMatchObject({ betrag: 391_000, vorschlag: 291_000 });
      expect(zeilen.find((z) => z.account === k.ford)).toMatchObject({ betrag: 400_000, vorschlag: 300_000 });
    });

    it.each(["ist", "soll"] as const)("%s: Verrechnung zweier Belege mindert den Beleg wie eine Zahlung", async (versteuerung) => {
      await setup(kontenrahmen, versteuerung);
      await book("2025-02-01", [
        [k.bank, 2_500_000, 0],
        [k.kapital, 0, 2_500_000],
      ]);
      // Rechnung über 3.000 €, erst im Juni 2027 fällig, und die Gutschrift des Lieferanten über 1.000 €
      await book("2025-11-01", [
        [k.aufwand, 300_000, 0],
        [k.verb, 0, 300_000],
      ]);
      await book("2025-11-02", [
        [k.verb, 100_000, 0],
        [k.aufwand, 0, 100_000],
      ]);
      // Ein kurzfristiger Beleg über 2.000 €, damit der Saldo des Kontos über dem Vorschlag liegt
      await book("2025-11-03", [
        [k.aufwand, 200_000, 0],
        [k.verb, 0, 200_000],
      ]);
      const [rechnung] = await sql`insert into documents (filename, sha256, mime_type, size, status, payment, gross, document_date, due_date)
        values ('rechnung.pdf', 'rlz-verrechnung', 'application/pdf', 1, 'gebucht', 'bank', 300000, '2025-11-01', '2027-06-30') returning id`;
      const [gutschrift] = await sql`insert into documents (filename, sha256, mime_type, size, status, payment, gross, document_date, due_date)
        values ('gutschrift.pdf', 'rlz-verrechnung-gutschrift', 'application/pdf', 1, 'gebucht', 'bank', -100000, '2025-11-02', '2027-06-30') returning id`;
      await sql`insert into documents (filename, sha256, mime_type, size, status, payment, gross, document_date, due_date)
        values ('kurzfristig.pdf', 'rlz-verrechnung-kurz', 'application/pdf', 1, 'gebucht', 'bank', 200000, '2025-11-03', '2026-06-30')`;
      // Im Dezember 2025 verrechnet: Je Seite eine Zeile, negativ beim Beleg und positiv bei der Gutschrift
      await sql`insert into document_settlements (document_id, counter_document_id, date, amount, note, created_by)
        values (${rechnung!.id}, ${gutschrift!.id}, '2025-12-10', -100000, 'Gutschrift GS-1', ${actor}),
               (${gutschrift!.id}, ${rechnung!.id}, '2025-12-10', 100000, 'Gutschrift GS-1', ${actor})`;
      const zeile = async () => (await restlaufzeiten.restlaufzeitenAnsicht(2025))!.jahr.zeilen.find((z) => z.account === k.verb)!;
      // 3.000 € offen, davon 1.000 € durch die Gutschrift ausgeglichen; der kurzfristige Beleg zählt nicht
      expect(await zeile()).toMatchObject({ betrag: 400_000, vorschlag: 200_000 });
      // Eine Aufhebung wirkt an ihrem Tag: zum 31.12.2025 bleibt die Verrechnung, zum 31.12.2026 ist sie weg
      await sql`insert into document_settlements (document_id, counter_document_id, date, amount, note, reverses_id, created_by)
        select document_id, counter_document_id, '2026-01-05', -amount, 'Aufhebung: Gutschrift GS-1', id, ${actor}
          from document_settlements where date = '2025-12-10' and amount < 0`;
      expect(await zeile()).toMatchObject({ betrag: 400_000, vorschlag: 200_000 });
      const naechstesJahr = (await restlaufzeiten.restlaufzeitenAnsicht(2026))!.jahr.zeilen.find((z) => z.account === k.verb)!;
      // Zum 31.12.2026 ist keiner der Belege mehr über ein Jahr hinaus fällig
      expect(naechstesJahr).toMatchObject({ betrag: 400_000, vorschlag: 0 });
    });

    it.each(["ist", "soll"] as const)("%s: Vorschlag mit einem Beleg, der erst nach dem Stichtag storniert ist", async (versteuerung) => {
      await setup(kontenrahmen, versteuerung);
      await book("2025-02-01", [
        [k.bank, 2_500_000, 0],
        [k.kapital, 0, 2_500_000],
      ]);
      await book("2025-11-01", [
        [k.aufwand, 300_000, 0],
        [k.verb, 0, 300_000],
      ]);
      const [beleg] = await sql`insert into documents (filename, sha256, mime_type, size, status, payment, gross, document_date, due_date, locked_at)
        values ('rate.pdf', 'rlz-storno', 'application/pdf', 1, 'gebucht', 'bank', 300000, '2025-11-01', '2027-06-30', now()) returning id`;
      // Storniert im Januar 2026: Zum 31.12.2025 steht die Verbindlichkeit noch in der Bilanz
      const gegenbuchung = await book("2026-01-15", [
        [k.verb, 300_000, 0],
        [k.aufwand, 0, 300_000],
      ]);
      await sql`insert into document_cancellations (document_id, date, journal_entry_id) values (${beleg!.id}, '2026-01-15', ${gegenbuchung})`;
      const zeile = (await restlaufzeiten.restlaufzeitenAnsicht(2025))!.jahr.zeilen.find((z) => z.account === k.verb);
      expect(zeile).toMatchObject({ betrag: 300_000, vorschlag: 300_000 });
    });

    it("Vorjahresspalte aus der Bestätigung des Vorjahres", async () => {
      await setup(kontenrahmen, "ist");
      await book("2025-02-01", [
        [k.bank, 2_900_000, 0],
        [k.kapital, 0, 2_500_000],
        [k.ges, 0, 400_000],
      ]);
      // Ein gebuchter Beleg über 3.000 €, erst im Juni 2027 fällig: mehr als ein Jahr nach dem 31.12.2025
      await book("2025-11-01", [
        [k.aufwand, 300_000, 0],
        [k.verb, 0, 300_000],
      ]);
      await sql`insert into documents (filename, sha256, mime_type, size, status, payment, gross, document_date, due_date)
        values ('rate.pdf', 'rlz', 'application/pdf', 1, 'gebucht', 'bank', 300000, '2025-11-01', '2027-06-30')`;
      const vorschlag = (await restlaufzeiten.restlaufzeitenAnsicht(2025))!.jahr.zeilen.find((z) => z.account === k.verb);
      expect(vorschlag).toMatchObject({ eingabe: true, vorschlag: 300_000, wert: 300_000 });
      expect(vorschlag?.grund).toContain("erst nach dem 31.12.2026 fällig");
      await restlaufzeiten.saveRestlaufzeiten(actor, 2025, {
        jahr: [
          { account: k.ges, ueber1Jahr: 100_000 },
          { account: k.verb, ueber1Jahr: 300_000 },
        ],
        vorjahr: null,
      });
      const ansicht = (await restlaufzeiten.restlaufzeitenAnsicht(2026))!;
      expect(ansicht.vorjahr).toMatchObject({ stand: "bestaetigt" });
      expect(ansicht.vorjahr?.zeilen.find((z) => z.account === k.ges)).toMatchObject({ wert: 100_000 });
      expect(ansicht.jahr.stand).toBe("fehlt");
      // Auch im laufenden Jahr schon vorzubereiten
      expect((await restlaufzeiten.restlaufzeitenAnsicht(2027))?.jahr.stand).toBe("fehlt");
    });
  });
});
