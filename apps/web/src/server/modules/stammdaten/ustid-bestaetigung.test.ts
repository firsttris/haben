import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { evatrFehler as fehler, evatrOk as ok, evatrDienst as dienst } from "../../test-evatr.ts";

/* Bestätigung beim BZSt (#1385) gegen den nachgebauten Dienst aus test-evatr.ts; keine echte Abfrage. */

describe.skipIf(!testDatabaseUrl)("USt-IdNr. beim BZSt bestätigen (Postgres)", () => {
  let sql: postgres.Sql;
  let modul: typeof import("./ustid-bestaetigung.ts");
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  let contactId: string;
  const kontakt = (ustId: string, ort = "musterort") => ({
    kundennummer: "",
    name: "Musterhaus GmbH & Co KG",
    strasse: "Musterstrasse 22",
    plz: "12345",
    ort,
    land: "AT",
    email: "",
    ustId,
    iban: "",
    leitwegId: "",
    defaultFormat: null,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    modul = await import("./ustid-bestaetigung.ts");
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate ustid_bestaetigungen, contact_versions, contacts, company cascade`;
    // Gültige Prüfziffer, wie sie ein echtes Unternehmen hat
    await sql`insert into company (id, name, ust_id) values (1, 'Testfirma', 'DE123456788')`;
    contactId = (await contacts.createContact(actor, kontakt("ATU12345678"))).id;
  });

  afterEach(() => {
    delete process.env.HABEN_EVATR;
  });

  it("fragt erst einfach, dann qualifiziert und speichert beide Antworten unverändert", async () => {
    const { via, anfragen } = dienst(ok("einfach-1"), ok("qual-1", { ergFirmenname: "A", ergStrasse: "B", ergPlz: "A", ergOrt: "D" }));
    expect(await modul.bestaetigeUstId(actor, contactId, {}, via)).toEqual({ neu: 2, hinweis: null });
    expect(anfragen).toEqual([
      { anfragendeUstid: "DE123456788", angefragteUstid: "ATU12345678" },
      {
        anfragendeUstid: "DE123456788",
        angefragteUstid: "ATU12345678",
        firmenname: "Musterhaus GmbH & Co KG",
        strasse: "Musterstrasse 22",
        plz: "12345",
        ort: "musterort",
      },
    ]);
    const [qualifiziert, einfach] = await modul.listUstIdBestaetigungen(contactId);
    expect(einfach).toMatchObject({ art: "einfach", status: "evatr-0000", bzstId: "einfach-1", firmenname: null, ergOrt: null, createdBy: actor });
    expect(qualifiziert).toMatchObject({ art: "qualifiziert", firmenname: "Musterhaus GmbH & Co KG", ergStrasse: "B", ergOrt: "D", bzstId: "qual-1" });
    expect(new Date(qualifiziert!.anfrageZeitpunkt).toISOString()).toBe("2026-11-18T13:34:36.318Z");
    // Der empfangene Datensatz als Nachweis, Zeichen für Zeichen
    expect(JSON.parse(qualifiziert!.antwort)).toEqual({
      id: "qual-1",
      anfrageZeitpunkt: "2026-11-18T14:34:36.318854732+01:00",
      status: "evatr-0000",
      ergFirmenname: "A",
      ergStrasse: "B",
      ergPlz: "A",
      ergOrt: "D",
    });
    expect((await modul.ustIdBestaetigungen(contactId)).zustand).toEqual({ art: "bereit", faellig: false });
  });

  it("fragt nach dem Speichern nur, wenn Nummer, Name oder Anschrift neu sind", async () => {
    expect((await modul.ustIdBestaetigungen(contactId)).zustand).toEqual({ art: "bereit", faellig: true });
    await modul.bestaetigeUstId(actor, contactId, { nurWennFaellig: true }, dienst(ok("e"), ok("q", { ergOrt: "A" })).via);
    // Ohne Änderung keine Abfrage: der Dienst hätte keine Antwort mehr
    expect(await modul.bestaetigeUstId(actor, contactId, { nurWennFaellig: true }, dienst().via)).toEqual({ neu: 0, hinweis: null });
    await contacts.updateContact(actor, contactId, kontakt("ATU12345678", "Wien"));
    const { via, anfragen } = dienst(ok("e2"), ok("q2", { ergOrt: "A" }));
    expect(await modul.bestaetigeUstId(actor, contactId, { nurWennFaellig: true }, via)).toEqual({ neu: 2, hinweis: null });
    expect(anfragen[1]).toMatchObject({ ort: "Wien" });
  });

  it("eine nicht vergebene Nummer: Nachweis der einfachen Abfrage, keine qualifizierte", async () => {
    const { via, anfragen } = dienst(fehler(404, "evatr-2001"));
    expect(await modul.bestaetigeUstId(actor, contactId, {}, via)).toEqual({ neu: 1, hinweis: null });
    expect(anfragen).toHaveLength(1);
    expect(await modul.listUstIdBestaetigungen(contactId)).toMatchObject([{ art: "einfach", status: "evatr-2001" }]);
  });

  it("bei einem Fehler des Dienstes oder ohne Netz bleibt alles wie vorher, mit Hinweis", async () => {
    const ausfall = await modul.bestaetigeUstId(actor, contactId, {}, dienst(fehler(503, "evatr-1001")).via);
    expect(ausfall).toEqual({ neu: 0, hinweis: expect.stringContaining("evatr-1001"), grund: ausfall.hinweis });
    const ohneNetz = await modul.bestaetigeUstId(actor, contactId, {}, dienst("kein-netz").via);
    expect(ohneNetz.hinweis).toContain("Keine Antwort vom BZSt");
    const kaputt = await modul.bestaetigeUstId(actor, contactId, {}, dienst({ status: 200, body: { status: "gültig" } }).via);
    expect(kaputt).toEqual({ neu: 0, hinweis: expect.stringContaining("ließ sich nicht lesen"), grund: kaputt.hinweis });
    // Gültig, aber ohne lesbaren Zeitpunkt: kein Nachweis, und der Hinweis sagt nicht „Gültig“
    const ohneZeit = { status: 200, body: { id: "z", anfrageZeitpunkt: "18.11.2026 14:34", status: "evatr-0000" } };
    expect(await modul.bestaetigeUstId(actor, contactId, {}, dienst(ohneZeit).via)).toEqual({
      neu: 0,
      hinweis: expect.stringContaining("ließ sich nicht lesen"),
      grund: expect.stringContaining("ließ sich nicht lesen"),
    });
    expect(await modul.listUstIdBestaetigungen(contactId)).toEqual([]);
  });

  it("beim Limit qualifizierter Abfragen bleibt es bei der einfachen, ohne Wiederholung", async () => {
    const { via, anfragen } = dienst(ok("e"), fehler(403, "evatr-0008"));
    const ergebnis = await modul.bestaetigeUstId(actor, contactId, {}, via);
    expect(ergebnis).toEqual({
      neu: 1,
      hinweis: "Name und Anschrift nicht bestätigt: Höchstzahl qualifizierter Abfragen beim BZSt erreicht; nur einfach bestätigt",
      grund: "Höchstzahl qualifizierter Abfragen beim BZSt erreicht; nur einfach bestätigt",
    });
    expect(anfragen).toHaveLength(2);
    expect(await modul.listUstIdBestaetigungen(contactId)).toMatchObject([{ art: "einfach", status: "evatr-0000" }]);
  });

  it("ohne Ort nur einfach", async () => {
    await contacts.updateContact(actor, contactId, kontakt("ATU12345678", ""));
    const { via, anfragen } = dienst(ok("e"));
    expect(await modul.bestaetigeUstId(actor, contactId, {}, via)).toEqual({ neu: 1, hinweis: null });
    expect(anfragen).toHaveLength(1);
  });

  it("abgeschaltet, ohne eigene USt-IdNr. oder bei deutscher Nummer fragt Haben nichts", async () => {
    process.env.HABEN_EVATR = "off";
    expect((await modul.ustIdBestaetigungen(contactId)).zustand).toEqual({ art: "aus" });
    await expect(modul.bestaetigeUstId(actor, contactId, {}, dienst().via)).rejects.toThrow(/HABEN_EVATR=off/);
    expect(await modul.bestaetigeUstId(actor, contactId, { nurWennFaellig: true }, dienst().via)).toEqual({ neu: 0, hinweis: null });
    delete process.env.HABEN_EVATR;

    // Prüfziffer falsch: das BZSt lehnte die Abfrage ab (evatr-0004)
    await sql`update company set ust_id = 'DE123456789' where id = 1`;
    expect((await modul.ustIdBestaetigungen(contactId)).zustand).toEqual({ art: "ohne-eigene" });
    await expect(modul.bestaetigeUstId(actor, contactId, {}, dienst().via)).rejects.toThrow(/USt-IdNr. in den Firmendaten/);

    await sql`update company set ust_id = 'DE123456788' where id = 1`;
    await contacts.updateContact(actor, contactId, kontakt("DE123456788"));
    expect((await modul.ustIdBestaetigungen(contactId)).zustand).toEqual({ art: "nicht-pruefbar" });
    await expect(modul.bestaetigeUstId(actor, contactId, {}, dienst().via)).rejects.toThrow(/anderen EU-Mitgliedstaats/);
  });

  it("ein unbekannter Kontakt wirft auf der Kontaktseite nicht", async () => {
    expect(await modul.ustIdBestaetigungen("00000000-0000-4000-8000-000000000000")).toEqual({ bestaetigungen: [], zustand: { art: "nicht-pruefbar" } });
  });

  it("ein Nachweis lässt sich nicht ändern, löschen oder leeren und steht im Änderungsprotokoll", async () => {
    await modul.bestaetigeUstId(actor, contactId, {}, dienst(ok("e"), ok("q", { ergOrt: "A" })).via);
    await expect(sql`update ustid_bestaetigungen set status = 'evatr-2001'`).rejects.toThrow();
    await expect(sql`delete from ustid_bestaetigungen`).rejects.toThrow();
    await expect(sql`truncate ustid_bestaetigungen`).rejects.toThrow();
    const [zeile] = await sql<{ count: string }[]>`
      select count(*) from audit_log
      where table_name = 'ustid_bestaetigungen' and action = 'INSERT' and actor = ${actor}
        and row_id in (select id::text from ustid_bestaetigungen)`;
    expect(Number(zeile?.count)).toBe(2);
  });
});
