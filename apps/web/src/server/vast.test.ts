import { EricGeprueftClient } from "./test-eric.ts";
import type { BelegabrufResult, ElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Belegabruf VaSt (Postgres)", () => {
  let vast: typeof import("./vast.ts");
  let elster: typeof import("@haben/elster");
  let crypto: typeof import("./crypto.ts");
  let taxpayer: typeof import("./taxpayer.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const person = (idnr: string, vorname: string) => ({ idnr, anrede: "Frau" as const, vorname, name: "Muster", geburtsdatum: "1980-01-01", religion: "11", beruf: "" });

  beforeAll(async () => {
    sql = await setupTestDb();
    vast = await import("./vast.ts");
    elster = await import("@haben/elster");
    crypto = await import("./crypto.ts");
    taxpayer = await import("./taxpayer.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate elster_certificates, company, vast_belege, vast_requests cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland) values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY')`;
    await taxpayer.saveTaxpayer(actor, { a: person("65929970489", "Erika") });
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
  });

  /** Drei Belege, einer lässt sich nicht entschlüsseln */
  function scriptedClient(calls: { idnr: string; test: boolean; pin: string }[] = []): ElsterClient {
    const fake = new EricGeprueftClient();
    // Ohne isFake, damit auch der Echtabruf durchgeht
    return {
      validate: (xml) => fake.validate(xml),
      send: (...args) => fake.send(...args),
      fetchPostfach: (...args) => fake.fetchPostfach(...args),
      fetchBelege: async (input, _cert, pin): Promise<BelegabrufResult> => {
        calls.push({ idnr: input.idnr, test: input.test, pin });
        return {
          ok: true,
          code: 0,
          message: "ok",
          responseXml: "<R/>",
          serverResponseXml: "<S/>",
          requestXml: elster.buildVastAnfrageXml(input),
          liste: [
            { id: "L1", belegart: "VaSt_LStB", groesse: 1, hashwert: "h", schemaversion: "1" },
            { id: "R1", belegart: "VaSt_RBM", groesse: 1, hashwert: "h", schemaversion: "202001" },
            { id: "K1", belegart: "VaSt_KRV", groesse: 1, hashwert: "h", schemaversion: "1" },
          ],
          abholung: { requestXml: "<A/>", responseXml: "", serverResponseXml: "" },
          belege: [
            { id: "L1", xml: "<VaSt_LStB><Arbeitgeber><Name>Test GmbH</Name></Arbeitgeber><Bruttoarbeitslohn>1000.00</Bruttoarbeitslohn></VaSt_LStB>" },
            { id: "R1", xml: "<VaSt_RBM><Mitteilung><Krankenversicherung><Betrag>12.50</Betrag></Krankenversicherung></Mitteilung></VaSt_RBM>" },
            { id: "K1", fehler: "Entschlüsselung fehlgeschlagen" },
          ],
        };
      },
    };
  }

  it("speichert die entschlüsselten Belege, protokolliert den Abruf und legt nichts doppelt ab", async () => {
    const calls: { idnr: string; test: boolean; pin: string }[] = [];
    const summary = await vast.fetchVastBelege(actor, scriptedClient(calls), { kind: "test", year: 2025, person: "a", pin: "1234" });
    expect(summary).toMatchObject({ ok: true, gefunden: 3, neu: 2, fehler: [{ id: "K1", fehler: "Entschlüsselung fehlgeschlagen" }] });
    expect(calls).toEqual([{ idnr: "65929970489", test: true, pin: "1234" }]);

    const belege = await vast.listVastBelege(2025);
    expect(belege.map((b) => [b.belegart, b.label, b.person, b.test])).toEqual([
      ["VaSt_LStB", "Lohnsteuerbescheinigung", "a", true],
      ["VaSt_RBM", "Rentenbezugsmitteilung", "a", true],
    ]);
    expect(belege[0]!.werte).toEqual([
      { pfad: ["Arbeitgeber", "Name"], wert: "Test GmbH" },
      { pfad: ["Bruttoarbeitslohn"], wert: "1000.00" },
    ]);
    expect((await vast.vastBelegXml(belege[1]!.id))?.xml).toContain("<Betrag>12.50</Betrag>");
    expect(await vast.listVastBelege(2024)).toEqual([]);

    const again = await vast.fetchVastBelege(actor, scriptedClient(), { kind: "test", year: 2025, person: "a", pin: "1234" });
    expect(again).toMatchObject({ ok: true, neu: 0, message: "3 Belege bei ELSTER, 0 neu gespeichert." });
    const [request] = await sql`select count(*)::int as n, bool_and(abholung is not null) as abholung from vast_requests`;
    expect(request).toMatchObject({ n: 2, abholung: true });

    // Unveränderlich, und das Beleg-XML bleibt aus dem Audit-Log
    await expect(sql`delete from vast_belege`).rejects.toThrow();
    await expect(sql`update vast_requests set ok = false`).rejects.toThrow();
    const audit = await sql`select new_value from audit_log where table_name = 'vast_belege' limit 1`;
    expect(audit[0]!.new_value).not.toHaveProperty("xml");
    expect(audit[0]!.new_value.belegart).toBeTruthy();
  });

  it("zeigt Testbelege nur, solange es keine echten gibt", async () => {
    await vast.fetchVastBelege(actor, new EricGeprueftClient(), { kind: "test", year: 2025, person: "a", pin: "1234" });
    expect((await vast.listVastBelege(2025)).every((b) => b.test)).toBe(true);
    await vast.fetchVastBelege(actor, scriptedClient(), { kind: "send", year: 2025, person: "a", pin: "1234", herstellerId: "12345" });
    const belege = await vast.listVastBelege(2025);
    expect(belege).toHaveLength(2);
    expect(belege.every((b) => !b.test)).toBe(true);
  });

  it("nimmt die gespeicherte PIN, wenn keine eingegeben ist", async () => {
    await sql`update elster_certificates set pin_ciphertext = ${crypto.encrypt(new TextEncoder().encode("gespeichert"))}`;
    const calls: { idnr: string; test: boolean; pin: string }[] = [];
    await vast.fetchVastBelege(actor, scriptedClient(calls), { kind: "test", year: 2025, person: "a" });
    expect(calls[0]!.pin).toBe("gespeichert");
  });

  it("braucht Person, Zertifikat, PIN und für den Echtabruf ERiC und Hersteller-ID", async () => {
    const fake = new EricGeprueftClient();
    await expect(vast.fetchVastBelege(actor, fake, { kind: "test", year: 2025, person: "b", pin: "1" })).rejects.toThrow(/Ehegatten/);
    await expect(vast.fetchVastBelege(actor, fake, { kind: "test", year: 2025, person: "a" })).rejects.toThrow(/PIN/);
    await expect(vast.fetchVastBelege(actor, fake, { kind: "send", year: 2025, person: "a", pin: "1", herstellerId: "12345" })).rejects.toThrow(/Ohne ERiC/);
    await expect(vast.fetchVastBelege(actor, fake, { kind: "send", year: 2025, person: "a", pin: "1" })).rejects.toThrow(/Hersteller-ID/);
    await sql`truncate elster_certificates`;
    await expect(vast.fetchVastBelege(actor, fake, { kind: "test", year: 2025, person: "a", pin: "1" })).rejects.toThrow(/Zertifikat/);
  });

  it("protokolliert auch einen gescheiterten Abruf", async () => {
    const client = scriptedClient();
    const failing: ElsterClient = {
      ...client,
      fetchBelege: async (input) => ({ ...elster.failure("Keine Berechtigung", 610301200), requestXml: elster.buildVastAnfrageXml(input), liste: [], belege: [] }),
    };
    const summary = await vast.fetchVastBelege(actor, failing, { kind: "test", year: 2025, person: "a", pin: "1" });
    expect(summary).toMatchObject({ ok: false, message: "Keine Berechtigung", neu: 0 });
    expect(await vast.lastVastRequest(2025)).toMatchObject({ ok: false, message: "Keine Berechtigung", person: "a" });
  });
});
