import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { evatrDienst as dienst, evatrFehler as fehler, evatrOk as ok } from "../../test-evatr.ts";

/*
 * Vor dem Buchen eines Belegs mit § 1a oder § 13b für eine EU-Leistung (#1490): Die USt-IdNr. des Lieferanten ohne frische
 * gültige Antwort fragt Haben einmal einfach ab und speichert die Antwort am Lieferanten-Kontakt; nur eine ungültige
 * Antwort, ein Ausfall oder ein fehlender Kontakt ergeben einen Hinweis. Die Antworten tragen den Zeitpunkt 2026-11-18
 * 14:34 (MEZ).
 */

const AM_TAG = new Date("2026-11-18T15:00:00+01:00");
const NACH_31_TAGEN = new Date("2026-12-19T15:00:00+01:00");

describe.skipIf(!testDatabaseUrl)("USt-IdNr. des Lieferanten vor dem Buchen bestätigen (Postgres)", () => {
  let sql: postgres.Sql;
  let modul: typeof import("./ustid-bestaetigung.ts");
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  let lieferant: string;

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
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Hardware Handel B.V.",
      strasse: "Damrak 1",
      plz: "1012 LG",
      ort: "Amsterdam",
      land: "NL",
      email: "",
      ustId: "NL123456789B01",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    lieferant = contact.id;
  });

  afterEach(() => {
    delete process.env.HABEN_EVATR;
  });

  it("fragt ohne frische gültige Antwort einmal einfach und speichert die Antwort am Lieferanten-Kontakt", async () => {
    const { via, anfragen } = dienst(ok("nl"));
    expect(await modul.ustIdVorBuchen(actor, { contactId: lieferant, ustId: "nl 123456789 b01" }, AM_TAG, via)).toEqual({ hinweis: null });
    expect(anfragen).toEqual([{ anfragendeUstid: "DE123456788", angefragteUstid: "NL123456789B01" }]);
    const [antwort] = await modul.listUstIdBestaetigungen(lieferant);
    expect(antwort).toMatchObject({ art: "einfach", angefragteUstid: "NL123456789B01", status: "evatr-0000", bzstId: "nl" });

    // Frisch und gültig: keine Abfrage, auch für einen Beleg ohne Kontakt mit derselben Nummer
    expect(await modul.ustIdVorBuchen(actor, { contactId: lieferant, ustId: "NL123456789B01" }, AM_TAG, dienst().via)).toEqual({ hinweis: null });
    expect(await modul.ustIdVorBuchen(actor, { contactId: null, ustId: "NL123456789B01" }, AM_TAG, dienst().via)).toEqual({ hinweis: null });

    // Nach 30 Tagen fragt Haben neu
    const neu = dienst(ok("nl2"));
    expect(await modul.ustIdVorBuchen(actor, { contactId: lieferant, ustId: "NL123456789B01" }, NACH_31_TAGEN, neu.via)).toEqual({ hinweis: null });
    expect(neu.anfragen).toHaveLength(1);
  });

  it("ohne Nummer am Beleg nimmt es die des Kontakts (§ 13b verlangt sie am Beleg nicht)", async () => {
    const { via, anfragen } = dienst(ok("nl"));
    expect(await modul.ustIdVorBuchen(actor, { contactId: lieferant, ustId: "" }, AM_TAG, via)).toEqual({ hinweis: null });
    expect(anfragen[0]?.angefragteUstid).toBe("NL123456789B01");
  });

  it("laut BZSt nicht vergeben: Hinweis, und die Antwort steht als Nachweis am Kontakt", async () => {
    const ergebnis = await modul.ustIdVorBuchen(actor, { contactId: lieferant, ustId: "NL123456789B01" }, AM_TAG, dienst(fehler(404, "evatr-2001")).via);
    expect(ergebnis).toEqual({ hinweis: "Laut BZSt ist NL123456789B01 nicht gültig: Nicht vergeben." });
    expect((await modul.listUstIdBestaetigungen(lieferant))[0]?.status).toBe("evatr-2001");
  });

  it("Dienst nicht erreichbar: Hinweis mit dem letzten Stand, nichts gespeichert", async () => {
    await modul.bestaetigeNummer(actor, lieferant, "NL123456789B01", dienst(ok("alt")).via);
    const ergebnis = await modul.ustIdVorBuchen(actor, { contactId: lieferant, ustId: "NL123456789B01" }, NACH_31_TAGEN, dienst("kein-netz").via);
    expect(ergebnis.hinweis).toMatch(
      /^NL123456789B01 ließ sich gerade nicht beim BZSt bestätigen: Keine Antwort vom BZSt .*\. Zuletzt am 18\.11\.2026: Gültig\.$/,
    );
    expect(await modul.listUstIdBestaetigungen(lieferant)).toHaveLength(1);
  });

  it("ohne Lieferanten-Kontakt fragt es nicht und sagt, dass es dafür einen Kontakt braucht", async () => {
    const { via, anfragen } = dienst(ok("nl"));
    const ergebnis = await modul.ustIdVorBuchen(actor, { contactId: null, ustId: "NL123456789B01" }, AM_TAG, via);
    expect(ergebnis.hinweis).toMatch(/^NL123456789B01 ist nicht frisch beim BZSt bestätigt\. .*Lieferanten-Kontakt/);
    expect(anfragen).toHaveLength(0);
  });

  it("abgeschaltet, ohne Nummer oder mit einer Nummer, die das BZSt nicht bestätigt: keine Abfrage, kein Hinweis", async () => {
    process.env.HABEN_EVATR = "off";
    expect(await modul.ustIdVorBuchen(actor, { contactId: lieferant, ustId: "NL123456789B01" }, AM_TAG, dienst().via)).toEqual({ hinweis: null });
    delete process.env.HABEN_EVATR;
    expect(await modul.ustIdVorBuchen(actor, { contactId: null, ustId: "" }, AM_TAG, dienst().via)).toEqual({ hinweis: null });
    expect(await modul.ustIdVorBuchen(actor, { contactId: null, ustId: "DE123456788" }, AM_TAG, dienst().via)).toEqual({ hinweis: null });
    expect(await modul.listUstIdBestaetigungen(lieferant)).toHaveLength(0);
  });

  it("ohne eigene USt-IdNr. sagt der Hinweis, was fehlt", async () => {
    await sql`update company set ust_id = '' where id = 1`;
    const ergebnis = await modul.ustIdVorBuchen(actor, { contactId: lieferant, ustId: "NL123456789B01" }, AM_TAG, dienst().via);
    expect(ergebnis.hinweis).toMatch(/^NL123456789B01: .*deine deutsche USt-IdNr\. in den Firmendaten/);
  });

  it("ohne Lieferanten-Kontakt nennt der Hinweis die letzte Antwort, auch „nicht vergeben“ (Review #1568)", async () => {
    await modul.bestaetigeNummer(actor, lieferant, "NL123456789B01", dienst(fehler(404, "evatr-2001")).via);
    const ergebnis = await modul.ustIdVorBuchen(actor, { contactId: null, ustId: "NL123456789B01" }, AM_TAG, dienst().via);
    expect(ergebnis.hinweis).toContain("Nicht vergeben");
  });
});
