import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("SEPA-Lastschriftmandate am Kontakt (Postgres, #445)", () => {
  let sql: postgres.Sql;
  let mandates: typeof import("./sepa-mandate.ts");
  const actor = "test-user";
  let contactId: string;
  const pdf = (text = "Mandat") => ({ filename: "mandat.pdf", bytes: new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF`) });
  const input = (overrides: Record<string, unknown> = {}) => ({
    reference: "KD-1042-01",
    signedOn: "2026-10-01",
    scheme: "CORE" as const,
    firstSequence: "FRST" as const,
    lastCollectionBefore: null,
    debtorName: "Nordwerk Software GmbH",
    debtorIban: "DE02 1203 0000 0000 2020 51",
    debtorBic: "",
    ...overrides,
  });

  beforeAll(async () => {
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), "haben-mandate-"));
    sql = await setupTestDb();
    mandates = await import("./sepa-mandate.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate sepa_mandate_files, sepa_mandate_revocations, sepa_mandates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
    [{ id: contactId }] =
      (await sql`insert into contacts (name, iban) values ('Nordwerk Software GmbH', 'DE02120300000000202051') returning id`) as unknown as [{ id: string }];
  });

  it("legt ein Mandat an, mit IBAN ohne Leerzeichen, und zeigt es am Kontakt als gültig", async () => {
    const id = await mandates.createMandate(actor, contactId, input(), "2026-11-09");
    const [mandat] = await mandates.listMandates(contactId, "2026-11-09");
    expect(mandat).toMatchObject({ id, reference: "KD-1042-01", debtorIban: "DE02120300000000202051", scheme: "CORE", firstSequence: "FRST" });
    expect(mandat!.status).toEqual({ art: "gueltig", bis: "2029-09-30" });
    expect(mandat!.file).toBeNull();
    expect(mandat!.revocation).toBeNull();
    const audit = await sql`select count(*)::int as n from audit_log where table_name = 'sepa_mandates'`;
    expect(audit[0]!.n).toBe(1);
  });

  it("lehnt eine Referenz ab, die es schon gibt, auch bei einem anderen Kontakt", async () => {
    await mandates.createMandate(actor, contactId, input(), "2026-11-09");
    const [{ id: other }] = (await sql`insert into contacts (name) values ('Rheinpixel GmbH') returning id`) as unknown as [{ id: string }];
    await expect(mandates.createMandate(actor, other, input(), "2026-11-09")).rejects.toThrow(
      "Die Mandatsreferenz KD-1042-01 gibt es schon (Nordwerk Software GmbH).",
    );
    // Groß- und Kleinschreibung zählen bei der Mandatsreferenz nicht (DK, Anlage 3 V3.9, Kap. 2.2.2)
    await expect(mandates.createMandate(actor, other, input({ reference: "kd-1042-01" }), "2026-11-09")).rejects.toThrow(
      "Die Mandatsreferenz kd-1042-01 gibt es schon (Nordwerk Software GmbH).",
    );
  });

  it("lehnt eine IBAN außerhalb von SEPA ab (Rulebook SDD Core und B2B v1.2, Kap. 2.2)", async () => {
    // „The Debtor and Creditor must each hold an account with a Participant located within SEPA.“ Die Türkei gehört nicht dazu.
    await expect(mandates.createMandate(actor, contactId, input({ debtorIban: "TR33 0006 1005 1978 6457 8413 26" }), "2026-11-09")).rejects.toThrow(
      "TR330006100519786457841326",
    );
    expect(await mandates.listMandates(contactId, "2026-11-09")).toEqual([]);
  });

  it("meldet einen Tag, den es nicht gibt, als Eingabefehler statt als internen Fehler", async () => {
    await expect(mandates.createMandate(actor, contactId, input({ signedOn: "2026-02-30" }), "2026-11-09")).rejects.toThrow(/Datum/);
  });

  it("prüft IBAN, Referenz und Daten", async () => {
    await expect(mandates.createMandate(actor, contactId, input({ debtorIban: "DE00120300000000202051" }), "2026-11-09")).rejects.toThrow(
      "Die IBAN DE00120300000000202051 ist ungültig.",
    );
    await expect(mandates.createMandate(actor, contactId, input({ reference: "Müller_1" }), "2026-11-09")).rejects.toThrow("Die Mandatsreferenz darf nur");
    await expect(mandates.createMandate(actor, contactId, input({ signedOn: "2026-11-10" }), "2026-11-09")).rejects.toThrow(
      "Das Datum der Unterschrift liegt in der Zukunft.",
    );
    await expect(mandates.createMandate(actor, contactId, input({ firstSequence: "FRST", lastCollectionBefore: "2026-10-15" }), "2026-11-09")).rejects.toThrow(
      "Nach einem Einzug vor Haben ist der nächste eine Folgelastschrift.",
    );
    await expect(mandates.createMandate(actor, contactId, input({ firstSequence: "RCUR", lastCollectionBefore: "2026-09-15" }), "2026-11-09")).rejects.toThrow(
      "Der letzte Einzug liegt vor der Unterschrift.",
    );
  });

  it("ein übernommenes Mandat zählt die 36 Monate ab dem letzten Einzug vor Haben", async () => {
    await mandates.createMandate(actor, contactId, input({ signedOn: "2021-05-03", firstSequence: "RCUR", lastCollectionBefore: "2024-02-01" }), "2026-11-09");
    const [mandat] = await mandates.listMandates(contactId, "2026-11-09");
    expect(mandat!.status).toEqual({ art: "gueltig", bis: "2027-01-31" });
    const [abgelaufen] = await mandates.listMandates(contactId, "2027-02-01");
    expect(abgelaufen!.status).toEqual({ art: "abgelaufen", seit: "2027-02-01" });
  });

  it("nur an Kunden", async () => {
    await sql`update contacts set is_customer = false, is_supplier = true where id = ${contactId}`;
    await expect(mandates.createMandate(actor, contactId, input(), "2026-11-09")).rejects.toThrow("Ein Lastschriftmandat gibt es nur von Kunden.");
  });

  it("Widerruf: einmal, nicht vor der Unterschrift, danach widerrufen", async () => {
    const id = await mandates.createMandate(actor, contactId, input(), "2026-11-09");
    await expect(mandates.revokeMandate(actor, id, { revokedOn: "2026-09-30", reason: "" })).rejects.toThrow("Der Widerruf liegt vor der Unterschrift.");
    await mandates.revokeMandate(actor, id, { revokedOn: "2026-11-09", reason: "Vertrag gekündigt" });
    const [mandat] = await mandates.listMandates(contactId, "2026-11-09");
    expect(mandat!.status).toEqual({ art: "widerrufen", seit: "2026-11-09" });
    expect(mandat!.revocation).toMatchObject({ revokedOn: "2026-11-09", reason: "Vertrag gekündigt" });
    await expect(mandates.revokeMandate(actor, id, { revokedOn: "2026-11-10", reason: "" })).rejects.toThrow("Das Mandat ist schon widerrufen.");
  });

  it("PDF des Mandats: nur PDF, das jüngste gilt, das ältere bleibt erhalten", async () => {
    const id = await mandates.createMandate(actor, contactId, input(), "2026-11-09");
    await expect(mandates.addMandateFile(actor, id, { filename: "scan.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })).rejects.toThrow(
      "nur PDF-Dateien",
    );
    await mandates.addMandateFile(actor, id, pdf("erste Fassung"));
    await mandates.addMandateFile(actor, id, pdf("unterschrieben"));
    const [mandat] = await mandates.listMandates(contactId, "2026-11-09");
    const file = await mandates.mandateFile(id);
    expect(mandat!.file).toMatchObject({ filename: "mandat.pdf" });
    expect(file!.sha256).toBe(mandat!.file!.sha256);
    const rows = await sql`select count(*)::int as n from sepa_mandate_files where mandate_id = ${id}`;
    expect(rows[0]!.n).toBe(2);
  });

  it("Mandat, PDF und Widerruf sind nur anhängbar", async () => {
    const id = await mandates.createMandate(actor, contactId, input(), "2026-11-09");
    await mandates.addMandateFile(actor, id, pdf());
    await mandates.revokeMandate(actor, id, { revokedOn: "2026-11-09", reason: "" });
    await expect(sql`update sepa_mandates set debtor_iban = 'DE89370400440532013000' where id = ${id}`).rejects.toThrow();
    await expect(sql`delete from sepa_mandate_files where mandate_id = ${id}`).rejects.toThrow();
    await expect(sql`delete from sepa_mandate_revocations where mandate_id = ${id}`).rejects.toThrow();
  });

  it("die Datei des Mandats gilt im Dokumentenspeicher als genutzt", async () => {
    const id = await mandates.createMandate(actor, contactId, input(), "2026-11-09");
    await mandates.addMandateFile(actor, id, pdf("genutzt"));
    const { fileInUse } = await import("../../db/file-in-use.ts");
    const { db } = await import("../../db/index.ts");
    const file = await mandates.mandateFile(id);
    expect(await db.transaction((tx) => fileInUse(tx, file!.sha256))).toBe(true);
  });

  describe("Gläubiger-ID in den Firmendaten", () => {
    it("speichert sie ohne Leerzeichen in Großbuchstaben", async () => {
      const company = await import("./company.ts");
      const guard = await import("./settings-guard.ts");
      const current = company.companySchema.parse(await company.loadCompany());
      await guard.saveCompany(actor, company.companySchema.parse({ ...current, glaeubigerId: "de98 zzz 0999 9999 999" }), "2026-11-09");
      expect((await company.loadCompany()).glaeubigerId).toBe("DE98ZZZ09999999999");
    });

    it("lehnt eine falsche Prüfziffer ab, leer bleibt erlaubt", async () => {
      const company = await import("./company.ts");
      const current = company.companySchema.parse(await company.loadCompany());
      const wrong = company.companySchema.safeParse({ ...current, glaeubigerId: "DE97ZZZ09999999999" });
      expect(wrong.success).toBe(false);
      expect(wrong.error!.issues[0]!.message).toBe("Die Prüfziffer der Gläubiger-ID stimmt nicht.");
      expect(company.companySchema.parse({ ...current, glaeubigerId: "" }).glaeubigerId).toBe("");
    });
  });
});
