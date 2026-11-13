import type { ElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";

/** #652: Eine geänderte Dauerfrist darf übermittelte Jahreserklärungen nur mit einem Hinweis berühren, nicht verändern. */
describe.skipIf(!testDatabaseUrl)("Dauerfriständerung nach übermittelter EÜR/ESt (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let dauerfrist: typeof import("./dauerfrist.ts");
  const actor = "dauerfrist-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    dauerfrist = await import("./dauerfrist.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate annual_submissions, vat_extensions, vat_extension_submissions, vat_return_submissions, vat_returns,
      allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen) values (1, 'Testfirma', 'ist', 'SKR03')`;
  });

  async function payment({ year = 2026, month = 12, day = "08", refund = false } = {}) {
    const amount = refund ? "190,00" : "-190,00";
    const purpose = crypto.randomUUID();
    const date = `${day}.01.${String(year + 1).slice(-2)}`;
    const bytes = new TextEncoder().encode(
      `"Girokonto";"DE89370400440532013000"\n\n` +
        `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
        `"${date}";"${date}";"Gebucht";"Testfirma";"Finanzamt";"${purpose}";"Überweisung";"DE02100100100006820101";"${amount}";"";"";""\n`,
    );
    await bank.importStatement(actor, { bytes, filename: "konto.csv" }, null);
    const [t] = await sql`select id from bank_transactions where purpose = ${purpose}`;
    const [v] = await sql`insert into vat_returns (year, month, kz83, status, source, sent_at, locked_at)
      values (${year}, ${month}, ${refund ? -19_000 : 19_000}, 'sent', 'manuell', now(), now()) returning id`;
    await bank.allocate(actor, { kind: "ustva", transactionId: t!.id, vatReturnId: v!.id, amount: refund ? 19_000 : -19_000 });
    return (await sql`select id from allocations where transaction_id = ${t!.id}`)[0]!.id as string;
  }

  async function filed(year: number, form = "euer", kind = "send", ok = true) {
    await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
      values (${form}, ${year}, ${kind}, ${ok}, 0, 'Testübermittlung', '{"unveraendert": true}'::jsonb, '<x/>', '<x/>', '<x/>')`;
  }
  const save = (active: boolean, year = 2026) => dauerfrist.saveDauerfrist(actor, { year, active, sondervorauszahlung: null });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Eintragen nennt die übermittelte EÜR des Vorjahres und lässt Originale unverändert (${kontenrahmen}/${versteuerung})`, async () => {
        await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung} where id = 1`;
        await payment();
        await filed(2026);
        const originals = await sql`select * from annual_submissions`;
        const journal = await sql`select * from journal_entries order by id`;
        expect(await save(true)).toMatchObject({ euerHinweis: expect.stringContaining("EÜR 2026") });
        expect(await dauerfrist.dauerfristFor(2026)).toBe(true);
        expect(await sql`select * from annual_submissions`).toEqual(originals);
        expect(await sql`select * from journal_entries order by id`).toEqual(journal);
      });
      it(`Beenden nennt die übermittelte ESt des Zahlungsjahres (${kontenrahmen}/${versteuerung})`, async () => {
        await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung} where id = 1`;
        await save(true);
        await payment();
        await filed(2027, "est");
        const originals = await sql`select * from annual_submissions`;
        expect(await save(false)).toMatchObject({ euerHinweis: expect.stringContaining("Einkommensteuererklärung 2027") });
        expect(await dauerfrist.dauerfristFor(2026)).toBe(false);
        expect(await sql`select * from annual_submissions`).toEqual(originals);
      });
    }

  it("Eintragen nennt auch eine außerhalb von Haben abgegebene und vermerkte EÜR (#760)", async () => {
    await payment();
    await filed(2026, "euer", "vermerk");
    expect(await save(true)).toMatchObject({ euerHinweis: expect.stringContaining("EÜR 2026") });
  });

  for (const scenario of [
    "keine Abgabe",
    "nur geprüft",
    "fehlgeschlagen",
    "anderes Jahr",
    "nur USt",
    "keine Zahlung",
    "Oktober",
    "11. Januar",
    "Erstattung",
    "aufgehoben",
    "unverändert",
  ] as const)
    it(`kein Hinweis: ${scenario}`, async () => {
      const allocation =
        scenario === "keine Zahlung"
          ? null
          : await payment({ month: scenario === "Oktober" ? 10 : 12, day: scenario === "11. Januar" ? "11" : "08", refund: scenario === "Erstattung" });
      if (scenario === "aufgehoben") await bank.reverseAllocation(actor, allocation!);
      if (scenario !== "keine Abgabe")
        await filed(
          scenario === "anderes Jahr" ? 2025 : 2026,
          scenario === "nur USt" ? "ust" : "euer",
          scenario === "nur geprüft" ? "validate" : "send",
          scenario !== "fehlgeschlagen",
        );
      if (scenario === "unverändert") await save(true);
      expect(await save(true)).toEqual({ euerHinweis: null });
    });

  it("November-Vorauszahlung wird mit Dauerfrist am 10. Januar fällig und ist ebenfalls betroffen", async () => {
    // § 18 Abs. 1 UStG + § 46 UStDV: 10. Dezember wird 10. Januar; dieselbe bestehende Zehn-Tage-Regel wie in der EÜR.
    await payment({ month: 11 });
    await filed(2026);
    expect(await save(true)).toMatchObject({ euerHinweis: expect.stringContaining("EÜR 2026") });
  });

  it("vierteljährliche Dezember-Vorauszahlung nennt beide betroffenen Jahreserklärungen", async () => {
    await payment({ month: 44 });
    await filed(2026);
    await filed(2027, "est");
    expect(await save(true)).toMatchObject({ euerHinweis: expect.stringContaining("EÜR 2026") });
    await save(false);
    expect(await save(true)).toMatchObject({ euerHinweis: expect.stringContaining("Einkommensteuererklärung 2027") });
  });

  it("Änderung eines Vorjahres berücksichtigt die geerbte Dauerfrist späterer Jahre", async () => {
    await payment({ year: 2027 });
    await filed(2028);
    expect(await save(true, 2025)).toMatchObject({ euerHinweis: expect.stringContaining("EÜR 2028") });
  });

  it("ein eigener späterer Stand verhindert einen unzutreffenden Hinweis", async () => {
    await save(false, 2027);
    await payment({ year: 2027 });
    await filed(2028);
    expect(await save(true, 2025)).toEqual({ euerHinweis: null });
  });

  it("GmbH: Eine übermittelte E-Bilanz löst keinen EÜR-Hinweis aus", async () => {
    await sql`update company set rechtsform = 'gmbh', name = 'Test GmbH' where id = 1`;
    await payment();
    await filed(2026, "ebilanz");
    expect(await save(true)).toEqual({ euerHinweis: null });
  });

  for (const kind of ["send", "test", "validate", "abgelehnt"] as const)
    it(`ELSTER-Ergebnis nennt den EÜR-Hinweis nur nach erfolgreichem Eintragen (${kind})`, async () => {
      await sql`update company set strasse = 'Musterstraße 1', plz = '93047', ort = 'Regensburg',
        bundesland = 'BY', steuernummer = '198/113/10010' where id = 1`;
      const { encrypt } = await import("../../crypto.ts");
      await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${encrypt(Buffer.from("pfx"))})`;
      await payment();
      await filed(2026);
      const original = await sql`select * from annual_submissions`;
      const fake = new EricGeprueftClient();
      const client: ElsterClient = {
        validate: (xml) => fake.validate(xml),
        send: async (...args) => {
          const result = await fake.send(...args);
          return kind === "abgelehnt" ? { ...result, ok: false, code: 1, message: "Testablehnung" } : result;
        },
        fetchPostfach: (...args) => fake.fetchPostfach(...args),
        fetchBelege: (...args) => fake.fetchBelege(...args),
      };
      expect(
        await dauerfrist.submitDauerfrist(actor, client, {
          year: 2026,
          kind: kind === "abgelehnt" ? "send" : kind,
          sondervorauszahlung: 0,
          berichtigt: false,
          pin: "1234",
          herstellerId: "12345",
        }),
      ).toMatchObject({ euerHinweis: kind === "send" ? expect.stringContaining("EÜR 2026") : null });
      expect(await dauerfrist.dauerfristFor(2026)).toBe(kind === "send");
      expect(await sql`select * from annual_submissions`).toEqual(original);
    });
});
