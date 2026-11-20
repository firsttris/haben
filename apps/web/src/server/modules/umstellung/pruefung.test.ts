import { ACCOUNTS, formatEuro } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Prüfung beim Update auf das Journal als einzige Quelle (#1116): In Jahren vor dem früheren Stichjahr muss das Journal zu
 * Gemeldetem und Gespeichertem passen (gesendete Voranmeldungen und Jahreserklärungen, Verprobung, Rechnung und Vorgang gegen
 * Buchung). Je SKR03 und SKR04, Ist und Soll.
 */

function dkbCsv(rows: string[][], iban = "DE12 1203 0000 1234 5678 90") {
  const header = `"Girokonto";"${iban}"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const eingang = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

describe.skipIf(!testDatabaseUrl)("Prüfung beim Update auf das Journal (Postgres)", () => {
  let sql: postgres.Sql;
  let umstellung: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  const actor = "test-user";
  const today = "2026-10-04";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    umstellung = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    bank = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    annual = await import("../jahreserklaerung/annual.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  /** Wie eine Instanz nach den Migrationen: Stichjahr 2027 übernommen, Umstellung offen */
  async function reset(kr: "SKR03" | "SKR04", v: "ist" | "soll") {
    await leeren(
      sql,
    )`truncate journal_umstellung, annual_submission_figures, annual_submissions, vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions, bank_imports,
      bank_accounts, journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${v}, ${kr})`;
    await sql`insert into journal_umstellung (stichjahr_vorher, ergebnis) values (2027, 'offen')`;
  }
  async function invoice(issueDate: string, steuerfrei = false) {
    const c = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const d = await invoices.createDraft(actor, {
      contactId: c.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "L", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: steuerfrei ? 0 : 1900 }],
      ...(steuerfrei ? { taxTreatment: "steuerfrei" as const, exemptionReason: "Steuerfrei nach § 4 Nr. 14 UStG" } : {}),
    });
    return invoices.finalizeInvoice(actor, d.id, kleinunternehmerStand);
  }
  async function pay(invoiceId: string, date: string, amount: string) {
    const purpose = crypto.randomUUID();
    await bank.importStatement(actor, { bytes: dkbCsv([eingang(date, purpose, amount)]), filename: `${purpose}.csv` }, null);
    const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount: Number(tx!.amount) });
  }
  async function beleg(date: string, payment: "privat" | "bank" = "privat") {
    docSeq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq, 7, 9]), filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment,
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
      privateShare: 0,
      reverseCharge: null,
    });
    await documents.bookDocument(actor, id);
  }
  /** Gesendete Voranmeldung mit den Werten, die Haben heute rechnet, und `delta` auf Kz 81 */
  async function gesendet(month: number, delta = 0) {
    const werte = await vat.computedValues({ year: 2026, month });
    await sql`insert into vat_returns ${sql({ year: 2026, month, ...werte, kz81: werte.kz81 + delta, status: "sent", source: "berechnet", sent_at: new Date().toISOString() } as never)}`;
  }
  /**
   * Daten wie aus einer Version vor v0.7.0: Steuerschlüssel bzw. Bemessungsgrundlage an der Zahlung fehlen (#551, #552).
   * `passtNicht`: Die Zahlung bucht einen Cent weniger Umsatzsteuer, als Haben heute aus Rechnung und Anteil buchen würde;
   * dann bleibt sie auch beim Lesen, wie gebucht (#1502). Das Update auf das Journal (erste Zeile in journal_umstellung)
   * liegt danach hinter den Buchungen, wie bei einer Instanz, die vor dem Update gebucht hat; `nachDemUpdate`: die Buchungen
   * danach, also wie aus einer neuen Version.
   */
  async function alteBuchung(kr: "SKR03" | "SKR04", v: "ist" | "soll", passtNicht = false, nachDemUpdate = false) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      if (!nachDemUpdate) await tx`update journal_umstellung set at = clock_timestamp()`;
      if (v === "ist") await tx`update journal_lines set basis = null where basis is not null`;
      else await tx`update journal_lines set tax_code = null where account = ${kr === "SKR03" ? "8400" : "4400"}`;
      if (v === "ist" && passtNicht) {
        const zahlung = sql`select id from journal_entries where source_type = 'allocation'`;
        await tx`update journal_lines set credit = credit - 1 where account = ${ACCOUNTS[kr].ust[1900]} and credit > 0 and entry_id in (${zahlung})`;
        await tx`update journal_lines set debit = debit - 1 where account = ${ACCOUNTS[kr].ustNichtFaellig[1900]} and debit > 0 and entry_id in (${zahlung})`;
      }
    });
  }
  /** Jahreserklärung wie übermittelt bzw. vermerkt; `figures` wie in annualXml bzw. vermerkeJahresabgabe */
  async function erklaert(form: "ust" | "euer", kind: "send" | "vermerk", figures: Record<string, unknown>) {
    await sql`insert into annual_submissions (form, year, kind, ok, code, message, transfer_ticket, figures, request_xml, response_xml, server_response_xml)
      values (${form}, 2026, ${kind}, true, 0, 'ok', ${crypto.randomUUID()}, ${JSON.stringify(figures)}::jsonb, '', '', '')`;
  }
  const stand = async () => (await sql`select ergebnis, stichjahr_vorher, befunde from journal_umstellung order by id desc limit 1`)[0];

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const v of ["ist", "soll"] as const) {
      it(`besteht, wenn alles gleich herauskommt, auch mit gesendeter Voranmeldung; danach nichts mehr zu prüfen (${kr}, ${v})`, async () => {
        await reset(kr, v);
        const inv = await invoice("2026-03-10");
        await pay(inv.id, "20.04.2026", "119,00");
        await beleg("2026-04-02");
        await gesendet(3);
        const ergebnis = await umstellung.umstellungPruefen(today, [], "1.0.0");
        expect(ergebnis.status).toBe("gespeichert");
        expect(await stand()).toEqual({ ergebnis: "bestanden", stichjahr_vorher: 2027, befunde: [] });
        const [log] = await sql`select actor from audit_log where table_name = 'journal_umstellung' order by seq desc limit 1`;
        expect(log).toEqual({ actor: "system:umstellung" });
        expect((await umstellung.umstellungPruefen(today)).status).toBe("fertig");
      }, 60_000);

      it(`gesendete Voranmeldung weicht ab: startet nicht, ändert nichts; übernommen gilt das Journal (${kr}, ${v})`, async () => {
        await reset(kr, v);
        await invoice("2026-03-10");
        await gesendet(3, 100);
        const ergebnis = await umstellung.umstellungPruefen(today);
        expect(ergebnis).toEqual({
          status: "abweichung",
          befunde: [
            {
              jahr: 2026,
              text: expect.stringMatching(/^2026-03 Gesendete Voranmeldung, Kz 81: im Journal .*, gesendet /),
              // Seit #1229 auch Bereich, Schlüssel und Beträge, unabhängig vom Text
              bereich: "ustva",
              schluessel: "gesendet:2026-03:Kz 81",
              journal: expect.any(Number),
              quelle: expect.any(Number),
            },
          ],
        });
        expect((await stand())!.ergebnis).toBe("offen");
        // Ein anderes Jahr zu übernehmen reicht nicht
        expect((await umstellung.umstellungPruefen(today, [2025])).status).toBe("abweichung");
        expect((await umstellung.umstellungPruefen(today, [2026])).status).toBe("gespeichert");
        expect(await stand()).toEqual({ ergebnis: "uebernommen", stichjahr_vorher: 2027, befunde: (ergebnis as { befunde: unknown }).befunde });
        // Die Integritätsprüfung blendet nur die übernommenen Befunde aus und sagt es (Vorschlag von thomas-baumeister in
        // #1144); eine neue Abweichung im selben Jahr meldet sie weiter, in der Integritätsprüfung wie vor dem Senden
        const jahr = await abgleich.abgleichJahr(2026, today);
        expect(jahr.zeilen.filter((z) => z.bereich === "ustva")).toEqual([]);
        expect(jahr.hinweise.join()).toMatch(/Für 2026 sind beim Update auf das Journal 1 Abweichung übernommen worden/);
        await gesendet(4, 200);
        expect(abgleich.abweichungen((await abgleich.abgleichJahr(2026, today)).zeilen)).toEqual([
          expect.objectContaining({ bereich: "ustva", zeitraum: "2026-04", posten: "Gesendete Voranmeldung, Kz 81" }),
        ]);
      }, 60_000);

      it(`übernommene Abweichung im März blendet dieselbe Abweichung im April nicht aus (${kr}, ${v})`, async () => {
        await reset(kr, v);
        await invoice("2026-03-10");
        await invoice("2026-04-10");
        await gesendet(3, 100);
        expect((await umstellung.umstellungPruefen(today, [2026])).status).toBe("gespeichert");
        // Gleiche Kennzahl, gleiche Beträge, anderer Monat: eine neue Abweichung
        await gesendet(4, 100);
        expect(abgleich.abweichungen((await abgleich.abgleichJahr(2026, today)).zeilen)).toEqual([
          expect.objectContaining({ bereich: "ustva", zeitraum: "2026-04", posten: "Gesendete Voranmeldung, Kz 81" }),
        ]);
      }, 60_000);

      it(`ältere Buchungen ohne Steuerschlüssel bzw. Bemessungsgrundlage: die Verprobung nennt Monat und Buchung (${kr}, ${v})`, async () => {
        await reset(kr, v);
        const inv = await invoice("2026-03-10");
        await pay(inv.id, "20.04.2026", "119,00");
        await alteBuchung(kr, v, true);
        const ergebnis = await umstellung.umstellungPruefen(today);
        expect(ergebnis.status).toBe("abweichung");
        const befunde = (ergebnis as { befunde: { jahr: number; text: string }[] }).befunde;
        // Steuer ohne passende Bemessungsgrundlage: 19 € Umsatzsteuer auf 0 € (bei Ist an der Zahlung im April, die einen Cent
        // weniger bucht als heute und deshalb bleibt, wie gebucht; bei Soll an der Rechnung im März)
        const steuer = v === "ist" ? 18_99 : 19_00;
        expect(befunde).toContainEqual({
          jahr: 2026,
          text: expect.stringMatching(
            new RegExp(
              `^2026-${v === "ist" ? "04" : "03"} Umsatzsteuer 19 % zur Bemessungsgrundlage ${formatEuro(0)}: Buchung .*: im Journal ${formatEuro(steuer)}, aus der Bemessungsgrundlage ${formatEuro(0)}$`,
            ),
          ),
          bereich: "ustva",
          schluessel: expect.stringMatching(/^buchung:[0-9a-f-]+:umsatzsteuer:1900$/),
          journal: steuer,
          quelle: 0,
        });
        expect((await stand())!.ergebnis).toBe("offen");
      }, 60_000);

      // #1229: Übernommene Befunde erkennt der Abgleich an Bereich, Schlüssel und Beträgen wieder, nicht am Anzeigetext. Eine
      // spätere Version kann den Text ändern (formatEuro, Posten), ohne dass alle übernommenen Befunde wieder auftauchen; ein
      // gleicher Text an einer anderen Buchung bleibt ein neuer Befund. Ältere Befunde ohne Schlüssel erkennt er weiter am Text.
      it(`übernommener Befund: erkannt an Schlüssel und Beträgen, nicht am Text; ältere am Text (${kr}, ${v})`, async () => {
        await reset(kr, v);
        const inv = await invoice("2026-03-10");
        await pay(inv.id, "20.04.2026", "119,00");
        await alteBuchung(kr, v, true);
        expect((await umstellung.umstellungPruefen(today, [2026])).status).toBe("gespeichert");
        const befunde = (await stand())!.befunde as { jahr: number; text: string; schluessel?: string }[];
        const verprobung = befunde.filter((b) => b.schluessel?.endsWith(":umsatzsteuer:1900"));
        expect(verprobung).toHaveLength(1);
        const mitBuchung = (zeilen: Parameters<typeof abgleich.abweichungen>[0]) =>
          abgleich.abweichungen(zeilen).filter((z) => z.posten.includes(": Buchung „"));
        // Im Jahr je Monat und in der Vorprüfung des Quartals (der Schlüssel nennt keinen Zeitraum)
        const quartal = { year: 2026, month: v === "ist" ? 42 : 41 };
        const offen = async () => [
          ...mitBuchung((await abgleich.abgleichJahr(2026, today)).zeilen),
          ...mitBuchung((await abgleich.vatAbgleich(quartal)).zeilen),
        ];
        expect(await offen()).toEqual([]);
        const uebernommen = (liste: unknown[]) =>
          sql`insert into journal_umstellung (stichjahr_vorher, ergebnis, befunde) values (2027, 'uebernommen', ${JSON.stringify(liste)}::jsonb)`;
        // Anderer Anzeigetext, derselbe Posten: bleibt ausgeblendet
        await uebernommen(befunde.map((b) => ({ ...b, text: `${b.text} (Text einer späteren Version)` })));
        expect(await offen()).toEqual([]);
        // Gleicher Text, aber eine andere Buchung: ein neuer Befund
        await uebernommen(befunde.map((b) => ({ ...b, schluessel: b.schluessel?.replace(/^buchung:[^:]+/, "buchung:00000000-0000-0000-0000-000000000000") })));
        expect(await offen()).toHaveLength(2);
        // Gespeichert vor #1229, nur mit Text: weiter am Text erkannt
        await uebernommen(befunde.map(({ jahr, text }) => ({ jahr, text })));
        expect(await offen()).toEqual([]);
      }, 60_000);

      it(`ältere Zahlungen ohne Bemessungsgrundlage, mit Steuer und steuerfrei: Voranmeldung und Erklärung wie damals, besteht (#1502) (${kr}, ${v})`, async () => {
        await reset(kr, v);
        const inv = await invoice("2026-03-10");
        const frei = await invoice("2026-03-12", true);
        await pay(inv.id, "20.04.2026", "119,00");
        await pay(frei.id, "21.04.2026", "100,00");
        // So meldete 0.9 aus dem Nebenbuch: gesendet bzw. vermerkt, bevor die Zahlungen wie vor v0.7.0 aussehen
        await gesendet(4);
        const ust = await annual.ustYear(2026);
        await erklaert("ust", "vermerk", { amount: ust.abschluss, berechnet: ust.abschluss, abweichung: 0, abweichungBestaetigt: false, steuer: ust.steuer });
        const april = await vat.computedValues({ year: 2026, month: 4 });
        // Bei Ist meldet erst die Zahlung Kz 81 und 48 (steuerfrei), über die Bemessungsgrundlage an Umsatzsteuer- bzw.
        // Forderungszeile; vor v0.7.0 trug sie keine. Gebucht bleibt, wie es ist; gelesen wird die Zahlung wie heute. Bei Soll
        // meldet die Rechnung, die Zahlung trägt keine Bemessungsgrundlage.
        if (v === "ist") await alteBuchung(kr, v);
        expect(await vat.computedValues({ year: 2026, month: 4 })).toEqual(april);
        expect((await annual.ustYear(2026)).steuer).toBe(ust.steuer);
        expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
        expect((await umstellung.umstellungPruefen(today)).status).toBe("gespeichert");
        expect((await stand())!.ergebnis).toBe("bestanden");
        // Die Buchungen selbst sind unverändert
        if (v === "ist") expect((await sql`select count(*)::int as n from journal_lines where basis is not null`)[0]).toEqual({ n: 0 });
      }, 60_000);

      it(`ältere Zahlung, deren Steuer nicht zur Rechnung passt: bleibt, wie gebucht, Befund; übernommen nicht wieder (${kr}, ${v})`, async () => {
        await reset(kr, v);
        const inv = await invoice("2026-03-10");
        await pay(inv.id, "20.04.2026", "119,00");
        // Bei Ist meldet erst die Zahlung Kz 81, über die Bemessungsgrundlage an der Umsatzsteuerzeile; vor v0.7.0 trug sie
        // keine. Bucht sie einen Cent weniger Steuer, als Haben heute buchen würde, bleibt sie beim Lesen, wie gebucht: Dann
        // melden die Verprobung die Steuer ohne Bemessungsgrundlage und „Vorgang gegen Buchung“ den Rest auf „nicht fällig“
        // und die gemeldete Bemessungsgrundlage der erledigten Rechnung. Bei Soll meldet die Rechnung selbst; die Befunde
        // dort gelten ihrer Buchung ohne Steuerschlüssel, keiner der Zahlung.
        await alteBuchung(kr, v, true);
        const ergebnis = await umstellung.umstellungPruefen(today);
        if (v === "soll") {
          expect(ergebnis.status).toBe("abweichung");
          const befunde = (ergebnis as { befunde: { text: string }[] }).befunde;
          expect(befunde.filter((b) => b.text.includes("Zahlung"))).toEqual([]);
          return;
        }
        expect(ergebnis).toEqual({
          status: "abweichung",
          befunde: [
            {
              jahr: 2026,
              text: expect.stringMatching(
                new RegExp(
                  `^2026-04 Umsatzsteuer 19 % zur Bemessungsgrundlage ${formatEuro(0)}: Buchung „Zahlung ${inv.number} .*: im Journal ${formatEuro(18_99)}, aus der Bemessungsgrundlage ${formatEuro(0)}$`,
                ),
              ),
              bereich: "ustva",
              schluessel: expect.stringMatching(/^buchung:[0-9a-f-]+:umsatzsteuer:1900$/),
              journal: 18_99,
              quelle: 0,
            },
            {
              jahr: 2026,
              text: `2026-03 Rechnung ${inv.number} (Ist, ganz erledigt): Umsatzsteuer nicht fällig: im Journal ${formatEuro(-1)}, laut Vorgang ${formatEuro(0)}`,
              bereich: "beleg",
              schluessel: `rechnung:${inv.id}:nicht-faellig`,
              journal: -1,
              quelle: 0,
            },
            {
              jahr: 2026,
              text: `2026-03 Rechnung ${inv.number} (Ist, ganz erledigt): gemeldete Bemessungsgrundlage: im Journal ${formatEuro(0)}, laut Vorgang ${formatEuro(100_00)}`,
              bereich: "beleg",
              schluessel: `rechnung:${inv.id}:bemessung`,
              journal: 0,
              quelle: 100_00,
            },
          ],
        });
        expect((await stand())!.ergebnis).toBe("offen");
        // Übernommen: Die übernommenen Abweichungen meldet die Integritätsprüfung nicht jede Woche wieder
        expect((await umstellung.umstellungPruefen(today, [2026])).status).toBe("gespeichert");
        const jahr = await abgleich.abgleichJahr(2026, today);
        expect(abgleich.abweichungen(jahr.zeilen)).toEqual([]);
        expect(jahr.hinweise.join()).toMatch(/Für 2026 sind beim Update auf das Journal 3 Abweichungen übernommen worden/);
      }, 60_000);

      it(`übermittelte bzw. vermerkte Jahreserklärung: gleich besteht, abweichend nennt sie Erklärung und Feld (${kr}, ${v})`, async () => {
        await reset(kr, v);
        const inv = await invoice("2026-03-10");
        await pay(inv.id, "20.04.2026", "119,00");
        await beleg("2026-04-02");
        const euer = await annual.euerYear(2026);
        const ust = await annual.ustYear(2026);
        await erklaert("euer", "send", { ...euer.figures, gewinn: euer.gewinn, anlagen: [] });
        await erklaert("ust", "send", { ...ust.figures, steuer: ust.steuer, abschluss: ust.abschluss });
        expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
        // Übermittelt mit 1 € mehr Gewinn, vermerkt mit einer bestätigten Abweichung und 2 € weniger Abschlusszahlung damals, also 2 € weniger Steuer
        await leeren(sql)`truncate annual_submission_figures, annual_submissions`;
        await erklaert("euer", "send", { ...euer.figures, gewinn: euer.gewinn + 100 });
        await erklaert("ust", "vermerk", { amount: 5_00, berechnet: ust.abschluss - 200, abweichung: 5_00 - ust.abschluss + 200, abweichungBestaetigt: true });
        const ergebnis = await umstellung.umstellungPruefen(today);
        expect(ergebnis).toEqual({
          status: "abweichung",
          befunde: [
            {
              jahr: 2026,
              text: `2026 Anlage EÜR (übermittelt), gewinn: im Journal ${formatEuro(euer.gewinn)}, übermittelt ${formatEuro(euer.gewinn + 100)}`,
              bereich: "euer",
              schluessel: "erklaert:2026:euer:übermittelt:gewinn",
              journal: euer.gewinn,
              quelle: euer.gewinn + 100,
            },
            {
              jahr: 2026,
              // Älterer Vermerk ohne festgehaltene Zahlen: verglichen wird die Steuer, damals Abschlusszahlung plus Vorauszahlungen (#1231)
              text: `2026 Umsatzsteuererklärung (vermerkt), steuer: im Journal ${formatEuro(ust.steuer)}, beim Vermerk gerechnet ${formatEuro(ust.steuer - 200)}`,
              bereich: "ustva",
              schluessel: "erklaert:2026:ust:vermerkt:steuer",
              journal: ust.steuer,
              quelle: ust.steuer - 200,
            },
          ],
        });
        expect((await stand())!.ergebnis).toBe("offen");
        // Auch jede Woche, nicht nur beim Update (Vorschlag von thomas-baumeister in #1144): Integritätsprüfung und Prüfwert-Mail
        // bekommen die Jahreserklärungen dazu; übernommene Befunde meldet sie danach nicht wieder
        const jahreserklaerung = await import("../jahreserklaerung/index.ts");
        const integrity = await import("../auswertungen/integrity.ts");
        const erklaerte = async () =>
          (await integrity.checkIntegrity(today, jahreserklaerung.erklaerteAbweichungsZeilen)).abgleich.abweichungen.filter(
            (z) => z.zeitraum === "2026" && z.posten.includes("("),
          );
        expect((await erklaerte()).map((z) => z.posten)).toEqual(["Anlage EÜR (übermittelt), gewinn", "Umsatzsteuererklärung (vermerkt), steuer"]);
        expect((await umstellung.umstellungPruefen(today, [2026])).status).toBe("gespeichert");
        expect(await erklaerte()).toEqual([]);
      }, 60_000);

      it(`Beleg aus 0.9 mit Leistungsdatum nach dem Belegdatum, vor #930 gebucht: Vorsteuer im Belegmonat, kein Befund (${kr}, ${v})`, async () => {
        await reset(kr, v);
        await beleg("2026-04-02", "bank");
        // 0.9 erfasste den Leistungszeitraum schon (#879), buchte die Vorsteuer aber noch im Belegmonat. Solche Belege zählen
        // weiter nach dem Belegdatum (#930, „Bestand“); erst neue Buchungen legen sie bis zur Ausführung auf das Zwischenkonto.
        await sql.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx`update documents set service_from = '2026-05-10', service_to = '2026-05-20'`;
        });
        expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
      }, 60_000);

      it(`Buchung passt nicht zum Beleg, Voranmeldung schon: Beleg und Konto im Befund, nichts gespeichert (${kr}, ${v})`, async () => {
        await reset(kr, v);
        await beleg("2026-04-02");
        // An Haben vorbei: der Aufwand des privat bezahlten Belegs im Journal um 1 € höher (Gegenbuchung auf das Privatkonto).
        // Die Vorsteuer und damit die Voranmeldung bleibt gleich, die EÜR aus dem Journal nicht; das zeigt „Vorgang gegen Buchung“.
        await sql.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          const [aufwand] = await tx`select l.id, l.entry_id from journal_lines l join journal_entries e on e.id = l.entry_id
            where e.source_type = 'document' and l.tax_code = 'VSt19' and l.debit = 10000`;
          await tx`update journal_lines set debit = debit + 100 where id = ${aufwand!.id}`;
          await tx`update journal_lines set credit = credit + 100 where entry_id = ${aufwand!.entry_id} and credit > 0`;
        });
        const ergebnis = await umstellung.umstellungPruefen(today);
        expect(ergebnis.status).toBe("abweichung");
        const aufwandskonto = kr === "SKR03" ? "4806" : "6495";
        expect((ergebnis as { befunde: unknown[] }).befunde).toContainEqual({
          jahr: 2026,
          text: expect.stringMatching(
            new RegExp(`^2026-04 Beleg R\\d+ \\(Lieferant\\): Konto ${aufwandskonto}: im Journal ${formatEuro(101_00)}, laut Vorgang ${formatEuro(100_00)}$`),
          ),
          bereich: "beleg",
          schluessel: expect.stringMatching(new RegExp(`^buchung:[0-9a-f-]+:${aufwandskonto}$`)),
          journal: 101_00,
          quelle: 100_00,
        });
        expect((await stand())!.ergebnis).toBe("offen");
      }, 60_000);
    }

  for (const kr of ["SKR03", "SKR04"] as const)
    it(`Zahlung ohne Bemessungsgrundlage, nach dem Update gebucht: bleibt, wie gebucht, die Verprobung meldet sie (#1502) (${kr}, ist)`, async () => {
      await reset(kr, "ist");
      const inv = await invoice("2026-03-10");
      await pay(inv.id, "20.04.2026", "119,00");
      // Eine neue Version bucht die Bemessungsgrundlage immer; fehlt sie, ist das ein Fehler, den die Prüfung zeigen soll
      await alteBuchung(kr, "ist", false, true);
      expect(await umstellung.umstellungBefunde(2027, today)).toContainEqual(
        expect.objectContaining({
          bereich: "ustva",
          schluessel: expect.stringMatching(/^buchung:[0-9a-f-]+:umsatzsteuer:1900$/),
          journal: 19_00,
          quelle: 0,
        }),
      );
      expect((await vat.computedValues({ year: 2026, month: 4 })).kz81).toBe(0);
    }, 60_000);

  it("vermerkte Umsatzsteuererklärung, danach die Voranmeldungen des Jahres vermerkt: Journal unverändert, kein Befund", async () => {
    await reset("SKR03", "soll");
    await invoice("2026-03-10");
    const vorher = await annual.ustYear(2026);
    // Erklärung außerhalb von Haben abgegeben, bevor die Voranmeldungen in Haben standen: Haben rechnete die volle Steuer als
    // Abschlusszahlung, die Abweichung zum Protokoll (Steuer abzüglich Vorauszahlung) wurde bestätigt
    const kz83 = (await vat.computedValues({ year: 2026, month: 3 })).kz83;
    await erklaert("ust", "vermerk", {
      amount: vorher.steuer - kz83,
      berechnet: vorher.abschluss,
      abweichung: vorher.steuer - kz83 - vorher.abschluss,
      abweichungBestaetigt: true,
    });
    // Die Voranmeldung März wird nachgetragen; an den Buchungen ändert sich nichts, Haben rechnet jetzt den Betrag laut Protokoll
    await gesendet(3);
    expect((await annual.ustYear(2026)).abschluss).toBe(vorher.steuer - kz83);
    expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
  }, 60_000);

  it("ohne Buchungen vor dem Stichjahr besteht sie sofort; ohne offene Umstellung gibt es nichts zu tun", async () => {
    await reset("SKR03", "soll");
    expect((await umstellung.umstellungPruefen(today)).status).toBe("gespeichert");
    expect((await stand())!.ergebnis).toBe("bestanden");
    await leeren(sql)`truncate journal_umstellung`;
    expect(await umstellung.umstellungPruefen(today)).toEqual({ status: "fertig", stand: null });
  }, 60_000);
  describe("Review #1502: Teilzahlung, Storno nach dem Update, Bareinnahme, Kontenrahmenwechsel", () => {
    const summeKz81 = async (monate: [number, number][]) => {
      let s = 0;
      for (const [year, month] of monate) s += (await vat.computedValues({ year, month })).kz81;
      return s;
    };
    for (const kr of ["SKR03", "SKR04"] as const) {
      it(`ältere Teilzahlungen ohne Bemessungsgrundlage: wie heute gelesen, kein Befund (${kr}, ist)`, async () => {
        await reset(kr, "ist");
        const inv = await invoice("2026-03-10");
        await pay(inv.id, "20.04.2026", "50,00");
        await pay(inv.id, "20.05.2026", "69,00");
        const vorher = [await vat.computedValues({ year: 2026, month: 4 }), await vat.computedValues({ year: 2026, month: 5 })];
        await alteBuchung(kr, "ist");
        expect([await vat.computedValues({ year: 2026, month: 4 }), await vat.computedValues({ year: 2026, month: 5 })]).toEqual(vorher);
        expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
      }, 60_000);

      it(`ältere Zuordnung nach dem Update aufgehoben: Storno wie heute gelesen, kein Befund (${kr}, ist)`, async () => {
        await reset(kr, "ist");
        const inv = await invoice("2026-03-10");
        await pay(inv.id, "20.04.2026", "119,00");
        await alteBuchung(kr, "ist");
        const [a] = await sql`select id from allocations where invoice_id = ${inv.id}`;
        await bank.reverseAllocation(actor, a!.id, "2026-05-05");
        const april = (await vat.computedValues({ year: 2026, month: 4 })).kz81;
        expect(april).not.toBe(0);
        expect((await vat.computedValues({ year: 2026, month: 5 })).kz81).toBe(-april);
        expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
      }, 60_000);

      it(`ältere Bareinnahme nach dem Update storniert: kein Befund, Kz 81 zurück (${kr}, ist)`, async () => {
        await reset(kr, "ist");
        await leeren(sql)`truncate cash_entries cascade`;
        const inv = await invoice("2026-03-10");
        const bar = await bank.createCashInvoiceEntry(actor, { invoiceId: inv.id, date: "2026-04-20", amount: 119_00 }, today);
        await alteBuchung(kr, "ist");
        await bank.reverseCashEntry(actor, bar.id, "2026-05-05");
        const april = (await vat.computedValues({ year: 2026, month: 4 })).kz81;
        expect(april).not.toBe(0);
        expect((await vat.computedValues({ year: 2026, month: 5 })).kz81).toBe(-april);
        expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
      }, 60_000);
    }

    it("ältere Zuordnung in SKR03, nach Wechsel auf SKR04 aufgehoben: Storno wie heute gelesen, kein Befund (ist)", async () => {
      await reset("SKR03", "ist");
      const inv = await invoice("2025-11-10");
      await pay(inv.id, "20.11.2025", "119,00");
      await alteBuchung("SKR03", "ist");
      await sql`update company set kontenrahmen = 'SKR04'`;
      const [a] = await sql`select id from allocations where invoice_id = ${inv.id}`;
      await bank.reverseAllocation(actor, a!.id, "2026-02-02");
      const nov = await summeKz81([[2025, 11]]);
      expect(nov).not.toBe(0);
      expect(await summeKz81([[2026, 2]])).toBe(-nov);
      expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
    }, 60_000);

    const kennzahlen = async (monate: number[]) => {
      const werte = [];
      for (const month of monate) werte.push(await vat.computedValues({ year: 2026, month }));
      return werte;
    };
    const mitBasis = async () => (await sql`select count(*)::int as n from journal_lines where basis is not null`)[0]!.n;

    it("Sammellastschrift, Rücklastschrift mit Entgelt und neue Teilzahlung, alle von vor dem Update: wie heute gelesen, kein Befund (SKR03, ist)", async () => {
      await reset("SKR03", "ist");
      await sql`update company set glaeubiger_id = 'DE98ZZZ09999999999', bic = 'COBADEFFXXX', bank = 'Commerzbank' where id = 1`;
      const mandates = await import("../stammdaten/sepa-mandate.ts");
      const accountId = (await bank.createAccount(actor, { name: "Geschäftskonto", iban: "DE89370400440532013000" })).id;
      const kunde = "DE02120300000000202051";
      const contactId = (
        await contacts.createContact(actor, {
          kundennummer: "",
          name: "Nordwerk Software GmbH",
          strasse: "Hafenstraße 5",
          plz: "20457",
          ort: "Hamburg",
          land: "DE",
          email: "rechnung@nordwerk.example",
          ustId: "",
          iban: kunde,
          leitwegId: "",
          defaultFormat: null,
        })
      ).id;
      const mandat = {
        reference: "KD-1042-01",
        signedOn: "2026-03-01",
        scheme: "CORE",
        firstSequence: "FRST",
        debtorName: "Nordwerk Software GmbH",
        debtorIban: kunde,
      } as const;
      const sepaMandateId = await mandates.createMandate(actor, contactId, mandat, "2026-04-01");
      const lastschrift = async (net: number) => {
        const lines = [{ description: "Wartung", quantity: 1000, unit: "Monat", unitPrice: net, taxRate: 1900 as const }];
        const draft = { contactId, issueDate: "2026-04-02", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd" as const, note: "" };
        const d = await invoices.createDraft(actor, { ...draft, lines, paymentMethod: "lastschrift", sepaMandateId });
        return invoices.finalizeInvoice(actor, d.id, kleinunternehmerStand);
      };
      const a = await lastschrift(25_001);
      const b = await lastschrift(10_000);
      await bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [a.id, b.id] }, new Date("2026-04-09T08:00:00Z"));
      // Kontoauszug des Geschäftskontos (IBAN wie oben); Rücklastschrift als Ausgang an den Kunden
      const umsatz = async (date: string, purpose: string, amount: string) => {
        const aus = amount.startsWith("-");
        const zeile = [
          date,
          date,
          "Gebucht",
          aus ? "Testfirma" : "SEPA Lastschrifteinzug",
          aus ? "Nordwerk Software GmbH" : "Testfirma",
          purpose,
          aus ? "Ausgang" : "Eingang",
          aus ? kunde : "",
          amount,
          "",
          "",
          "",
        ];
        const bytes = dkbCsv([zeile], "DE89 3704 0044 0532 0130 00");
        await bank.importStatement(actor, { bytes, filename: `${crypto.randomUUID()}.csv` }, null);
        const [tx] = await sql`select id from bank_transactions where purpose = ${purpose}`;
        return tx!.id as string;
      };
      await bank.allocateDirectDebitBatch(actor, await umsatz("16.04.2026", "SEPA-Lastschrift Sammler", "416,51"));
      await bank.allocateDirectDebitReturn(actor, await umsatz("12.05.2026", `RUECKLASTSCHRIFT AM04 KD-1042-01 Rechnung ${a.number}`, "-300,51"));
      await bank.allocate(actor, {
        kind: "invoice",
        transactionId: await umsatz("20.06.2026", `Rechnung ${a.number} Teil`, "100,01"),
        invoiceId: a.id,
        amount: 10_001,
      });
      // Die Rücklastschrift ist eine negative Zuordnung mit Bezug auf die Lastschrift, das Entgelt ein eigener Teil
      expect(await sql`select amount::int from allocations where direct_debit_item_id is not null and amount < 0`).toEqual([{ amount: -29_751 }]);
      const vorher = await kennzahlen([4, 5, 6]);
      expect(vorher.map((k) => k.kz81)).toEqual([35_000, -25_000, 8_400]);
      await alteBuchung("SKR03", "ist");
      expect(await mitBasis()).toBe(0);
      expect(await kennzahlen([4, 5, 6])).toEqual(vorher);
      expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
    }, 60_000);

    it("Zahlung über PayPal von vor dem Update: die Geldzeile bleibt auf dem Verrechnungskonto, wie heute gelesen, kein Befund (SKR04, ist)", async () => {
      await reset("SKR04", "ist");
      const inv = await invoice("2026-03-10");
      const paypal = await bank.createProviderAccount(actor, { name: "PayPal", provider: "paypal" });
      const csv = [
        `"Datum","Uhrzeit","Zeitzone","Name","Typ","Status","Währung","Brutto","Gebühr","Netto","Transaktionscode","Rechnungsnummer"`,
        `"20.04.2026","10:00:00","CEST","Nordwerk","Website-Zahlung","Abgeschlossen","EUR","119,00","-2,50","116,50","1AB","${inv.number}"`,
      ].join("\n");
      await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "paypal.csv" }, paypal.id);
      const [zahlung] = await sql`select id from bank_transactions where amount = 11900`;
      const [gebuehr] = await sql`select id from bank_transactions where amount = -250`;
      await bank.allocate(actor, { kind: "invoice", transactionId: zahlung!.id, invoiceId: inv.id, amount: 11_900 });
      await bank.allocate(actor, { kind: "gebuehren", transactionId: gebuehr!.id, amount: -250 });
      const vorher = await kennzahlen([4]);
      expect(vorher[0]!.kz81).toBe(100_00);
      await alteBuchung("SKR04", "ist");
      expect(await mitBasis()).toBe(0);
      const konten = (
        await sql`select l.account from journal_lines l join journal_entries e on e.id = l.entry_id
          join allocations a on a.id = e.source_id where e.source_type = 'allocation' and a.invoice_id = ${inv.id}`
      ).map((r) => r.account as string);
      // Geld auf dem Verrechnungskonto des Dienstleisters (SKR04 1461), nicht auf der Bank
      expect(konten).toContain("1461");
      expect(konten).not.toContain(ACCOUNTS.SKR04.bank);
      expect(await kennzahlen([4])).toEqual(vorher);
      expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
    }, 60_000);
  });
});
