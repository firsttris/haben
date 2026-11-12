import { formatEuro } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Jahreserklärung außerhalb von Haben vermerken (#760): Der Betreiber gibt EÜR und Umsatzsteuererklärung extern ab
 * (WISO, Accountable). Der Vermerk hält Tag, Transferticket, Betrag und Protokoll fest, damit die Frist erledigt ist.
 */
describe.skipIf(!testDatabaseUrl)("Jahreserklärungen: Abgabe vermerken (Postgres)", () => {
  let annual: typeof import("./annual.ts");
  let jahresvermerk: typeof import("./vermerk.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const TODAY = "2026-10-02";
  const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);

  beforeAll(async () => {
    sql = await setupTestDb();
    annual = await import("./annual.ts");
    jahresvermerk = await import("./vermerk.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate annual_submissions, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
              einkunftsart, taetigkeit)
      values (1, 'Beispielfirma Nordlicht', 'Hafenstraße 5', '20457', 'Hamburg', 'buchhaltung@example.com', '+49 40 1', '22/113/10010',
              'DE123456789', 'HH', 'DE89370400440532013000', 'ist', 'SKR03', 'selbstaendig', 'Softwareentwicklung')`;
  });

  /** Eingabe mit erfundenem Ticket und Begründung; einzelne Felder lassen sich überschreiben */
  const eingabe = (ticket: string, extra: Partial<import("./vermerk.ts").JahresvermerkInput> = {}) => ({
    filedOn: "2026-05-20",
    transferTicket: ticket,
    amount: 12_345,
    note: "Anlage EÜR außerhalb von Haben mit WISO abgegeben.",
    ...extra,
  });

  /** Der in Haben gerechnete Gewinn der EÜR im leeren Testjahr; die Abweichung hängt davon ab */
  const gerechnet = async () => (await annual.annualOverview(2025, TODAY)).euer.gewinn;

  it("vermerkt eine außerhalb abgegebene Erklärung und findet sie wieder", async () => {
    const berechnet = await gerechnet();
    const row = await jahresvermerk.vermerkeJahresabgabe(
      actor,
      "euer",
      2025,
      { ...eingabe("ABC123456789", { abweichungBestaetigt: true }), file: { bytes: pdf("EUER 2025"), filename: "uebermittlung.pdf" } },
      TODAY,
    );
    expect(row).toMatchObject({ form: "euer", year: 2025, filedOn: "2026-05-20", amount: 12_345, hasPdf: true });

    const liste = await jahresvermerk.jahresvermerke(2025);
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ transferTicket: "ABC123456789", note: "Anlage EÜR außerhalb von Haben mit WISO abgegeben." });

    const uebersicht = await annual.annualOverview(2025, TODAY);
    expect(uebersicht.euer.submitted).toMatchObject({
      filedOn: "2026-05-20",
      transferTicket: "ABC123456789",
      amount: 12_345,
      note: "Anlage EÜR außerhalb von Haben mit WISO abgegeben.",
      hasPdf: true,
    });
    expect(uebersicht.ust.submitted).toBeNull();

    // Die Zeile trägt die Form einer abgeschlossenen Abgabe, damit Verlauf und Protokoll sie wie eine Sendung zeigen
    const [zeile] = await sql`select kind, ok, code, message, transfer_ticket, figures, request_xml, response_xml, server_response_xml
      from annual_submissions`;
    expect(zeile).toMatchObject({
      kind: "vermerk",
      ok: true,
      code: 0,
      message: "Außerhalb von Haben abgegeben",
      transfer_ticket: "ABC123456789",
      figures: { amount: 12_345, berechnet, abweichung: 12_345 - berechnet, abweichungBestaetigt: true },
      request_xml: "",
      response_xml: "",
      server_response_xml: "",
    });
  });

  it("lehnt einen zweiten Vermerk für dasselbe Formular und Jahr ab", async () => {
    await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { abweichungBestaetigt: true }), TODAY);
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("XYZ987654321"), TODAY)).rejects.toThrow(/schon vermerkt/);
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(1);
  });

  it("verhindert einen zweiten Vermerk auch ohne Vorprüfung über den partiellen Unique-Index", async () => {
    await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { abweichungBestaetigt: true }), TODAY);
    await expect(
      sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
        values ('euer', 2025, 'vermerk', true, 0, 'Außerhalb von Haben abgegeben', '{"amount": 1}'::jsonb, '', '', '')`,
    ).rejects.toThrow(/annual_submissions_vermerk/);
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(1);
  });

  it("lehnt ein noch nicht abgelaufenes Jahr ab", async () => {
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2026, eingabe("ABC123456789"), TODAY)).rejects.toThrow(/Ablauf des Jahres/);
    expect(await jahresvermerk.jahresvermerke(2026)).toHaveLength(0);
  });

  it("lehnt ein Jahr vor den Jahreserklärungen ab", async () => {
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2022, eingabe("ABC123456789"), TODAY)).rejects.toThrow(/ab 2023/);
  });

  it("lehnt ein abgeschlossenes Jahr ab", async () => {
    await sql`insert into year_closings (year) values (2025)`;
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789"), TODAY)).rejects.toThrow(/abgeschlossen/);
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(0);
  });

  for (const rechtsform of ["gmbh", "ug"] as const)
    it(`lehnt bei einer Kapitalgesellschaft (${rechtsform}) die Anlage EÜR ab, die Umsatzsteuererklärung nicht`, async () => {
      // Kapitalgesellschaften bilanzieren (§ 6, § 238 HGB); die EÜR nach § 4 Abs. 3 EStG gibt es für sie nicht
      await sql`update company set rechtsform = ${rechtsform} where id = 1`;
      await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { abweichungBestaetigt: true }), TODAY)).rejects.toThrow(
        /Kapitalgesellschaft/,
      );
      expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(0);
      await jahresvermerk.vermerkeJahresabgabe(actor, "ust", 2025, eingabe("DEF123456789", { abweichungBestaetigt: true }), TODAY);
      expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(1);
    });

  it("lehnt ein schon verwendetes Transferticket ab", async () => {
    await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { abweichungBestaetigt: true }), TODAY);
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "ust", 2025, eingabe("ABC123456789"), TODAY)).rejects.toThrow(/Transferticket/);
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(1);
  });

  it("lehnt einen Tag der Abgabe in der Zukunft ab", async () => {
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { filedOn: "2027-01-05" }), TODAY)).rejects.toThrow(/Zukunft/);
  });

  it("meldet eine Abweichung zum gerechneten Betrag als Hinweis", async () => {
    const pruefung = await jahresvermerk.vermerkPruefung("ust", 2025, 500);
    expect(pruefung.berechnet).toBe(0);
    expect(pruefung.abweichung).toBe(500);
    expect(pruefung.hinweis).toContain("weicht");
  });

  it("lehnt einen Tag der Abgabe vor dem Ende des Erklärungsjahres ab", async () => {
    // Die Erklärung 2025 kann frühestens am 1. Januar 2026 abgegeben worden sein
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { filedOn: "2025-06-01" }), TODAY)).rejects.toThrow(
      /vor dem Ende/,
    );
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(0);
  });

  it("lehnt einen Vermerk ab, wenn die Erklärung schon über Haben übermittelt wurde", async () => {
    await sql`insert into annual_submissions (form, year, kind, ok, code, message, transfer_ticket, figures,
                request_xml, response_xml, server_response_xml)
      values ('euer', 2025, 'send', true, 0, 'Erfolgreich übermittelt', 'SEND123456789', '{}'::jsonb, '', '', '')`;
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789"), TODAY)).rejects.toThrow(/schon über Haben übermittelt/);
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(0);
  });

  it("sperrt rückdatierte Buchungen in dem Jahr, dessen Erklärung vermerkt ist", async () => {
    const { periodReported } = await import("../buchhaltung/index.ts");
    const { db } = await import("../../db/index.ts");
    expect(await periodReported(db, "2025-11-05")).toBe(false);
    // Betrag weicht vom gerechneten Wert ab, die Bestätigung ist Teil dieses Wegs
    await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { abweichungBestaetigt: true }), TODAY);
    // Ein Vermerk meldet das Jahr wie eine echte Übermittlung: danach ist keine rückdatierte Buchung mehr möglich
    expect(await periodReported(db, "2025-11-05")).toBe(true);
  });

  it("lehnt einen abweichenden Betrag ohne Bestätigung ab und nennt beide Beträge", async () => {
    const berechnet = await gerechnet();
    const amount = berechnet + 12_345;
    const fehler = await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { amount }), TODAY).catch((error: unknown) => error);
    expect(fehler).toBeInstanceOf(annual.AnnualError);
    const meldung = (fehler as Error).message;
    expect(meldung).toContain(formatEuro(amount));
    expect(meldung).toContain(formatEuro(berechnet));
    expect(meldung).toContain(formatEuro(12_345));
    expect(meldung).toContain("bestätigen");

    // Der Vermerk entsteht gar nicht erst
    const [zeile] = await sql`select count(*)::int as anzahl from annual_submissions`;
    expect(zeile).toMatchObject({ anzahl: 0 });
  });

  it("vermerkt einen abweichenden Betrag mit Bestätigung und hält die Abweichung fest", async () => {
    const berechnet = await gerechnet();
    const amount = berechnet + 12_345;
    const row = await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { amount, abweichungBestaetigt: true }), TODAY);
    expect(row).toMatchObject({ form: "euer", year: 2025, amount });

    const [zeile] = await sql`select figures from annual_submissions`;
    expect(zeile).toMatchObject({ figures: { amount, berechnet, abweichung: 12_345, abweichungBestaetigt: true } });
  });

  it("vermerkt ohne Abweichung ohne Bestätigung", async () => {
    const berechnet = await gerechnet();
    const row = await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { amount: berechnet }), TODAY);
    expect(row).toMatchObject({ form: "euer", year: 2025, amount: berechnet });

    const [zeile] = await sql`select figures from annual_submissions`;
    expect(zeile).toMatchObject({ figures: { amount: berechnet } });
  });
});
