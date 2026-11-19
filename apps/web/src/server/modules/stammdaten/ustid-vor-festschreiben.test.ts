import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { evatrDienst as dienst, evatrFehler as fehler, evatrOk as ok } from "../../test-evatr.ts";

/*
 * Vor dem Festschreiben einer Rechnung mit Reverse Charge oder innergemeinschaftlicher Lieferung (#1385): frische gültige
 * Antwort → nichts; sonst fragt Haben neu, und nur ein ungültiges Ergebnis oder ein Ausfall ergibt einen Hinweis.
 * Die Antworten des Dienstes tragen den Zeitpunkt 2026-11-18 14:34 (MEZ); jetzt liegt je Test davor oder danach.
 */

const AM_TAG = new Date("2026-11-18T15:00:00+01:00");
const NACH_31_TAGEN = new Date("2026-12-19T15:00:00+01:00");

describe.skipIf(!testDatabaseUrl)("USt-IdNr. vor dem Festschreiben bestätigen (Postgres)", () => {
  let sql: postgres.Sql;
  let modul: typeof import("./ustid-bestaetigung.ts");
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  let contactId: string;
  const kontakt = (ustId: string) => ({
    kundennummer: "",
    name: "Musterhaus GmbH & Co KG",
    strasse: "Musterstrasse 22",
    plz: "1010",
    ort: "Wien",
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
    await sql`insert into company (id, name, ust_id) values (1, 'Testfirma', 'DE123456788')`;
    contactId = (await contacts.createContact(actor, kontakt("ATU12345678"))).id;
  });

  afterEach(() => {
    delete process.env.HABEN_EVATR;
  });

  it("eine gültige Antwort aus den letzten 30 Tagen reicht, ohne neue Abfrage", async () => {
    await modul.bestaetigeUstId(actor, contactId, {}, dienst(ok("e"), ok("q", { ergOrt: "A" })).via);
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst().via)).toEqual({ hinweis: null });
  });

  it("nach 30 Tagen fragt Haben neu; gültig ergibt keinen Hinweis", async () => {
    await modul.bestaetigeUstId(actor, contactId, {}, dienst(ok("e"), ok("q", { ergOrt: "A" })).via);
    const { via, anfragen } = dienst(ok("e2"), ok("q2", { ergOrt: "A" }));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", NACH_31_TAGEN, via)).toEqual({ hinweis: null });
    expect(anfragen).toHaveLength(2);
    expect(await modul.listUstIdBestaetigungen(contactId)).toHaveLength(4);
  });

  it("noch nie bestätigt und laut BZSt nicht vergeben: Hinweis mit der Meldung", async () => {
    const ergebnis = await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst(fehler(404, "evatr-2001")).via);
    expect(ergebnis).toEqual({ hinweis: "Laut BZSt ist ATU12345678 nicht gültig: Nicht vergeben." });
  });

  it("zuletzt ungültig fragt auch innerhalb der Frist neu", async () => {
    await modul.bestaetigeUstId(actor, contactId, {}, dienst(fehler(404, "evatr-2001")).via);
    const { via, anfragen } = dienst(ok("e"), ok("q", { ergOrt: "A" }));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, via)).toEqual({ hinweis: null });
    expect(anfragen).toHaveLength(2);
  });

  it("bei Ausfall des Dienstes nennt der Hinweis den letzten Stand", async () => {
    const nie = await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst(fehler(503, "evatr-1001")).via);
    expect(nie.hinweis).toMatch(/^ATU12345678 ließ sich gerade nicht beim BZSt bestätigen: .*evatr-1001.*\. Bestätigt ist sie noch nicht\.$/);
    await modul.bestaetigeUstId(actor, contactId, {}, dienst(ok("e"), ok("q", { ergOrt: "A" })).via);
    const alt = await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", NACH_31_TAGEN, dienst("kein-netz").via);
    expect(alt.hinweis).toContain("Keine Antwort vom BZSt");
    expect(alt.hinweis).toContain("Zuletzt am 18.11.2026: Gültig.");
  });

  it("abgeschaltet wie vorher: kein Hinweis, keine Abfrage", async () => {
    process.env.HABEN_EVATR = "off";
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst().via)).toEqual({ hinweis: null });
  });

  it("eine Nummer, die sich nicht bestätigen lässt, ergibt einen Hinweis ohne Abfrage", async () => {
    // Reverse Charge prüft den Aufbau beim Festschreiben nicht (treatmentIssues nur bei der Lieferung)
    await contacts.updateContact(actor, contactId, kontakt("ATU1234567"));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst().via)).toEqual({
      hinweis: "ATU1234567: Bestätigen lässt sich nur die USt-IdNr. eines anderen EU-Mitgliedstaats mit passendem Aufbau.",
    });
    await contacts.updateContact(actor, contactId, kontakt("DE123456788"));
    expect((await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst().via)).hinweis).toContain(
      "DE123456788: Bestätigen lässt sich nur",
    );
    // Ohne Nummer meldet das Festschreiben selbst, was fehlt
    await contacts.updateContact(actor, contactId, kontakt(""));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst().via)).toEqual({ hinweis: null });
  });

  it("ohne gültige eigene USt-IdNr. sagt der Hinweis das, ohne Abfrage", async () => {
    await sql`update company set ust_id = 'DE123456789' where id = 1`;
    expect((await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst().via)).hinweis).toBe(
      "ATU12345678: Für die Bestätigung braucht es deine deutsche USt-IdNr. in den Firmendaten.",
    );
  });

  it("eine bestimmte Nummer, etwa aus der ZM, auch wenn der Kontakt heute eine andere hat", async () => {
    const { via, anfragen } = dienst(ok("zm"));
    expect(await modul.bestaetigeNummer(actor, contactId, "FR12345678901", via)).toEqual({ hinweis: null, ausfall: false });
    expect(anfragen).toEqual([{ anfragendeUstid: "DE123456788", angefragteUstid: "FR12345678901" }]);
    const letzte = await modul.letzteBestaetigungen(["FR12345678901", "ATU12345678"]);
    expect(letzte.get("FR12345678901")).toMatchObject({ contactId, art: "einfach", status: "evatr-0000" });
    expect(letzte.has("ATU12345678")).toBe(false);
  });

  it("Lieferung: eine frische einfache Antwort reicht; Reverse Charge braucht die qualifizierte", async () => {
    // Einfach, wie aus dem Knopf der ZM
    await modul.bestaetigeNummer(actor, contactId, "ATU12345678", dienst(ok("zm")).via);
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "ig_lieferung", AM_TAG, dienst().via)).toEqual({ hinweis: null });
    const { via, anfragen } = dienst(ok("e"), ok("q", { ergFirmenname: "A", ergOrt: "A" }));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, via)).toEqual({ hinweis: null });
    expect(anfragen).toHaveLength(2);
  });

  it("Reverse Charge: scheitert die qualifizierte Abfrage, sagt der Hinweis das", async () => {
    const ergebnis = await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst(ok("e"), fehler(403, "evatr-0008")).via);
    expect(ergebnis.hinweis).toMatch(/^ATU12345678 ist gültig, Name und Anschrift hat das BZSt aber nicht bestätigt: .*Höchstzahl/);
  });

  it("Reverse Charge: passt der Ort nicht, Hinweis; eine solche Antwort zählt beim nächsten Mal nicht als bestätigt", async () => {
    const ort = await modul.ustIdVorFestschreiben(
      actor,
      contactId,
      "reverse_charge",
      AM_TAG,
      dienst(ok("e"), ok("q", { ergFirmenname: "A", ergOrt: "B" })).via,
    );
    expect(ort).toEqual({ hinweis: "Der Ort passt laut BZSt nicht zu ATU12345678; prüfe die Angaben am Kontakt." });
    const { via, anfragen } = dienst(ok("e2"), ok("q2", { ergFirmenname: "A", ergOrt: "A" }));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, via)).toEqual({ hinweis: null });
    expect(anfragen).toHaveLength(2);
  });

  it("Reverse Charge ohne Ort: die einfache Antwort reicht, mehr lässt sich nicht bestätigen", async () => {
    await contacts.updateContact(actor, contactId, { ...kontakt("ATU12345678"), ort: "" });
    await modul.bestaetigeNummer(actor, contactId, "ATU12345678", dienst(ok("zm")).via);
    expect(await modul.ustIdVorFestschreiben(actor, contactId, "reverse_charge", AM_TAG, dienst().via)).toEqual({ hinweis: null });
  });
});
