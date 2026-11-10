import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { makeTestCertificate } from "./graph/zertifikat-testhilfe.ts";

const certificate = makeTestCertificate();
const otherCertificate = makeTestCertificate();
const GUID = "11111111-2222-3333-4444-555555555555";
const SECRET = "geheimes-client-secret-0815";

describe.skipIf(!testDatabaseUrl)("Einstellungen für SMTP und Microsoft Graph (Postgres)", () => {
  let mail: typeof import("./mail.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  const smtp = {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    username: "max",
    password: "smtp-passwort-4711",
    fromAddress: "rechnung@testfirma.example",
    reminderTo: "max@testfirma.example",
    remindersEnabled: false,
    reminderDays: [],
  };
  const graph = {
    transport: "graph" as const,
    graphTenantId: GUID,
    graphClientId: GUID,
    graphAuth: "secret" as const,
    graphMailbox: "",
    clientSecret: SECRET,
    fromAddress: "rechnung@testfirma.example",
    reminderTo: "max@testfirma.example",
    remindersEnabled: false,
    reminderDays: [],
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    mail = await import("./mail.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const row = async () => (await sql`select * from mail_settings where id = 1`)[0]!;
  /** Alles, was das Audit-Log über mail_settings weiß, als Text */
  const auditText = async () =>
    (await sql`select coalesce(old_value::text, '') || coalesce(new_value::text, '') as t from audit_log where table_name = 'mail_settings'`)
      .map((r) => r.t)
      .join("\n");
  const reason = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e: Error) => e.message,
    );

  it("behandelt Eingaben ohne Versandweg wie SMTP und liefert nie das Passwort zurück", async () => {
    await mail.saveMailSettings(actor, smtp);
    expect((await row()).transport).toBe("smtp");
    const summary = (await mail.mailSettingsSummary())!;
    expect(summary.hasSecret).toBe(true);
    expect(summary).not.toHaveProperty("ciphertext");
    expect(await auditText()).not.toContain("smtp-passwort-4711");
  });

  it("speichert das Client Secret nur verschlüsselt, auch nicht im Audit-Log", async () => {
    await mail.saveMailSettings(actor, graph);
    const stored = await row();
    expect(stored.transport).toBe("graph");
    expect(stored.host).toBeNull();
    expect(stored.graph_tenant_id).toBe(GUID);
    expect(Buffer.from(stored.ciphertext).toString("utf8")).not.toContain(SECRET);
    expect(crypto.decrypt(stored.ciphertext).toString("utf8")).toBe(SECRET);
    const audit = await auditText();
    expect(audit).not.toContain(SECRET);
    expect(audit).not.toContain(Buffer.from(stored.ciphertext).toString("hex"));
    expect(audit).toContain(GUID);
    expect(await mail.mailSettingsSummary()).not.toHaveProperty("ciphertext");
  });

  it("behält das gespeicherte Secret, wenn das Feld leer bleibt", async () => {
    await mail.saveMailSettings(actor, { ...graph, clientSecret: "", fromName: "Muster" });
    expect(crypto.decrypt((await row()).ciphertext).toString("utf8")).toBe(SECRET);
  });

  it("verlangt beim Wechsel des Versandwegs ein neues Geheimnis", async () => {
    await mail.saveMailSettings(actor, smtp);
    expect(await reason(mail.saveMailSettings(actor, { ...graph, clientSecret: "" }))).toBe("Das Client Secret fehlt.");
    await mail.saveMailSettings(actor, graph);
    expect(await reason(mail.saveMailSettings(actor, { ...smtp, password: "" }))).toBe("Das Passwort fehlt.");
    expect(crypto.decrypt((await row()).ciphertext).toString("utf8")).toBe(SECRET);
  });

  it("prüft Tenant und Client", async () => {
    expect(await reason(mail.saveMailSettings(actor, { ...graph, graphClientId: "keine-guid" }))).toContain("Client-ID");
    expect(await reason(mail.saveMailSettings(actor, { ...graph, graphTenantId: "" }))).toContain("Tenant-ID");
  });

  it.skipIf(!certificate)("speichert nur den privaten Schlüssel des Zertifikats verschlüsselt und den Fingerabdruck im Klartext", async () => {
    const { certificatePem, privateKeyPem } = certificate!;
    await mail.saveMailSettings(actor, { ...graph, graphAuth: "certificate" as const, clientSecret: "", certificatePem, privateKeyPem });
    const stored = await row();
    expect(stored.graph_auth).toBe("certificate");
    expect(stored.graph_thumbprint).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.decrypt(stored.ciphertext).toString("utf8")).toContain("BEGIN PRIVATE KEY");
    const audit = await auditText();
    expect(audit).not.toContain("PRIVATE KEY");
    expect(audit).toContain(stored.graph_thumbprint);
    // Leere Felder behalten Zertifikat und Schlüssel
    await mail.saveMailSettings(actor, { ...graph, graphAuth: "certificate" as const, clientSecret: "", fromName: "Neu" });
    expect((await row()).graph_thumbprint).toBe(stored.graph_thumbprint);
  });

  it.skipIf(!certificate)("lehnt Zertifikat ohne Schlüssel und Schlüssel eines anderen Zertifikats ab", async () => {
    const other = otherCertificate!;
    const base = { ...graph, graphAuth: "certificate" as const, clientSecret: "" };
    expect(await reason(mail.saveMailSettings(actor, { ...base, certificatePem: certificate!.certificatePem }))).toContain("gehören zusammen");
    expect(await reason(mail.saveMailSettings(actor, { ...base, certificatePem: certificate!.certificatePem, privateKeyPem: other.privateKeyPem }))).toContain(
      "gehört nicht zu diesem Zertifikat",
    );
    expect(await reason(mail.saveMailSettings(actor, { ...base, certificatePem: "kein Zertifikat", privateKeyPem: other.privateKeyPem }))).toContain(
      "nicht lesbar",
    );
  });

  it("erzwingt die Spalten des Versandwegs in der Datenbank", async () => {
    await mail.saveMailSettings(actor, graph);
    await expect(sql`update mail_settings set graph_tenant_id = null where id = 1`).rejects.toThrow(/mail_settings_transport/);
    await expect(sql`update mail_settings set ciphertext = null where id = 1`).rejects.toThrow(/mail_settings_transport/);
  });

  it("schreibt den Versandweg in jede Zeile des Protokolls", async () => {
    const sent: unknown[] = [];
    mail.setMailTransportForTests(() => ({ sendMail: async (m) => void sent.push(m) }));
    await mail.saveMailSettings(actor, graph);
    await mail.sendTestMail(actor);
    await mail.saveMailSettings(actor, smtp);
    await mail.sendTestMail(actor);
    const log = await sql`select transport, ok from mail_log order by created_at`;
    expect(log.map((l) => [l.transport, l.ok])).toEqual([
      ["graph", true],
      ["smtp", true],
    ]);
    expect(sent).toHaveLength(2);
  });
});
