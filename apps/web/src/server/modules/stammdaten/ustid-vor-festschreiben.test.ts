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
    expect(await modul.ustIdVorFestschreiben(actor, contactId, AM_TAG, dienst().via)).toEqual({ hinweis: null });
  });

  it("nach 30 Tagen fragt Haben neu; gültig ergibt keinen Hinweis", async () => {
    await modul.bestaetigeUstId(actor, contactId, {}, dienst(ok("e"), ok("q", { ergOrt: "A" })).via);
    const { via, anfragen } = dienst(ok("e2"), ok("q2", { ergOrt: "A" }));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, NACH_31_TAGEN, via)).toEqual({ hinweis: null });
    expect(anfragen).toHaveLength(2);
    expect(await modul.listUstIdBestaetigungen(contactId)).toHaveLength(4);
  });

  it("noch nie bestätigt und laut BZSt nicht vergeben: Hinweis mit der Meldung", async () => {
    const ergebnis = await modul.ustIdVorFestschreiben(actor, contactId, AM_TAG, dienst(fehler(404, "evatr-2001")).via);
    expect(ergebnis).toEqual({ hinweis: "Laut BZSt ist ATU12345678 nicht gültig: Nicht vergeben." });
  });

  it("zuletzt ungültig fragt auch innerhalb der Frist neu", async () => {
    await modul.bestaetigeUstId(actor, contactId, {}, dienst(fehler(404, "evatr-2001")).via);
    const { via, anfragen } = dienst(ok("e"), ok("q", { ergOrt: "A" }));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, AM_TAG, via)).toEqual({ hinweis: null });
    expect(anfragen).toHaveLength(2);
  });

  it("bei Ausfall des Dienstes nennt der Hinweis den letzten Stand", async () => {
    const nie = await modul.ustIdVorFestschreiben(actor, contactId, AM_TAG, dienst(fehler(503, "evatr-1001")).via);
    expect(nie.hinweis).toMatch(/^ATU12345678 ließ sich gerade nicht beim BZSt bestätigen: .*evatr-1001.*\. Bestätigt ist sie noch nicht\.$/);
    await modul.bestaetigeUstId(actor, contactId, {}, dienst(ok("e"), ok("q", { ergOrt: "A" })).via);
    const alt = await modul.ustIdVorFestschreiben(actor, contactId, NACH_31_TAGEN, dienst("kein-netz").via);
    expect(alt.hinweis).toContain("Keine Antwort vom BZSt");
    expect(alt.hinweis).toContain("Zuletzt am 18.11.2026: Gültig.");
  });

  it("abgeschaltet oder mit deutscher Nummer wie vorher: kein Hinweis, keine Abfrage", async () => {
    process.env.HABEN_EVATR = "off";
    expect(await modul.ustIdVorFestschreiben(actor, contactId, AM_TAG, dienst().via)).toEqual({ hinweis: null });
    delete process.env.HABEN_EVATR;
    await contacts.updateContact(actor, contactId, kontakt("DE123456788"));
    expect(await modul.ustIdVorFestschreiben(actor, contactId, AM_TAG, dienst().via)).toEqual({ hinweis: null });
  });

  it("eine bestimmte Nummer, etwa aus der ZM, auch wenn der Kontakt heute eine andere hat", async () => {
    const { via, anfragen } = dienst(ok("zm"));
    expect(await modul.bestaetigeNummer(actor, contactId, "FR12345678901", via)).toEqual({ hinweis: null });
    expect(anfragen).toEqual([{ anfragendeUstid: "DE123456788", angefragteUstid: "FR12345678901" }]);
    const letzte = await modul.letzteBestaetigungen(["FR12345678901", "ATU12345678"]);
    expect(letzte.get("FR12345678901")).toMatchObject({ contactId, art: "einfach", status: "evatr-0000" });
    expect(letzte.has("ATU12345678")).toBe(false);
  });
});
