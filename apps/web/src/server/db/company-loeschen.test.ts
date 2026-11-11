import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../test-db.ts";

/**
 * Die Sperren der Firmendaten (0065, 0096, 0101) vergleichen bei UPDATE den alten mit dem neuen Wert. Wer die Zeile
 * löscht und mit anderen Werten neu anlegt, darf sie nicht umgehen: Nach der ersten Buchung lehnt die Datenbank das
 * Löschen ab.
 */
describe.skipIf(!testDatabaseUrl)("Firmendaten löschen und neu anlegen (Postgres)", () => {
  let sql: postgres.Sql;
  const year = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 4));

  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, company cascade`;
  });

  /** Festgeschriebene Buchung mit zwei Zeilen */
  const lockedEntry = (kontenrahmen: string, date: string) =>
    sql.begin(async (tx) => {
      const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values (${date}, 'Test', 'invoice', gen_random_uuid(), ${kontenrahmen}) returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1400', 100, 0), (${e!.id}, '8400', 0, 100)`;
      await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
    });

  /** Löscht die Firmendaten und legt sie in derselben Transaktion mit anderen Werten neu an */
  const replace = (values: { kontenrahmen: string; versteuerung: string; kleinunternehmer: boolean; rechtsform: string }) =>
    sql.begin(async (tx) => {
      await tx`delete from company`;
      await tx`insert into company (id, kontenrahmen, versteuerung, kleinunternehmer, rechtsform)
        values (1, ${values.kontenrahmen}, ${values.versteuerung}, ${values.kleinunternehmer}, ${values.rechtsform})`;
    });

  const current = async () => (await sql`select kontenrahmen, versteuerung, kleinunternehmer, rechtsform from company`)[0];

  it("Jahressperre (0065): Kontenrahmen, Versteuerung und § 19 UStG nicht über Löschen und Neuanlegen", async () => {
    const before = { kontenrahmen: "SKR03", versteuerung: "ist", kleinunternehmer: false, rechtsform: "einzelunternehmen" };
    await sql`insert into company (id, kontenrahmen, versteuerung, kleinunternehmer) values (1, 'SKR03', 'ist', false)`;
    await lockedEntry("SKR03", `${year}-01-02`);
    await expect(replace({ ...before, kontenrahmen: "SKR04" })).rejects.toThrow(/Firmendaten lassen sich nach der ersten Buchung nicht löschen/);
    await expect(replace({ ...before, versteuerung: "soll" })).rejects.toThrow(/nicht löschen/);
    await expect(replace({ ...before, kleinunternehmer: true })).rejects.toThrow(/nicht löschen/);
    expect(await current()).toEqual(before);
  });

  it("Rechtsform (0096): nicht über Löschen und Neuanlegen, auch mit Buchungen nur im Vorjahr", async () => {
    const before = { kontenrahmen: "SKR03", versteuerung: "ist", kleinunternehmer: false, rechtsform: "einzelunternehmen" };
    await sql`insert into company (id) values (1)`;
    await lockedEntry("SKR03", `${year - 1}-06-30`);
    await expect(replace({ ...before, rechtsform: "gmbh" })).rejects.toThrow(/nicht löschen/);
    expect(await current()).toEqual(before);
  });

  it("Kontenrahmen einer GmbH (0101): nicht über Löschen und Neuanlegen, auch zum Jahreswechsel", async () => {
    const before = { kontenrahmen: "SKR03", versteuerung: "soll", kleinunternehmer: false, rechtsform: "gmbh" };
    await sql`insert into company (id, versteuerung, rechtsform) values (1, 'soll', 'gmbh')`;
    await lockedEntry("SKR03", `${year - 1}-06-30`);
    await expect(replace({ ...before, kontenrahmen: "SKR04" })).rejects.toThrow(/nicht löschen/);
    expect(await current()).toEqual(before);
  });

  it("vor der ersten Buchung lassen sich die Firmendaten löschen und neu anlegen", async () => {
    await sql`insert into company (id) values (1)`;
    await replace({ kontenrahmen: "SKR04", versteuerung: "soll", kleinunternehmer: true, rechtsform: "gmbh" });
    expect(await current()).toEqual({ kontenrahmen: "SKR04", versteuerung: "soll", kleinunternehmer: true, rechtsform: "gmbh" });
    await sql`delete from company`;
    expect(await sql`select 1 from company`).toHaveLength(0);
  });

  it("das Löschen wartet auf eine laufende Buchung und sieht sie danach", async () => {
    await sql`insert into company (id) values (1)`;
    const other = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      let booked!: () => void;
      const started = new Promise<void>((resolve) => (booked = resolve));
      const booking = sql.begin(async (tx) => {
        const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
          values (${`${year}-03-01`}, 'Test', 'invoice', gen_random_uuid(), 'SKR03') returning id`;
        await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1400', 100, 0), (${e!.id}, '8400', 0, 100)`;
        await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
        booked();
        await hold;
      });
      await started;
      const removal = other`delete from company`.then(
        () => "gelöscht",
        (error: Error) => error.message,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      await booking;
      expect(await removal).toMatch(/nicht löschen/);
    } finally {
      await other.end();
    }
  });
});
