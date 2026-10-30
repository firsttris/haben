import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kalender-Abo (Review)", () => {
  let fristen: typeof import("./fristen.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    fristen = await import("./fristen.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("lässt keinen einzelnen Wagenrücklauf (CR) aus Titel oder Detail im iCalendar stehen", () => {
    // Titel einer Einspruchsfrist kommt aus der Dateibezeichnung des ELSTER-Postfachs (Fremddaten)
    const frist = {
      id: "einspruch-1",
      art: "einspruch" as const,
      datum: "2026-11-30",
      titel: "Einspruchsfrist: Bescheid\r\nATTENDEE:mailto:x@example.com",
      detail: "Zeile 1\rZeile 2",
      status: "offen" as const,
      link: "/finanzamt",
    };
    const ics = fristen.fristenToIcs([frist], "https://haben.example", new Date("2026-10-03T10:00:00Z"));
    // Nach RFC 5545 enden Zeilen mit CRLF; ein CR ohne LF darf im Inhalt nicht vorkommen
    expect(ics.replace(/\r\n/g, "")).not.toContain("\r");
  });
});
