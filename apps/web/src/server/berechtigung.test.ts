import type { ElsterClient, ElsterResult } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Berechtigung zum Belegabruf (Postgres)", () => {
  let brm: typeof import("./berechtigung.ts");
  let elster: typeof import("@haben/elster");
  let crypto: typeof import("./crypto.ts");
  let taxpayer: typeof import("./taxpayer.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const person = (idnr: string, vorname: string) => ({ idnr, anrede: "Frau" as const, vorname, name: "Muster", geburtsdatum: "1987-03-01", religion: "11", beruf: "" });

  beforeAll(async () => {
    sql = await setupTestDb();
    brm = await import("./berechtigung.ts");
    elster = await import("@haben/elster");
    crypto = await import("./crypto.ts");
    taxpayer = await import("./taxpayer.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate elster_certificates, company, brm_requests cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland, email) values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY', 'max@example.com')`;
    await taxpayer.saveTaxpayer(actor, { a: person("65929970489", "Max"), b: person("86095742719", "Erika"), veranlagung: "zusammen" });
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
  });

  /** Wie der simulierte Client, aber ohne isFake und mit Mitschnitt der gesendeten XML */
  function recordingClient(sent: string[] = [], answer?: (xml: string) => Partial<ElsterResult>): ElsterClient {
    const fake = new elster.FakeElsterClient();
    return {
      validate: (xml) => fake.validate(xml),
      send: async (xml, ...rest) => {
        sent.push(xml);
        return { ...(await fake.send(xml, ...rest)), ...answer?.(xml) };
      },
      fetchPostfach: (...args) => fake.fetchPostfach(...args),
      fetchBelege: (...args) => fake.fetchBelege(...args),
    };
  }

  it("beantragt, schaltet frei und widerruft; der Stand ergibt sich aus dem Verlauf", async () => {
    const sent: string[] = [];
    const client = recordingClient(sent);
    expect(await brm.berechtigungEhegatte(true)).toBeNull();

    const antrag = await brm.requestBerechtigung(actor, client, { kind: "test", pin: "1234", gueltigBis: "2028-12-31" });
    expect(antrag).toMatchObject({ ok: true, berechtigung: { status: "offen", gueltigBis: "2028-12-31", test: true } });
    expect(antrag.message).toContain("Erika bekommt");
    expect(sent[0]).toContain("<DateninhaberIdNr>86095742719</DateninhaberIdNr>");
    expect(sent[0]).toContain("<DateninhaberGeburtstag>1987-03-01</DateninhaberGeburtstag>");
    expect(sent[0]).toContain("<DatenabruferMail>max@example.com</DatenabruferMail>");
    expect(antrag.berechtigung!.genehmigenBis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Echt und Test getrennt
    expect(await brm.berechtigungEhegatte(false)).toBeNull();

    const frei = await brm.activateBerechtigung(actor, client, { kind: "test", pin: "1234", freischaltcode: "abcd efgh 1234" });
    expect(frei).toMatchObject({ ok: true, berechtigung: { status: "genehmigt", antragsId: antrag.berechtigung!.antragsId } });
    expect(sent[1]).toContain("<Freischaltcode>ABCD-EFGH-1234</Freischaltcode>");
    const [row] = await sql`select request_xml from brm_requests where art = 'freischaltung'`;
    expect(row!.request_xml).not.toContain("ABCD-EFGH-1234");

    const storno = await brm.revokeBerechtigung(actor, client, { kind: "test", pin: "1234" });
    expect(storno).toMatchObject({ ok: true, berechtigung: { status: "widerrufen" } });
    await expect(brm.revokeBerechtigung(actor, client, { kind: "test", pin: "1234" })).rejects.toThrow(/keinen Antrag/);
    await expect(brm.activateBerechtigung(actor, client, { kind: "test", pin: "1", freischaltcode: "ABCD-EFGH-1234" })).rejects.toThrow(/keinen offenen/);

    await expect(sql`delete from brm_requests`).rejects.toThrow();
  });

  it("übernimmt den Stand aus der Liste, auch für Anträge aus Mein ELSTER", async () => {
    const liste = (status: string) => () => ({
      serverResponseXml:
        `<Elster><DatenTeil><Nutzdatenblock><NutzdatenHeader><RC><Rueckgabe><Code>0</Code><Text>OK</Text></Rueckgabe></RC></NutzdatenHeader><Nutzdaten>` +
        `<SpezRechtListe version="7"><Antrag><AntragsID>brportal1</AntragsID><GueltigBis>2029-12-31</GueltigBis><AntragsStatus>${status}</AntragsStatus>` +
        `<Recht>AbrufEBelege</Recht><Veranlagungszeitraum><Unbeschraenkt>true</Unbeschraenkt></Veranlagungszeitraum><DateninhaberIdNr>86095742719</DateninhaberIdNr></Antrag>` +
        `</SpezRechtListe></Nutzdaten></Nutzdatenblock></DatenTeil></Elster>`,
    });
    const result = await brm.refreshBerechtigungen(actor, recordingClient([], liste("genehmigt")), { kind: "test", pin: "1" });
    expect(result).toMatchObject({ ok: true, message: "Stand bei ELSTER: genehmigt.", berechtigung: { antragsId: "brportal1", gueltigBis: "2029-12-31" } });
    await brm.refreshBerechtigungen(actor, recordingClient([], liste("abgelaufen")), { kind: "test", pin: "1" });
    expect((await brm.berechtigungEhegatte(true))?.status).toBe("abgelaufen");
  });

  it("wertet fachliche Fehler im Nutzdatenblock als Fehler", async () => {
    const failing = recordingClient([], () => ({
      serverResponseXml:
        "<Elster><DatenTeil><Nutzdatenblock><NutzdatenHeader><RC><Rueckgabe><Code>371015211</Code><Text>Es ist kein Antrag vorhanden.</Text></Rueckgabe></RC></NutzdatenHeader></Nutzdatenblock></DatenTeil></Elster>",
    }));
    const result = await brm.requestBerechtigung(actor, failing, { kind: "test", pin: "1", gueltigBis: "2028-12-31" });
    expect(result).toMatchObject({ ok: false, message: "Es ist kein Antrag vorhanden. (371015211)", berechtigung: null });
    const [row] = await sql`select ok, code from brm_requests`;
    expect(row).toMatchObject({ ok: false, code: 371015211 });
  });

  it("braucht Angaben zum Ehegatten und für den Echtabruf ERiC", async () => {
    await expect(brm.requestBerechtigung(actor, new elster.FakeElsterClient(), { kind: "send", pin: "1", herstellerId: "12345", gueltigBis: "2028-12-31" })).rejects.toThrow(/Ohne ERiC/);
    await taxpayer.saveTaxpayer(actor, { a: person("65929970489", "Max") });
    await expect(brm.requestBerechtigung(actor, recordingClient(), { kind: "test", pin: "1", gueltigBis: "2028-12-31" })).rejects.toThrow(/Ehegatten/);
    expect(brm.defaultGueltigBis("2026-10-03")).toBe("2028-12-31");
  });
});
