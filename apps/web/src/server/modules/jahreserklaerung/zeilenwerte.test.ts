import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Erklärte Zeilenwerte (#997): Eine außerhalb von Haben abgegebene Jahreserklärung hat Zeilen, die Haben
 * nicht rechnen kann. Sie hängen am Vermerk und tragen denselben GoBD-Schutz wie er selbst.
 */
describe.skipIf(!testDatabaseUrl)("Jahreserklärungen: erklärte Zeilenwerte (Postgres)", () => {
  let annual: typeof import("./annual.ts");
  let jahresvermerk: typeof import("./vermerk.ts");
  let zeilen: typeof import("./zeilenwerte.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const TODAY = "2026-10-02";

  beforeAll(async () => {
    sql = await setupTestDb();
    annual = await import("./annual.ts");
    jahresvermerk = await import("./vermerk.ts");
    zeilen = await import("./zeilenwerte.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate annual_submission_figures, annual_submissions, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
              einkunftsart, taetigkeit)
      values (1, 'Beispielfirma Nordlicht', 'Hafenstraße 5', '20457', 'Hamburg', 'buchhaltung@example.com', '+49 40 1', '22/113/10010',
              'DE123456789', 'HH', 'DE89370400440532013000', 'ist', 'SKR03', 'selbstaendig', 'Softwareentwicklung')`;
  });

  /** Einen Vermerk anlegen, an dem die Zeilen hängen können */
  async function vermerken(form: "ust" | "euer", ticket: string) {
    const berechnet = form === "ust" ? (await annual.annualOverview(2025, TODAY)).ust.abschluss : (await annual.annualOverview(2025, TODAY)).euer.gewinn;
    return jahresvermerk.vermerkeJahresabgabe(
      actor,
      form,
      2025,
      { filedOn: "2026-05-20", transferTicket: ticket, amount: berechnet, note: "Außerhalb von Haben mit WISO abgegeben." },
      TODAY,
    );
  }

  it("speichert Zeilen zu einem Vermerk und liest sie in der Jahreserklärung wieder", async () => {
    await vermerken("ust", "ABC123456789");

    const anzahl = await zeilen.speichereErklaerteZeilen(actor, "ust", 2025, [
      { field: "kz22", amount: 70_000 },
      { field: "kz87", amount: 95_546 },
      { field: "kz120", amount: -50_368 },
    ]);
    expect(anzahl).toBe(3);

    const uebersicht = await annual.annualOverview(2025, TODAY);
    expect(uebersicht.ust.erklaert).toEqual({ kz22: 70_000, kz87: 95_546, kz120: -50_368 });
  });

  it("lehnt eine Feldkennung ab, die nicht zu dieser Erklärung gehört", async () => {
    await vermerken("ust", "ABC123456789");
    // kz15 ist eine Zeile der Anlage EÜR, nicht der Umsatzsteuererklärung
    await expect(zeilen.speichereErklaerteZeilen(actor, "ust", 2025, [{ field: "kz15", amount: 100 }])).rejects.toThrow(/gehört nicht zu dieser Erklärung/);
  });

  it("lehnt eine doppelte Feldkennung ab", async () => {
    await vermerken("euer", "ABC123456789");
    await expect(
      zeilen.speichereErklaerteZeilen(actor, "euer", 2025, [
        { field: "gewinn", amount: 100 },
        { field: "gewinn", amount: 200 },
      ]),
    ).rejects.toThrow(/steht doppelt/);
  });

  it("meldet eine schon gespeicherte Feldkennung als Fehler der Eingabe, nicht als Datenbankfehler", async () => {
    await vermerken("ust", "ABC123456789");
    await zeilen.speichereErklaerteZeilen(actor, "ust", 2025, [{ field: "kz22", amount: 70_000 }]);
    // Zweiter Tab oder erneutes Absenden: Die Server-Funktion gibt nur AnnualError als Meldung zurück, alles andere wird ein 500
    const zweites = zeilen.speichereErklaerteZeilen(actor, "ust", 2025, [{ field: "kz22", amount: 7_000 }]);
    await expect(zweites).rejects.toBeInstanceOf(annual.AnnualError);
    await expect(zweites).rejects.toThrow(/schon gespeichert/);
    const [zaehlung] = await sql<{ anzahl: number }[]>`select count(*)::int as anzahl from annual_submission_figures`;
    expect(zaehlung?.anzahl).toBe(1);
  });

  it("lehnt Zeilen ohne Vermerk ab", async () => {
    // Kein Vermerk für 2025: es gibt keine abgegebene Erklärung, zu der die Zeilen gehören könnten
    await expect(zeilen.speichereErklaerteZeilen(actor, "ust", 2025, [{ field: "kz22", amount: 100 }])).rejects.toThrow(/keinen Vermerk/);
  });

  it("hält die erklärten Zeilen eines Vermerks wie den Vermerk selbst: im Audit-Log, nur anhängbar, nicht leerbar", async () => {
    await vermerken("ust", "ABC123456789");
    await zeilen.speichereErklaerteZeilen(actor, "ust", 2025, [{ field: "kz22", amount: 70_000 }]);

    const [row] = await sql<{ id: string }[]>`select id from annual_submission_figures`;
    expect(row).toBeTruthy();

    // Im Audit-Log, dem Nutzer zugeschrieben
    const [log] = await sql<{ actor: string }[]>`select actor from audit_log
      where table_name = 'annual_submission_figures' and row_id = ${row!.id}::text`;
    expect(log?.actor).toBe(actor);

    // Nur anhängbar: ein UPDATE scheitert
    await expect(sql`update annual_submission_figures set amount = 1 where id = ${row!.id}`).rejects.toThrow(/darf nur ergänzt werden/);

    // Nicht leerbar: TRUNCATE scheitert auch außerhalb der Testhilfe
    await expect(sql`truncate annual_submission_figures`).rejects.toThrow(/TRUNCATE/i);
  });
});
