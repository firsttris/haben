import { EricGeprueftClient } from "./test-eric.ts";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Nachrichten an das Finanzamt (Postgres)", () => {
  let finanzamt: typeof import("./finanzamt.ts");
  let crypto: typeof import("./crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    finanzamt = await import("./finanzamt.ts");
    crypto = await import("./crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate elster_certificates, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland, versteuerung, kontenrahmen, einkunftsart)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY', 'ist', 'SKR03', 'selbstaendig')`;
  });

  const antrag = { topic: "vorauszahlung" as const, betreff: "Antrag auf Herabsetzung", text: "Bitte herabsetzen.", figures: { wanted: 100_000 } };

  it("prüft und sendet testweise, speichert Text, Werte und XML", async () => {
    const client = new EricGeprueftClient();
    expect((await finanzamt.sendMessage(actor, antrag, client, { kind: "validate" })).ok).toBe(true);
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "test", pin: "1234" })).rejects.toThrow(/Zertifikat/);
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
    const tested = await finanzamt.sendMessage(actor, antrag, client, { kind: "test", pin: "1234" });
    expect(tested.ok).toBe(true);
    expect(tested.pdf).toBeUndefined();
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "send", pin: "1234", herstellerId: "12345" })).rejects.toThrow(/Ohne ERiC/);

    const rows = await sql`select topic, kind, ok, figures, request_xml from elster_messages order by created_at`;
    expect(rows.map((r) => [r.topic, r.kind, r.ok])).toEqual([
      ["vorauszahlung", "validate", true],
      ["vorauszahlung", "test", true],
    ]);
    expect(rows[0]!.figures).toEqual({ wanted: 100_000 });
    expect(rows[1]!.request_xml).toContain("<Betreff>Antrag auf Herabsetzung</Betreff>");
    expect(rows[1]!.request_xml).toContain("<Hausnummer>1</Hausnummer>");
    expect((await finanzamt.listMessages()).map((m) => m.kind)).toEqual(["test", "validate"]);
    await expect(sql`delete from elster_messages`).rejects.toThrow();
  });

  it("lehnt leere Nachrichten und Anschriften ohne Hausnummer ab", async () => {
    const client = new EricGeprueftClient();
    await expect(finanzamt.sendMessage(actor, { ...antrag, betreff: " " }, client, { kind: "validate" })).rejects.toThrow(/Betreff/);
    await sql`update company set strasse = 'Am Markt'`;
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "validate" })).rejects.toThrow(/Hausnummer/);
  });

  it("rechnet den Gewinn aufs Jahr hoch", async () => {
    const basis = await finanzamt.prepaymentBasis("2026-07-02");
    expect(basis).toMatchObject({ year: 2026, until: "2026-07-02", profitSoFar: 0, profitForecast: 0, einkunftsart: "selbstaendig" });
    expect(basis.prognose).toMatchObject({ einkommensteuer: 0, gesamt: 0, jeQuartal: 0 });
  });

  it("schätzt die Steuer mit den Angaben des Vorjahres, wenn es fürs laufende Jahr keine gibt", async () => {
    const incomeTax = await import("./income-tax.ts");
    await sql`truncate income_tax_inputs`;
    expect((await finanzamt.prepaymentBasis("2026-07-02")).angabenAus).toBeNull();
    await incomeTax.saveEstAngaben(actor, 2025, { vorsorge: { a: { pkv: 500_000 } } });
    const basis = await finanzamt.prepaymentBasis("2026-07-02");
    expect(basis.angabenAus).toBe(2025);
    expect(basis.prognose.vorsorge).toBe(500_000);
    await incomeTax.saveEstAngaben(actor, 2023, {});
    await sql`delete from income_tax_inputs where year = 2025`;
    expect((await finanzamt.prepaymentBasis("2026-07-02")).angabenAus).toBeNull();
  });

  describe("Bankverbindung ändern", () => {
    let taxpayer: typeof import("./taxpayer.ts");
    beforeAll(async () => {
      taxpayer = await import("./taxpayer.ts");
    });
    const person = { idnr: "86095742719", anrede: "Herrn" as const, vorname: "Max", name: "Muster", geburtsdatum: "1980-03-15" };

    it("braucht die persönlichen Angaben und eine gültige IBAN", async () => {
      const client = new EricGeprueftClient();
      await expect(finanzamt.sendBankChange(actor, { iban: "DE89370400440532013000" }, client, { kind: "validate" })).rejects.toThrow(/Persönliche Angaben/);
      await taxpayer.saveTaxpayer(actor, { a: person });
      await expect(finanzamt.sendBankChange(actor, { iban: "DE00370400440532013000" }, client, { kind: "validate" })).rejects.toThrow(/IBAN/);
    });

    it("sendet testweise und speichert den Vorgang im Verlauf", async () => {
      const client = new EricGeprueftClient();
      await taxpayer.saveTaxpayer(actor, { a: person });
      await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
      const result = await finanzamt.sendBankChange(actor, { iban: "de89 3704 0044 0532 0130 00" }, client, { kind: "test", pin: "1234" });
      expect(result.ok).toBe(true);
      const [row] = await sql`select topic, kind, text, figures, request_xml from elster_messages where topic = 'bankverbindung'`;
      expect(row).toMatchObject({ topic: "bankverbindung", kind: "test", figures: { iban: "DE89370400440532013000" } });
      expect(row!.text).toContain("DE89 3704 0044 0532 0130 00");
      expect(row!.request_xml).toContain("<IBAN>DE89370400440532013000</IBAN>");
      expect(row!.request_xml).toContain("<Geburtsdatum>15.03.1980</Geburtsdatum>");
      expect(row!.request_xml).toContain(`<Empfaenger id="F">9198</Empfaenger>`);
    });
  });

  describe("Persönliche Angaben", () => {
    let taxpayer: typeof import("./taxpayer.ts");
    beforeAll(async () => {
      taxpayer = await import("./taxpayer.ts");
    });

    it("prüft die Identifikationsnummer und verlangt bei Zusammenveranlagung den Ehegatten", async () => {
      const a = { idnr: "86095742719", anrede: "Frau" as const, vorname: "Erika", name: "Muster", geburtsdatum: "1985-01-02" };
      await expect(taxpayer.saveTaxpayer(actor, { a: { ...a, idnr: "12345678901" } })).rejects.toThrow(/Identifikationsnummer/);
      await expect(taxpayer.saveTaxpayer(actor, { a, veranlagung: "zusammen" })).rejects.toThrow(/Ehegatten/);
      await taxpayer.saveTaxpayer(actor, { a: { ...a, idnr: "86 095 742 719" } });
      expect(await taxpayer.loadTaxpayer()).toEqual({ a: { ...a, religion: "11", beruf: "" } });
      const [audit] = await sql`select new_value from audit_log where table_name = 'company' order by id desc limit 1`;
      expect(audit!.new_value.taxpayer.a.idnr).toBe("86095742719");
    });
  });
});
