import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeElsterClient, TEST_HERSTELLER_ID, type ElsterClient, type ElsterResult } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

/** Dateien unter server/ ohne Tests, rekursiv */
function serverSources(dir = fileURLToPath(new URL(".", import.meta.url))): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return serverSources(path);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !["test-db.ts", "test-eric.ts"].includes(e.name) ? [path] : [];
  });
}

/** Echter Client ohne isFake, der mitschreibt und auf Wunsch wartet */
function liveClient(log: string[] = [], options: { delay?: number; answer?: Partial<ElsterResult> } = {}): ElsterClient {
  const fake = new FakeElsterClient();
  return {
    validate: (xml) => fake.validate(xml),
    send: async (xml, certificate, pin, sendOptions) => {
      log.push(`send ${pin}`);
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      return { ...(await fake.send(xml, certificate, pin, sendOptions)), ...options.answer };
    },
    fetchPostfach: (...args) => fake.fetchPostfach(...args),
    fetchBelege: (...args) => fake.fetchBelege(...args),
  };
}

describe("ELSTER-Gateway: Struktur", () => {
  it("nur das Gateway kennt Test-Hersteller-ID, simulierten Client, Zertifikat, PIN und Sendesperre", () => {
    const forbidden = /TEST_HERSTELLER_ID|\.isFake\b|"isFake" in|certificate\.ciphertext|decrypt\(certificate\.pinCiphertext\)|pg_advisory_xact_lock\(hashtext\(\$\{key\}\)\)/;
    const offenders = serverSources()
      .filter((file) => !file.endsWith(join("server", "elster-gateway.ts")))
      .filter((file) => forbidden.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    // Und kein Dienst importiert ELSTER-Infrastruktur mehr aus der Voranmeldung
    const fromVat = serverSources().filter((file) => /import \{[^}]*\b(loadActiveCertificate|PRODUKT_VERSION|underSendLock|protocolSubmission)\b[^}]*\} from "[./]*vat\.ts"/.test(readFileSync(file, "utf8")));
    expect(fromVat).toEqual([]);
  });

});

describe.skipIf(!testDatabaseUrl)("ELSTER-Gateway (Postgres)", () => {
  let sql: postgres.Sql;
  let gateway: typeof import("./elster-gateway.ts");
  let crypto: typeof import("./crypto.ts");
  let finanzamt: typeof import("./finanzamt.ts");
  let brm: typeof import("./berechtigung.ts");
  let taxpayer: typeof import("./taxpayer.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    gateway = await import("./elster-gateway.ts");
    crypto = await import("./crypto.ts");
    finanzamt = await import("./finanzamt.ts");
    brm = await import("./berechtigung.ts");
    taxpayer = await import("./taxpayer.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate elster_certificates, elster_messages, brm_requests, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland, email) values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY', 'max@example.com')`;
  });

  it("Testfälle nehmen die eigene Hersteller-ID, sonst die Test-ID; echt nur mit eigener", () => {
    const client = liveClient();
    expect(gateway.zugang(client, "validate", undefined)).toEqual({ test: true, herstellerId: TEST_HERSTELLER_ID });
    expect(gateway.zugang(client, "test", "12345")).toEqual({ test: true, herstellerId: "12345" });
    expect(gateway.zugang(client, "send", "12345")).toEqual({ test: false, herstellerId: "12345" });
    expect(() => gateway.zugang(client, "send", undefined)).toThrow("Für die Echtübermittlung fehlt die Hersteller-ID (ELSTER_HERSTELLER_ID).");
    expect(() => gateway.zugang(client, "send", "", gateway.ABRUF)).toThrow("Für den echten Abruf fehlt die Hersteller-ID");
    expect(() => gateway.zugang(client, "send", "", gateway.SENDEN)).toThrow("Für das echte Senden fehlt die Hersteller-ID");
  });

  it("mit dem simulierten Client geht nichts echt, Prüfen und Test schon", () => {
    const fake = new FakeElsterClient();
    expect(gateway.isSimulated(fake)).toBe(true);
    expect(gateway.isSimulated(liveClient())).toBe(false);
    expect(gateway.zugang(fake, "test", "12345").test).toBe(true);
    expect(() => gateway.zugang(fake, "send", "12345")).toThrow(/Ohne ERiC ist keine Echtübermittlung möglich/);
    expect(() => gateway.zugang(fake, "send", "12345", gateway.ABRUF)).toThrow(/Ohne ERiC ist kein echter Abruf möglich/);
    expect(() => gateway.zugang(fake, "send", "12345", gateway.SENDEN)).toThrow(/Ohne ERiC ist kein echtes Senden möglich/);
  });

  it("scheitert das Protokoll nach der Echtübermittlung, bleibt der Nachweis im Log", async () => {
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const ok = { ok: true, code: 0, message: "ok", transferTicket: "tt-1", responseXml: "", serverResponseXml: "" };
      await expect(
        gateway.protocolSubmission("send", ok, "<xml/>", async () => {
          throw new Error("DB weg");
        }),
      ).rejects.toThrow(/Transferticket tt-1.*nicht erneut senden/);
      // Bei Test oder Fehlschlag kein Sonderweg: der ursprüngliche Fehler
      await expect(gateway.protocolSubmission("test", ok, "<xml/>", async () => Promise.reject(new Error("DB weg")))).rejects.toThrow("DB weg");
      await expect(gateway.protocolSubmission("send", { ...ok, ok: false }, "<xml/>", async () => Promise.reject(new Error("DB weg")))).rejects.toThrow("DB weg");
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]?.[1]).toEqual({ transferTicket: "tt-1", requestXml: "<xml/>" });
  });
  const certificate = (pin?: string) =>
    sql`insert into elster_certificates (filename, ciphertext, pin_ciphertext)
      values ('test.pfx', ${crypto.encrypt(new Uint8Array([7, 7]))}, ${pin ? crypto.encrypt(new TextEncoder().encode(pin)) : null})`;

  it("Signatur: Zertifikat und PIN, die gespeicherte nur wo erlaubt", async () => {
    await expect(gateway.signatur({ pin: "1234" })).rejects.toThrow("Es ist kein ELSTER-Zertifikat hinterlegt.");
    await certificate("9999");
    const signed = await gateway.signatur({ pin: "1234" });
    expect([...signed.pfx]).toEqual([7, 7]);
    expect(signed.pin).toBe("1234");
    // Ohne PIN: nur mit gespeicherter, und nur wenn der Vorgang das erlaubt
    await expect(gateway.signatur({})).rejects.toThrow("Die Zertifikats-PIN fehlt.");
    expect((await gateway.signatur({ gespeichertePin: true })).pin).toBe("9999");
    await sql`update elster_certificates set pin_ciphertext = null`;
    await expect(gateway.signatur({ gespeichertePin: true })).rejects.toThrow("Die Zertifikats-PIN fehlt.");
  });

  it("Sendesperre: zwei Echtübermittlungen desselben Vorgangs laufen nacheinander, Tests nicht", async () => {
    const order: string[] = [];
    const work = (name: string) => async () => {
      order.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      order.push(`${name} ende`);
    };
    await Promise.all([gateway.underSendLock("haben.test.a", "send", work("1")), gateway.underSendLock("haben.test.a", "send", work("2"))]);
    expect(order).toEqual(order[0] === "1 start" ? ["1 start", "1 ende", "2 start", "2 ende"] : ["2 start", "2 ende", "1 start", "1 ende"]);
    order.length = 0;
    // Andere Vorgänge und Testübermittlungen warten nicht
    await Promise.all([gateway.underSendLock("haben.test.a", "send", work("1")), gateway.underSendLock("haben.test.b", "send", work("2"))]);
    expect(order.slice(0, 2).sort()).toEqual(["1 start", "2 start"]);
    order.length = 0;
    await Promise.all([gateway.underSendLock("haben.test.a", "test", work("1")), gateway.underSendLock("haben.test.a", "test", work("2"))]);
    expect(order.slice(0, 2).sort()).toEqual(["1 start", "2 start"]);
  });

  it("Nachrichten an das Finanzamt: ein Doppelklick sendet nacheinander, nicht gleichzeitig, und alles ist protokolliert", async () => {
    await certificate();
    const log: string[] = [];
    const client = liveClient(log, { delay: 100 });
    const antrag = { topic: "vorauszahlung" as const, betreff: "Antrag", text: "Bitte herabsetzen.", figures: { wanted: 1 } };
    const started = Date.now();
    await Promise.all([
      finanzamt.sendMessage(actor, antrag, client, { kind: "send", pin: "1", herstellerId: "12345" }),
      finanzamt.sendMessage(actor, antrag, client, { kind: "send", pin: "1", herstellerId: "12345" }),
    ]);
    // Zweimal 100 ms nacheinander, nicht parallel
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    const rows = await sql`select kind, ok from elster_messages`;
    expect(rows).toHaveLength(2);
    expect(log).toEqual(["send 1", "send 1"]);
  });

  it("Berechtigungen: echte Anträge unter der Sendesperre, das Protokoll abgesichert", async () => {
    const person = (idnr: string, vorname: string) => ({ idnr, anrede: "Herrn" as const, vorname, name: "Muster", geburtsdatum: "1987-03-01", religion: "11", beruf: "" });
    await taxpayer.saveTaxpayer(actor, { a: person("65929970489", "Max"), b: person("86095742719", "Erika"), veranlagung: "zusammen" });
    await certificate("1234");
    const client = liveClient([], { delay: 100 });
    const started = Date.now();
    await Promise.all([
      brm.requestBerechtigung(actor, client, { kind: "send", herstellerId: "12345", gueltigBis: "2028-12-31" }),
      brm.requestBerechtigung(actor, client, { kind: "send", herstellerId: "12345", gueltigBis: "2028-12-31" }),
    ]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(await sql`select art from brm_requests`).toHaveLength(2);
  });

  it("scheitert das Protokoll nach einer echten Freischaltung, steht der Freischaltcode nicht im Server-Log", async () => {
    const person = (idnr: string, vorname: string) => ({ idnr, anrede: "Herrn" as const, vorname, name: "Muster", geburtsdatum: "1987-03-01", religion: "11", beruf: "" });
    await taxpayer.saveTaxpayer(actor, { a: person("65929970489", "Max"), b: person("86095742719", "Erika"), veranlagung: "zusammen" });
    await certificate("1234");
    const client = liveClient();
    await brm.requestBerechtigung(actor, client, { kind: "send", herstellerId: "12345", gueltigBis: "2028-12-31" });
    // Speichern der Freischaltung scheitert nach dem Senden
    await sql`create function haben_test_fail() returns trigger language plpgsql as $$ begin raise exception 'DB weg'; end $$`;
    await sql`create trigger haben_test_fail before insert on brm_requests for each row when (new.art = 'freischaltung') execute function haben_test_fail()`;
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      await expect(
        brm.activateBerechtigung(actor, client, { kind: "send", herstellerId: "12345", freischaltcode: "abcd efgh 1234" }),
      ).rejects.toThrow(/nicht erneut senden/);
    } finally {
      console.error = original;
      await sql`drop trigger haben_test_fail on brm_requests`;
      await sql`drop function haben_test_fail()`;
    }
    expect(logged).toHaveLength(1);
    const text = JSON.stringify(logged[0]);
    expect(text).toContain("<Freischaltcode>XXXX-XXXX-XXXX</Freischaltcode>");
    expect(text).not.toContain("ABCD-EFGH-1234");
  });
});
