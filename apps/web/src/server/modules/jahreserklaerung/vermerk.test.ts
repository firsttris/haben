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

  it("vermerkt eine außerhalb abgegebene Erklärung und findet sie wieder", async () => {
    const row = await jahresvermerk.vermerkeJahresabgabe(
      actor,
      "euer",
      2025,
      { ...eingabe("ABC123456789"), file: { bytes: pdf("EUER 2025"), filename: "uebermittlung.pdf" } },
      TODAY,
    );
    expect(row).toMatchObject({ form: "euer", year: 2025, filedOn: "2026-05-20", amount: 12_345, hasPdf: true });

    const liste = await jahresvermerk.jahresvermerke(2025);
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ transferTicket: "ABC123456789", note: "Anlage EÜR außerhalb von Haben mit WISO abgegeben." });

    const uebersicht = await annual.annualOverview(2025, TODAY);
    expect(uebersicht.euer.submitted).toMatchObject({ filedOn: "2026-05-20", transferTicket: "ABC123456789", amount: 12_345, hasPdf: true });
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
      figures: { amount: 12_345 },
      request_xml: "",
      response_xml: "",
      server_response_xml: "",
    });
  });

  it("lehnt einen zweiten Vermerk für dasselbe Formular und Jahr ab", async () => {
    await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789"), TODAY);
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("XYZ987654321"), TODAY)).rejects.toThrow(/schon vermerkt/);
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(1);
  });

  it("lehnt ein abgeschlossenes Jahr ab", async () => {
    await sql`insert into year_closings (year) values (2025)`;
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789"), TODAY)).rejects.toThrow(/abgeschlossen/);
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(0);
  });

  it("lehnt ein schon verwendetes Transferticket ab", async () => {
    await jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789"), TODAY);
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "ust", 2025, eingabe("ABC123456789"), TODAY)).rejects.toThrow(/Transferticket/);
    expect(await jahresvermerk.jahresvermerke(2025)).toHaveLength(1);
  });

  it("lehnt einen Tag der Abgabe in der Zukunft ab", async () => {
    await expect(jahresvermerk.vermerkeJahresabgabe(actor, "euer", 2025, eingabe("ABC123456789", { filedOn: "2027-01-05" }), TODAY)).rejects.toThrow(/Zukunft/);
  });

  it("meldet eine Abweichung zum gerechneten Betrag nur als Hinweis", async () => {
    const pruefung = await jahresvermerk.vermerkPruefung(actor, "ust", 2025, 500);
    expect(pruefung.berechnet).toBe(0);
    expect(pruefung.abweichung).toBe(500);
    expect(pruefung.hinweis).toContain("weicht");
  });
});
