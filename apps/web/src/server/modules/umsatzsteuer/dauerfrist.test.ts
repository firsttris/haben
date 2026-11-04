import { EricGeprueftClient } from "../../test-eric.ts";
import type { ElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Dauerfristverlängerung und Sondervorauszahlung (§ 46–48 UStDV) */
describe.skipIf(!testDatabaseUrl)("Dauerfristverlängerung (Postgres)", () => {
  let dauerfrist: typeof import("./dauerfrist.ts");
  let vat: typeof import("./vat.ts");
  let zeitraum: typeof import("./zeitraum.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let bank: typeof import("../bank/bank.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    dauerfrist = await import("./dauerfrist.ts");
    vat = await import("./vat.ts");
    zeitraum = await import("./zeitraum.ts");
    fristen = await import("../finanzamt/fristen.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    reports = await import("../auswertungen/reports.ts");
    bank = await import("../bank/bank.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setCompany(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate vat_extension_submissions, vat_extensions, vat_frequencies, vat_return_submissions, vat_returns, elster_certificates,
      allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY', ${versteuerung}, ${kontenrahmen})`;
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(Buffer.from("pfx"))})`;
  }

  beforeEach(() => setCompany("SKR03", "soll"));

  /** Wie ERiC: kein simulierter Client, damit die Echtübermittlung durchgeht */
  const liveClient = (): ElsterClient => {
    const fake = new EricGeprueftClient();
    return {
      validate: (xml) => fake.validate(xml),
      send: (...args) => fake.send(...args),
      fetchPostfach: (...args) => fake.fetchPostfach(...args),
      fetchBelege: (...args) => fake.fetchBelege(...args),
    };
  };

  /** Erste Buchung: Beginn der Tätigkeit */
  async function startAt(date: string) {
    // Festgeschrieben in derselben Transaktion, wie über das Hauptbuch
    await sql.begin(async (tx) => {
      const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values (${date}, 'Start', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1200', 100, 0), (${e!.id}, '1890', 0, 100)`;
      await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
    });
  }

  /** Gesendete Voranmeldung, wie sie nach einer Echtübermittlung in der Datenbank steht */
  async function sentReturn(year: number, month: number, kz83: number, kz39 = 0) {
    await sql`insert into vat_returns (year, month, kz83, kz39, status, source, sent_at, locked_at)
      values (${year}, ${month}, ${kz83}, ${kz39}, 'sent', 'manuell', now(), now())`;
  }

  it("Vorschlag: ein Elftel der Vorauszahlungen des Vorjahres zuzüglich der angerechneten Sondervorauszahlung", async () => {
    await startAt("2024-03-01");
    for (let month = 1; month <= 11; month++) await sentReturn(2025, month, 350_000);
    // Dezember: 4.000 € abzüglich 500 € Sondervorauszahlung; berichtigt zählt die neueste
    await sentReturn(2025, 12, 100_000, 500_000);
    await sentReturn(2025, 12, 350_000, 50_000);
    const vorschlag = await dauerfrist.sondervorauszahlungVorschlag(2026);
    // 11 × 3.500 + 3.500 + 500 = 42.500 € / 11 = 3.863,63 € → 3.863 €
    expect(vorschlag).toMatchObject({ vorauszahlungen: 4_200_000, angerechnet: 50_000, months: 12, periods: 12, betrag: 386_300 });
  });

  it("Vorschlag hochgerechnet, wenn die Tätigkeit im Vorjahr begann (§ 47 Abs. 2 UStDV)", async () => {
    await startAt("2025-09-15");
    for (const month of [9, 10, 11, 12]) await sentReturn(2025, month, 275_000);
    // 11.000 € in vier angefangenen Monaten → 33.000 € → 3.000 €
    expect(await dauerfrist.sondervorauszahlungVorschlag(2025 + 1)).toMatchObject({ months: 4, betrag: 300_000 });
    expect(await dauerfrist.sondervorauszahlungVorschlag(2025)).toBeNull();
  });

  it("monatlich: Sondervorauszahlung senden, Frist einen Monat später, Kz 39 im Dezember, Vorauszahlungssoll", async () => {
    await startAt("2025-01-02");
    let xml = "";
    const spy: ElsterClient = {
      ...liveClient(),
      validate: async (body) => {
        xml = body;
        return new EricGeprueftClient().validate(body);
      },
    };
    await expect(dauerfrist.submitDauerfrist(actor, spy, { kind: "validate", year: 2026, sondervorauszahlung: null, berichtigt: false })).rejects.toThrow(
      "Bei monatlicher Abgabe gehört zum Antrag die Sondervorauszahlung",
    );
    const check = await dauerfrist.submitDauerfrist(actor, spy, { kind: "validate", year: 2026, sondervorauszahlung: 400_000, berichtigt: false });
    expect(check.ok).toBe(true);
    expect(xml).toContain("<Umsatzsteuersondervorauszahlung>");
    expect(xml).toContain("<Kz38>4000</Kz38>");
    expect(await dauerfrist.dauerfristFor(2026)).toBe(false);

    const sent = await dauerfrist.submitDauerfrist(actor, liveClient(), {
      kind: "send",
      year: 2026,
      sondervorauszahlung: 400_000,
      berichtigt: false,
      pin: "1234",
      herstellerId: "12345",
    });
    expect(sent.ok, sent.message).toBe(true);
    expect(await dauerfrist.loadDauerfrist()).toEqual([{ year: 2026, active: true, sondervorauszahlung: 400_000 }]);
    await expect(
      dauerfrist.submitDauerfrist(actor, liveClient(), {
        kind: "send",
        year: 2026,
        sondervorauszahlung: 410_000,
        berichtigt: false,
        pin: "1",
        herstellerId: "12345",
      }),
    ).rejects.toThrow("berichtigte Anmeldung");

    // Fristen: Oktober am 10. Dezember statt 10. November; die Sondervorauszahlung 2027 steht als offene Frist
    const list = await fristen.listFristen("2026-11-04");
    expect(list.find((f) => f.id === "ustva-2026-10")?.datum).toBe("2026-12-10");
    expect(list.find((f) => f.id === "ustva-2026-12")?.datum).toBe("2027-02-10");
    expect(list.find((f) => f.id === "svz-2027")).toMatchObject({ datum: "2027-02-10", status: "offen" });

    // Kz 39 nur im Dezember, und eine Berichtigung übernimmt ihn
    expect((await vat.computedValues({ year: 2026, month: 11 })).kz39).toBe(0);
    const december = await vat.saveDraft(actor, { year: 2026, month: 12 }, { mode: "berechnet" });
    expect(december).toMatchObject({ kz39: 400_000, kz83: -400_000 });
    await vat.submitReturn(actor, december.id, spy, { kind: "validate" });
    expect(xml).toContain("<Kz39>4000.00</Kz39>");
    expect(xml).toContain("<Kz83>-4000.00</Kz83>");

    // Vorauszahlungssoll der Jahreserklärung: gesendete Kz 83 plus Sondervorauszahlung
    await sql`update vat_returns set status = 'sent', sent_at = now(), locked_at = now() where id = ${december.id}`;
    expect((await annual.ustYear(2026)).figures.vorauszahlungen).toBe(-400_000 + 400_000);
  }, 30_000);

  it("vierteljährlich: Antrag ohne Sondervorauszahlung, gilt auch in den Folgejahren", async () => {
    await startAt("2025-01-02");
    await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" });
    await expect(
      dauerfrist.submitDauerfrist(actor, liveClient(), { kind: "validate", year: 2026, sondervorauszahlung: 100, berichtigt: false }),
    ).rejects.toThrow("keine Sondervorauszahlung");
    const sent = await dauerfrist.submitDauerfrist(actor, liveClient(), {
      kind: "send",
      year: 2026,
      sondervorauszahlung: null,
      berichtigt: false,
      pin: "1234",
      herstellerId: "12345",
    });
    expect(sent.ok, sent.message).toBe(true);
    const [row] = await sql`select request_xml from vat_extension_submissions where kind = 'send'`;
    expect(row?.request_xml).toContain("<Dauerfristverlaengerung>");
    expect(await dauerfrist.dauerfristFor(2027)).toBe(true);
    const list = await fristen.listFristen("2026-11-04");
    // 3. Quartal: 10. November statt 10. Oktober; keine Sondervorauszahlung als Frist
    expect(list.find((f) => f.id === "ustva-2026-Q3")?.datum).toBe("2026-11-10");
    expect(list.find((f) => f.id === "ustva-2026-Q4")?.datum).toBe("2027-02-10");
    expect(list.some((f) => f.id.startsWith("svz-"))).toBe(false);
    // Kein Abzug in Kz 39
    expect((await vat.computedValues({ year: 2026, month: 44 })).kz39).toBe(0);
  }, 30_000);

  it("befreit: kein Antrag", async () => {
    await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "keine" });
    await expect(
      dauerfrist.submitDauerfrist(actor, liveClient(), { kind: "validate", year: 2026, sondervorauszahlung: null, berichtigt: false }),
    ).rejects.toThrow("keine Voranmeldung eingestellt");
  });

  it("von Hand eingetragen und beendet, mit Audit-Log; Übermittlungen sind nur anhängbar", async () => {
    await dauerfrist.saveDauerfrist(actor, { year: 2025, active: true, sondervorauszahlung: 120_000 });
    await expect(dauerfrist.saveDauerfrist(actor, { year: 2025, active: true, sondervorauszahlung: 120_050 })).rejects.toThrow("vollen Euro");
    expect(await dauerfrist.dauerfristFor(2026)).toBe(true);
    await dauerfrist.saveDauerfrist(actor, { year: 2027, active: false, sondervorauszahlung: 999_900 });
    expect(await dauerfrist.loadDauerfrist()).toEqual([
      { year: 2025, active: true, sondervorauszahlung: 120_000 },
      { year: 2027, active: false, sondervorauszahlung: null },
    ]);
    expect(await dauerfrist.dauerfristFor(2027)).toBe(false);
    const audit = await sql`select action, actor, new_value from audit_log where table_name = 'vat_extensions' order by seq desc limit 2`;
    expect(audit.map((r) => [r.action, r.actor, r.new_value.year])).toEqual([
      ["INSERT", actor, 2027],
      ["INSERT", actor, 2025],
    ]);
    await dauerfrist.submitDauerfrist(actor, liveClient(), { kind: "validate", year: 2026, sondervorauszahlung: 100_000, berichtigt: false });
    await expect(sql`delete from vat_extension_submissions`).rejects.toThrow();
  });

  // Die Sondervorauszahlung wird in der letzten Voranmeldung angerechnet, für die die Verlängerung gilt (§ 48 Abs. 4 UStDV).
  // Ein Ende im Lauf des Jahres bildet Haben nicht ab: Ist sie echt angemeldet oder gezahlt, fiele sie beim Beenden aus
  // Kz 39 und dem Vorauszahlungssoll. Ein nur von Hand eingetragener Stand lässt sich dagegen zurücknehmen.
  it("von Hand eingetragen lässt sich zurücknehmen; echt angemeldet erst ab dem Folgejahr beenden", async () => {
    await dauerfrist.saveDauerfrist(actor, { year: 2026, active: true, sondervorauszahlung: 120_000 });
    await dauerfrist.saveDauerfrist(actor, { year: 2026, active: false, sondervorauszahlung: null });
    expect(await dauerfrist.dauerfristFor(2026)).toBe(false);

    await dauerfrist.saveDauerfrist(actor, { year: 2026, active: true, sondervorauszahlung: 120_000 });
    await sql`insert into vat_extension_submissions (year, kz38, kind, ok, code, message, request_xml, response_xml, server_response_xml)
      values (2026, 120000, 'send', true, 0, 'ok', '', '', '')`;
    await expect(dauerfrist.saveDauerfrist(actor, { year: 2026, active: false, sondervorauszahlung: null })).rejects.toThrow("Folgejahr");
    expect(await dauerfrist.loadDauerfrist()).toEqual([{ year: 2026, active: true, sondervorauszahlung: 120_000 }]);
    await dauerfrist.saveDauerfrist(actor, { year: 2027, active: false, sondervorauszahlung: null });
    expect(await dauerfrist.dauerfristFor(2027)).toBe(false);
  });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Zahlung der Sondervorauszahlung bucht ${kontenrahmen} (${versteuerung}) auf „Umsatzsteuer-Vorauszahlungen 1/11“ und zählt in der EÜR`, async () => {
        await setCompany(kontenrahmen, versteuerung);
        const csv = new TextEncoder().encode(
          `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"10.02.26";"10.02.26";"Gebucht";"Testfirma";"Finanzamt Regensburg";"USt-Sondervorauszahlung 2026";"Ausgang";"DE02100100100006820101";"-4.000,00";"";"";""\n`,
        );
        await bank.importStatement(actor, { bytes: csv, filename: "a.csv" }, null);
        const [tx] = await sql`select id from bank_transactions`;
        await bank.allocate(actor, { kind: "sondervorauszahlung", transactionId: tx!.id, amount: -400_000 });
        const lines = await sql`select account, debit, credit from journal_lines order by account`;
        const konto = kontenrahmen === "SKR03" ? "1781" : "3830";
        const bankKonto = kontenrahmen === "SKR03" ? "1200" : "1800";
        expect(lines.map((l) => [l.account, Number(l.debit), Number(l.credit)])).toEqual(
          [
            [konto, 400_000, 0],
            [bankKonto, 0, 400_000],
          ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        );
        const euer = await reports.euerForYear(2026);
        expect(euer.ausgaben.find((l) => l.key === "gezahlteUst")?.amount).toBe(400_000);
      }, 30_000);
    }
  }
});
