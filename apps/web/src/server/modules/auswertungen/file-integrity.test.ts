import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Ein Datensatz, der während des Laufs gelöscht wird, lässt sich nur über den Zeitpunkt der Prüfung nachstellen
vi.mock("../../storage.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../storage.ts")>();
  return { ...original, checkFile: vi.fn(original.checkFile) };
});

const DAY = 24 * 60 * 60 * 1000;
const pfad = (sha256: string) => join(process.env.DOCUMENTS_DIR!, sha256.slice(0, 2), sha256);

describe.skipIf(!testDatabaseUrl)("Vollprüfung der Belegdateien (Postgres)", () => {
  let sql: postgres.Sql;
  let files: typeof import("./file-integrity.ts");
  let integrity: typeof import("./integrity.ts");
  let storage: typeof import("../../storage.ts");
  let mail: typeof import("../mail/mail.ts");
  const sent: { subject: string; text: string }[] = [];

  beforeAll(async () => {
    sql = await setupTestDb();
    files = await import("./file-integrity.ts");
    integrity = await import("./integrity.ts");
    storage = await import("../../storage.ts");
    mail = await import("../mail/mail.ts");
    mail.setMailTransportForTests(() => {
      const transport = nodemailer.createTransport({ jsonTransport: true });
      return {
        sendMail: async (message: { subject: string; text: string }) => {
          sent.push(message);
          return transport.sendMail(message);
        },
      } as unknown as ReturnType<typeof nodemailer.createTransport>;
    });
  }, 30_000);

  beforeEach(async () => {
    await leeren(sql)`truncate documents, legacy_order_files, file_checks cascade`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  /** Legt die Datei im Speicher ab und einen Beleg, der auf sie verweist */
  async function beleg(name: string, inhalt = name): Promise<{ id: string; sha256: string }> {
    const bytes = new TextEncoder().encode(`%PDF-1.4\n% ${inhalt}\n%%EOF\n`);
    const sha256 = await storage.storeFile(bytes);
    const [row] = await sql<{ id: string }[]>`insert into documents (sha256, filename, mime_type, size)
      values (${sha256}, ${name}, 'application/pdf', ${bytes.byteLength}) returning id`;
    return { id: row!.id, sha256 };
  }

  it("meldet eine gelöschte und eine veränderte Datei mit Art, Datensatz und Dateiname", async () => {
    const geloescht = await beleg("hosting.pdf");
    const veraendert = await beleg("buerobedarf.pdf");
    await beleg("telefon.pdf");
    await rm(pfad(geloescht.sha256));
    await writeFile(pfad(veraendert.sha256), "verändert");

    const result = await files.runFileCheck();
    expect(result.files).toBe(3);
    expect(result.problemCount).toBe(2);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        { tabelle: "documents", art: "Beleg", zeile: geloescht.id, datei: "hosting.pdf", sha256: geloescht.sha256, befund: "fehlt", weitere: 0 },
        { tabelle: "documents", art: "Beleg", zeile: veraendert.id, datei: "buerobedarf.pdf", sha256: veraendert.sha256, befund: "beschädigt", weitere: 0 },
      ]),
    );
  });

  /** Verweis aus einer zweiten Tabelle, ohne Auftrag und Import: Fremdschlüssel greifen wie bei einem Replikat nicht */
  async function auftragsPdf(sha256: string, name: string): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`insert into legacy_order_files (order_id, filename, mime_type, sha256, size, origin)
        values (gen_random_uuid(), ${name}, 'application/pdf', ${sha256}, 1, 'manuell')`;
    });
  }

  it("liefert für einen unversehrten Bestand keinen Befund und zählt eine Datei mit mehreren Verweisen einmal", async () => {
    const a = await beleg("vertrag.pdf");
    await auftragsPdf(a.sha256, "AB-1000.pdf");
    await beleg("miete.pdf");
    const result = await files.runFileCheck();
    expect(result).toMatchObject({ files: 2, problemCount: 0, problems: [] });
  });

  it("zählt eine fehlende Datei mit mehreren Verweisen als einen Befund und nennt die Zahl der weiteren Datensätze", async () => {
    const vertrag = await beleg("mietvertrag.pdf");
    await auftragsPdf(vertrag.sha256, "AB-1002.pdf");
    await auftragsPdf(vertrag.sha256, "AB-1003.pdf");
    await rm(pfad(vertrag.sha256));
    const result = await files.runFileCheck();
    expect(result).toMatchObject({ files: 1, problemCount: 1 });
    // Der Beleg zuerst, wie in FILE_REFERENCES
    expect(result.problems).toEqual([expect.objectContaining({ tabelle: "documents", art: "Beleg", datei: "mietvertrag.pdf", befund: "fehlt", weitere: 2 })]);
  });

  it("meldet keine fehlende Datei, deren Datensatz während des Laufs gelöscht wurde", async () => {
    const entwurf = await beleg("entwurf.pdf");
    await rm(pfad(entwurf.sha256));
    vi.mocked(storage.checkFile).mockImplementationOnce(async () => {
      // Wie deleteDocument: erst der Datensatz, dann die Datei
      await sql`delete from documents where id = ${entwurf.id}`;
      return "fehlt";
    });
    expect(await files.runFileCheck()).toMatchObject({ files: 1, problemCount: 0, problems: [] });
  });

  it("kürzt lange Listen", async () => {
    // Ohne Dateien im Speicher, etwa weil das Volume nicht eingehängt ist
    await sql`insert into documents (sha256, filename, mime_type, size)
      select encode(sha256(i::text::bytea), 'hex'), 'beleg-' || i || '.pdf', 'application/pdf', 1 from generate_series(1, 120) i`;
    const result = await files.runFileCheck();
    expect(result.files).toBe(120);
    expect(result.problemCount).toBe(120);
    expect(result.problems).toHaveLength(files.MAX_FILE_PROBLEMS);
    expect(result.problems.every((p) => p.befund === "fehlt")).toBe(true);
  });

  it("speichert das Ergebnis; „Kette prüfen“ zeigt den letzten Lauf mit Zeitpunkt, ohne die Dateien erneut zu lesen", async () => {
    expect((await integrity.checkIntegrity()).files).toBeNull();
    const fehlt = await beleg("strom.pdf");
    await rm(pfad(fehlt.sha256));
    const lauf = await files.runFileCheck(new Date("2026-11-14T03:15:00Z"));

    // Danach wieder da: Der Bericht zeigt trotzdem den gespeicherten Lauf
    await storage.storeFile(new TextEncoder().encode("%PDF-1.4\n% strom.pdf\n%%EOF\n"));
    const report = await integrity.checkIntegrity();
    expect(report.files).toEqual({ at: lauf.at, files: 1, problemCount: 1, problems: [expect.objectContaining({ zeile: fehlt.id, befund: "fehlt" })] });
    expect(report.files!.at.toISOString()).toBe("2026-11-14T03:15:00.000Z");
  });

  it("läuft im Scheduler höchstens einmal am Tag", async () => {
    await beleg("versicherung.pdf");
    const start = new Date("2026-11-14T03:00:00Z");
    expect(await files.runDueFileCheck(start)).toMatchObject({ files: 1 });
    expect(await files.runDueFileCheck(new Date(start.getTime() + 23 * 60 * 60 * 1000))).toBeNull();
    expect(await files.runDueFileCheck(new Date(start.getTime() + DAY + 60_000))).toMatchObject({ files: 1 });
  });

  it("lässt sich von einem Lauf mit Zeitpunkt in der Zukunft nicht abschalten", async () => {
    // Eine Uhr, die einmal vorging, oder eine eingeschleuste Zeile: file_checks hat kein Audit-Log, der nächste Lauf muss sie ablösen
    const now = new Date("2026-11-14T03:00:00Z");
    await sql`insert into file_checks (at, files, problem_count, problems) values ('2099-01-01T00:00:00Z', 0, 0, '[]'::jsonb)`;
    const fehlt = await beleg("kfz-versicherung.pdf");
    await rm(pfad(fehlt.sha256));
    expect(await files.runDueFileCheck(now)).toMatchObject({ files: 1, problemCount: 1 });
    expect((await files.lastFileCheck(now))?.problemCount).toBe(1);
  });

  it("führt gleichzeitige Läufe zusammen", async () => {
    await beleg("porto.pdf");
    const [a, b] = await Promise.all([files.runFileCheck(), files.runFileCheck()]);
    expect(a).toBe(b);
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from file_checks`;
    expect(row!.n).toBe(1);
  });

  it("nennt fehlende Dateien in der wöchentlichen Mail", async () => {
    await mail.saveMailSettings("test", {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      username: "max",
      password: "geheim",
      fromAddress: "haben@example.com",
      reminderTo: "max@example.com",
      remindersEnabled: false,
      reminderDays: [],
    });
    const fehlt = await beleg("bahncard.pdf");
    await rm(pfad(fehlt.sha256));
    await files.runFileCheck();
    const now = new Date(Date.now() + 2 * DAY);
    now.setUTCHours(9, 0, 0, 0);
    expect(await mail.runDuePruefwertMail(now)).toMatchObject({ problems: 0, fileProblems: 1 });
    expect(sent.at(-1)!.subject).toMatch(/^Haben: Änderungsprotokoll mit Befunden/);
    expect(sent.at(-1)!.text).toContain("1 Datei fehlt oder ist verändert (Beleg bahncard.pdf: fehlt)");
  });

  it("prüft die Dateien jeder Tabelle mit Dateiverweis, nicht nur die der Belege", async () => {
    await auftragsPdf(randomBytes(32).toString("hex"), "AB-1001.pdf");
    const result = await files.runFileCheck();
    expect(result.problems).toEqual([
      expect.objectContaining({ tabelle: "legacy_order_files", art: "Auftrags-PDF aus dem Umzug", datei: "AB-1001.pdf", befund: "fehlt" }),
    ]);
  });
});
