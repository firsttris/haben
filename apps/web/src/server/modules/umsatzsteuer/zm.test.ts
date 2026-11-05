import type { ElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";

/** Zusammenfassende Meldung (§ 18a UStG): Zeilen aus den Rechnungen, Vorprüfung, Übermittlung, Berichtigung, Sperre, Fristen */
describe.skipIf(!testDatabaseUrl)("Zusammenfassende Meldung (Postgres)", () => {
  let zm: typeof import("./zm.ts");
  let figures: typeof import("./vat-figures.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/bank.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const q3 = { year: 2026, month: 43 };
  const q4 = { year: 2026, month: 44 };

  beforeAll(async () => {
    sql = await setupTestDb();
    zm = await import("./zm.ts");
    figures = await import("./vat-figures.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/bank.ts");
    fristen = await import("../finanzamt/fristen.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setCompany(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", ustId = "DE136695976") {
    await sql`truncate zm_submissions, vat_return_submissions, vat_returns, elster_certificates, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts,
      company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              ${ustId}, 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(Buffer.from("pfx"))})`;
  }

  const kunden = new Map<string, string>();
  async function kunde(name: string, land: string, ustId: string) {
    const known = kunden.get(`${name}-${ustId}`);
    if (known) return known;
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name,
      strasse: "Ring 1",
      plz: "1010",
      ort: "Wien",
      land,
      email: "a@b.example",
      ustId,
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    kunden.set(`${name}-${ustId}`, contact.id);
    return contact.id;
  }

  async function rechnung(
    issueDate: string,
    net: number,
    options: { name?: string; land?: string; ustId?: string; treatment?: "reverse_charge" | "regulaer" } = {},
  ) {
    const { name = "Alpenblick GmbH", land = "AT", ustId = "ATU12345678", treatment = "reverse_charge" } = options;
    const draft = await invoices.createDraft(actor, {
      contactId: await kunde(name, land, ustId),
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: treatment,
      exemptionReason: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: treatment === "regulaer" ? 1900 : 0 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  /** Wie ERiC: kein simulierter Client, damit die Echtübermittlung durchgeht; jedes XML geht durch das echte Plugin, wenn da */
  let lastXml = "";
  const liveClient = (): ElsterClient => {
    const fake = new EricGeprueftClient();
    return {
      validate: (xml) => {
        lastXml = xml;
        return fake.validate(xml);
      },
      send: (xml, ...rest) => {
        lastXml = xml;
        return fake.send(xml, ...rest);
      },
      fetchPostfach: (...args) => fake.fetchPostfach(...args),
      fetchBelege: (...args) => fake.fetchBelege(...args),
    };
  };
  const senden = (period = q3) => zm.submitZm(actor, liveClient(), { kind: "send", period, pin: "1234", herstellerId: "12345" });

  it.each([
    ["SKR03", "soll"],
    ["SKR03", "ist"],
    ["SKR04", "soll"],
    ["SKR04", "ist"],
  ] as const)(
    "%s, %s: je USt-IdNr. summiert wie Kz 21, nach Rechnungsdatum auch bei Ist",
    async (kontenrahmen, versteuerung) => {
      await setCompany(kontenrahmen, versteuerung);
      kunden.clear();
      await rechnung("2026-07-10", 100_050);
      await rechnung("2026-09-30", 200_000);
      await rechnung("2026-08-01", 70_000, { name: "Lumière SARL", land: "FR", ustId: "fr 12 345678901" });
      await rechnung("2026-08-15", 50_000, { name: "Inlandskunde GmbH", land: "DE", ustId: "", treatment: "regulaer" });
      await rechnung("2026-10-01", 999_900);

      const overview = await zm.zmOverview(q3);
      expect(overview.zeilen).toEqual([
        { ustId: "ATU12345678", art: "S", betrag: 300_050 },
        { ustId: "FR12345678901", art: "S", betrag: 70_000 },
      ]);
      expect(overview.naechste).toEqual({ berichtigt: false, zeilen: overview.zeilen });
      expect(overview.frist).toBe("2026-10-26");
      expect((await figures.computeVatFigures(q3)).kz21).toBe(370_050);
      expect(overview.issues).toEqual([expect.objectContaining({ tone: "info", text: expect.stringContaining("Kz 21") })]);

      const result = await zm.submitZm(actor, liveClient(), { kind: "validate", period: q3 });
      expect(result.ok, result.message).toBe(true);
      expect(lastXml).toContain(`<zeile umsatzart="S"><knre>ATU12345678</knre><betrag>3000</betrag></zeile>`);
      expect(lastXml).toContain(`<zeile umsatzart="S"><knre>FR12345678901</knre><betrag>700</betrag></zeile>`);
      expect(lastXml).toContain("<mzr><quart>3</quart><jahr>2026</jahr></mzr>");
    },
    60_000,
  );

  it("Storno und Gutschrift mindern im Quartal, in dem sie ausgestellt sind; Skonto im Quartal der Ausbuchung", async () => {
    await setCompany("SKR03", "soll");
    kunden.clear();
    const a = await rechnung("2026-09-10", 400_000);
    const b = await rechnung("2026-09-11", 100_000, { name: "Lumière SARL", land: "FR", ustId: "FR12345678901" });
    await invoices.cancelInvoice(actor, a.id, "2026-10-05");
    const korrektur = await invoices.createCorrection(actor, b.id, "2026-10-06");
    await invoices.finalizeInvoice(actor, korrektur.id);
    await rechnung("2026-11-02", 500_000, { name: "Nordlicht AB", land: "SE", ustId: "SE123456789001" });
    const c = await rechnung("2026-10-20", 100_000, { name: "Nordlicht AB", land: "SE", ustId: "SE123456789001" });
    await bank.writeOff(actor, { kind: "skonto", invoiceId: c.id, date: "2026-11-03", amount: 2_000 });

    expect((await zm.zmOverview(q3)).zeilen).toEqual([
      { ustId: "ATU12345678", art: "S", betrag: 400_000 },
      { ustId: "FR12345678901", art: "S", betrag: 100_000 },
    ]);
    expect((await zm.zmOverview(q4)).zeilen).toEqual([
      { ustId: "ATU12345678", art: "S", betrag: -400_000 },
      { ustId: "FR12345678901", art: "S", betrag: -100_000 },
      { ustId: "SE123456789001", art: "S", betrag: 598_000 },
    ]);
    // Wie Kz 21 der Voranmeldung
    expect((await figures.computeVatFigures(q4)).kz21).toBe(-400_000 - 100_000 + 598_000);
    const check = await zm.submitZm(actor, liveClient(), { kind: "validate", period: q4 });
    expect(check.ok, check.message).toBe(true);
    expect(lastXml).toContain("<betrag>-4000</betrag>");
  }, 60_000);

  it("Echtübermittlung sperrt die Meldung; Änderungen gehen als Berichtigung mit den geänderten Zeilen", async () => {
    await setCompany("SKR04", "ist");
    kunden.clear();
    await rechnung("2026-07-10", 100_000);
    await rechnung("2026-08-10", 50_000, { name: "Lumière SARL", land: "FR", ustId: "FR12345678901" });
    expect((await fristen.listFristen("2026-10-01")).find((f) => f.id === "zm-2026-Q3")).toMatchObject({
      art: "zm",
      datum: "2026-10-26",
      status: "offen",
      link: "/umsatzsteuer/zm/2026-Q3",
    });

    const [vorher] = await sql`select count(*)::int as n from audit_log where table_name = 'zm_submissions'`;
    const sent = await senden();
    expect(sent.ok, sent.message).toBe(true);
    expect(lastXml).toContain(`meldeart="10"`);
    expect(lastXml).not.toContain("<Testmerker>");
    expect((await fristen.listFristen("2026-10-01")).find((f) => f.id === "zm-2026-Q3")?.status).toBe("erledigt");
    const overview = await zm.zmOverview(q3);
    expect(overview).toMatchObject({ sent: true, naechste: { berichtigt: true, zeilen: [] } });
    expect(overview.gemeldet).toEqual(overview.zeilen);
    await expect(senden()).rejects.toThrow("nichts zu berichtigen");

    // Gesendete Meldungen bleiben unverändert (nur anhängen)
    await expect(sql`update zm_submissions set zeilen = '[]'`).rejects.toThrow();
    await expect(sql`delete from zm_submissions`).rejects.toThrow();

    // Eine später ausgestellte Rechnung mit Datum im Quartal: Berichtigung nur mit der geänderten Zeile
    await rechnung("2026-09-20", 25_000, { name: "Lumière SARL", land: "FR", ustId: "FR12345678901" });
    expect((await zm.zmOverview(q3)).naechste).toEqual({ berichtigt: true, zeilen: [{ ustId: "FR12345678901", art: "S", betrag: 75_000 }] });
    const berichtigt = await senden();
    expect(berichtigt.ok, berichtigt.message).toBe(true);
    expect(lastXml).toContain(`meldeart="11"`);
    expect(lastXml).not.toContain("ATU12345678");
    const nachher = await zm.zmOverview(q3);
    expect(nachher.gemeldet).toEqual(nachher.zeilen);
    expect(nachher.naechste.zeilen).toEqual([]);

    const history = await zm.zmSubmissions(q3);
    expect(history.map((h) => [h.kind, h.berichtigt, h.ok, h.zeilen.length])).toEqual([
      ["send", true, true, 1],
      ["send", false, true, 2],
    ]);
    const audit = await sql`select count(*)::int as n from audit_log where table_name = 'zm_submissions'`;
    expect(audit[0]!.n - vorher!.n).toBe(2);
  }, 60_000);

  it("Vorprüfung: eigene USt-IdNr., USt-IdNr. der Kunden und Abgleich mit Kz 21", async () => {
    await setCompany("SKR03", "soll", "DE123456789");
    kunden.clear();
    await rechnung("2026-07-10", 100_000, { name: "Bergwerk AG", land: "CH", ustId: "CH123456789" });
    const issues = (await zm.zmOverview(q3)).issues;
    expect(issues.filter((i) => i.tone === "error").map((i) => i.text)).toEqual([
      expect.stringContaining("DE123456789 ist ungültig"),
      expect.stringContaining("CH123456789: kein Länderkennzeichen"),
    ]);
    await expect(zm.submitZm(actor, liveClient(), { kind: "validate", period: q3 })).rejects.toThrow("ungültig");
    expect(await zm.zmSubmissions(q3)).toEqual([]);

    await setCompany("SKR03", "soll");
    kunden.clear();
    await rechnung("2026-07-10", 100_000);
    await rechnung("2026-08-10", 50_050);
    // Monatliche Voranmeldungen: Juli und August gesendet, September fehlt noch
    const sentReturn = (month: number, kz21: number) =>
      sql`insert into vat_returns (year, month, kz21, kz83, status, source, sent_at, locked_at) values (2026, ${month}, ${kz21}, 0, 'sent', 'manuell', now(), now())`;
    await sentReturn(7, 100_000);
    await sentReturn(8, 50_000);
    expect((await zm.zmOverview(q3)).kz21).toBeNull();
    await sentReturn(9, 0);
    const passend = await zm.zmOverview(q3);
    expect(passend.kz21).toBe(150_000);
    expect(passend.issues).toEqual([]);
    // Eine Voranmeldung ohne die Leistung: Abweichung
    await sql`insert into vat_returns (year, month, kz21, kz83, status, source, sent_at, locked_at) values (2026, 8, 0, 0, 'sent', 'manuell', now() + interval '1 minute', now())`;
    expect((await zm.zmOverview(q3)).issues).toEqual([expect.objectContaining({ tone: "warn", text: expect.stringContaining("weicht von Kz 21") })]);
  }, 60_000);

  it("eine im selben Quartal stornierte Rechnung ohne gültige USt-IdNr. sperrt die Meldung nicht", async () => {
    await setCompany("SKR03", "soll");
    kunden.clear();
    // Versehentlich mit britischer USt-IdNr. festgeschrieben, im selben Quartal storniert: nichts davon ist zu melden, und die
    // festgeschriebene Rechnung lässt sich nicht mehr ändern
    const falsch = await rechnung("2026-07-10", 100_000, { name: "London Ltd", land: "GB", ustId: "GB123456789" });
    await invoices.cancelInvoice(actor, falsch.id, "2026-07-11");
    await rechnung("2026-07-12", 100_000);
    const overview = await zm.zmOverview(q3);
    expect(overview.zeilen).toEqual([{ ustId: "ATU12345678", art: "S", betrag: 100_000 }]);
    expect(overview.issues.filter((i) => i.tone === "error")).toEqual([]);
    const result = await zm.submitZm(actor, liveClient(), { kind: "validate", period: q3 });
    expect(result.ok, result.message).toBe(true);
  }, 60_000);

  it("ein Quartal, dessen Umsätze sich im Quartal aufheben, hat keine offene Frist", async () => {
    await setCompany("SKR03", "soll");
    kunden.clear();
    const a = await rechnung("2026-07-10", 100_000);
    await invoices.cancelInvoice(actor, a.id, "2026-07-11");
    expect((await zm.zmOverview(q3)).zeilen).toEqual([]);
    expect((await fristen.listFristen("2026-12-01")).filter((f) => f.art === "zm" && f.status === "offen")).toEqual([]);
  }, 60_000);

  it("nur Quartale mit Leistungen ins EU-Ausland stehen im Fristenkalender", async () => {
    await setCompany("SKR03", "soll");
    kunden.clear();
    await rechnung("2026-04-10", 50_000, { name: "Inlandskunde GmbH", land: "DE", ustId: "", treatment: "regulaer" });
    await rechnung("2026-08-10", 50_000);
    expect(await zm.zmQuartale()).toEqual([{ year: 2026, month: 43, sent: false }]);
    const ids = (await fristen.listFristen("2026-07-01")).filter((f) => f.art === "zm").map((f) => f.id);
    expect(ids).toEqual(["zm-2026-Q3"]);
  }, 60_000);
});
