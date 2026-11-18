import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import vorlagen from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/beleg-aus-vorlage.json";
import antworten from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/dateistand.json";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { json, sevdeskFakeFetch } from "./test-sevdesk-api.ts";

/*
 * #472: Eine Datei, die in sevDesk erst nach dem ersten Abruf an einen Beleg kommt, holt der nächste Abruf nach. Die
 * aktuelle Belegliste nennt sie in `document`, die Archivkopie nicht. Die Datei kommt als zusätzliche eigene Datei
 * (Rolle „anhang“) an den archivierten Beleg, mit eigener Zeile im Dateistand; die Archivkopie bleibt unverändert.
 * Auch nach „ohne Datei bestätigt“ und neben der Datei einer Vorlage, die bleibt. Ein weiterer Abruf hängt nichts doppelt an.
 * Läuft für SKR03 mit Ist und SKR04 mit Soll.
 */

type Raw = Record<string, unknown>;
const fx = antworten as unknown as { belegOhneDatei: { voucher: Raw } };
const { vorlage, beleg } = vorlagen as unknown as { vorlage: Raw; beleg: Raw };
const TOKEN = "0123456789abcdef0123456789abcdef";
const VORLAGE_PDF = "%PDF-1.4\n% Vorlage\n";
const HOCHGELADEN = "2024-03-15T12:00:00+01:00";
const download = (content: string, filename: string) =>
  json({ objects: { base64Encoded: true, content: Buffer.from(content).toString("base64"), filename, mimetype: "application/pdf" } });
const doc = (id: string) => ({ id, objectName: "Document" });

const ohneDatei = (id: string, day: number) => ({
  ...fx.belegOhneDatei.voucher,
  id,
  description: `B-2024-${id}`,
  voucherDate: `2024-04-${String(day).padStart(2, "0")}T00:00:00+02:00`,
});
const ausVorlage = (id: string, day: number) => ({
  ...beleg,
  id,
  description: `B-2024-${id}`,
  voucherDate: `2024-04-${String(day).padStart(2, "0")}T00:00:00+02:00`,
  create: "2024-04-15T12:00:00+02:00",
  origin: { id: "ID_1", objectName: "Voucher" },
});

describe.skipIf(!testDatabaseUrl).each([
  ["SKR03", "ist"],
  ["SKR04", "soll"],
] as const)("sevDesk: später hochgeladene Datei nachladen, %s und %s (Postgres)", (kontenrahmen, versteuerung) => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let archiv: typeof import("./lexoffice.ts");
  let dateistand: typeof import("./dateistand.ts");
  let exporter: typeof import("./export.ts");
  /** Was sevDesk gerade an den Belegen nennt; die Tests ändern es zwischen den Läufen */
  const documents = new Map<string, Raw | null>();
  /** Downloads, die gerade scheitern, mit Status */
  const broken = new Map<string, number>();
  const calls: string[] = [];
  /** Belege, die erst ein späterer Abruf listet */
  const extra: Raw[] = [];

  const idOf = async (lexofficeId: string) => String((await sql`select id from lexoffice_vouchers where lexoffice_id = ${lexofficeId}`)[0]!.id);
  const listed = () =>
    [ohneDatei("ID_401", 1), ausVorlage("ID_402", 2), ohneDatei("ID_403", 3), ohneDatei("ID_404", 4), ausVorlage("ID_405", 5), ...extra].map((v) =>
      documents.has(String(v.id)) ? { ...v, document: documents.get(String(v.id)), update: "2026-11-15T09:00:00+01:00" } : v,
    );
  const files = async () =>
    (await sql`select v.lexoffice_id as voucher, f.role, f.lexoffice_file_id as "fileId", f.filename
      from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id order by 1, f.created_at, f.role`) as unknown as Raw[];
  const latest = async () =>
    (await sql`select distinct on (v.lexoffice_id) v.lexoffice_id as voucher, s.state, s.role, s.source_file_id as "sourceFileId"
      from legacy_file_states s join lexoffice_vouchers v on v.id = s.voucher_id order by v.lexoffice_id, s.created_at desc, s.id desc`) as unknown as Raw[];
  const run = async () => {
    calls.length = 0;
    const id = await sevdesk.startSevdeskImport("test-user", { wait: true });
    const [row] = await sql`select error, progress from lexoffice_imports where id = ${id}`;
    expect(row!.error).toBeNull();
    return row!.progress as { sevdeskFiles: Record<string, number>; failed: unknown[]; files: number };
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    archiv = await import("./lexoffice.ts");
    dateistand = await import("./dateistand.ts");
    exporter = await import("./export.ts");
    const importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    sevdesk.setSevdeskClientFactory(
      (o) =>
        new importPkg.SevdeskClient({
          ...o,
          minIntervalMs: 0,
          maxRetries: 0,
          sleep: async () => {},
          fetch: sevdeskFakeFetch(({ path, method, list }) => {
            expect(method).toBe("GET");
            calls.push(path);
            const status = broken.get(path);
            if (status) return json({ error: { message: "Serverfehler" } }, status);
            switch (path) {
              case "/Voucher":
                return list([vorlage, ...listed()]);
              case "/Voucher/ID_1":
                return json({ objects: [vorlage] });
              case "/Document/ID_5":
                return json({ objects: [{ id: "ID_5", objectName: "Document", create: HOCHGELADEN, update: HOCHGELADEN }] });
              case "/Document/ID_5/download":
                return download(VORLAGE_PDF, "vertrag.pdf");
              case "/Document/ID_605/download":
                // dieselbe Datei wie an der Vorlage, jetzt am Beleg selbst
                return download(VORLAGE_PDF, "vertrag.pdf");
            }
            const own = /^\/Document\/(ID_60\d)\/download$/.exec(path);
            if (own) return download(`%PDF-1.4\n% ${own[1]}\n`, `${own[1]}.pdf`);
          }),
        }),
    );
    await sevdesk.saveSevdeskKey("test-user", TOKEN);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("übernimmt die Belege beim ersten Abruf ohne eigene Datei", async () => {
    const progress = await run();
    expect(progress.failed).toEqual([]);
    expect(await files()).toEqual([
      { voucher: "voucher/ID_402", role: "vorlage", fileId: "ID_5", filename: "vertrag.pdf" },
      { voucher: "voucher/ID_405", role: "vorlage", fileId: "ID_5", filename: "vertrag.pdf" },
    ]);
    await dateistand.confirmWithoutFile("test-user", await idOf("voucher/ID_403"), "kein Beleg da");
  });

  it("hängt beim nächsten Abruf die in sevDesk hochgeladenen Dateien an, neben der Datei der Vorlage und nach der Bestätigung", async () => {
    const before = await sql`select id, raw, net, gross from lexoffice_vouchers order by lexoffice_id`;
    documents.set("ID_401", doc("ID_601"));
    documents.set("ID_402", doc("ID_602"));
    documents.set("ID_403", doc("ID_603"));
    documents.set("ID_404", doc("ID_604"));
    documents.set("ID_405", doc("ID_605"));
    broken.set("/Document/ID_603/download", 500);
    broken.set("/Document/ID_604/download", 404);
    const progress = await run();
    expect(progress.failed).toEqual([]);
    expect(progress.sevdeskFiles).toEqual({ ohneDatei: 0, abrufFehlgeschlagen: 2, anhangFehlt: 0, nachgeladen: 3 });
    expect(await sql`select id, raw, net, gross from lexoffice_vouchers order by lexoffice_id`).toEqual(before);
    expect(await files()).toEqual([
      { voucher: "voucher/ID_401", role: "anhang", fileId: "ID_601", filename: "ID_601.pdf" },
      { voucher: "voucher/ID_402", role: "vorlage", fileId: "ID_5", filename: "vertrag.pdf" },
      { voucher: "voucher/ID_402", role: "anhang", fileId: "ID_602", filename: "ID_602.pdf" },
      // dieselben Bytes wie die Datei der Vorlage: keine zweite Datei
      { voucher: "voucher/ID_405", role: "vorlage", fileId: "ID_5", filename: "vertrag.pdf" },
    ]);
    expect(await latest()).toEqual([
      { voucher: "voucher/ID_401", state: "nachgeladen", role: "anhang", sourceFileId: "ID_601" },
      { voucher: "voucher/ID_402", state: "nachgeladen", role: "anhang", sourceFileId: "ID_602" },
      { voucher: "voucher/ID_403", state: "abruf_fehlgeschlagen", role: "anhang", sourceFileId: "ID_603" },
      { voucher: "voucher/ID_404", state: "abruf_fehlgeschlagen", role: "anhang", sourceFileId: "ID_604" },
      { voucher: "voucher/ID_405", state: "nachgeladen", role: "anhang", sourceFileId: "ID_605" },
    ]);
    const detail = (await archiv.legacyVoucherDetail(await idOf("voucher/ID_402")))!;
    expect(detail.fileState.status).toBe("vollstaendig");
    expect(detail.files.map((f) => [f.role, f.reloadedAt !== null])).toEqual([
      ["vorlage", false],
      ["anhang", true],
    ]);
  });

  it("versucht eine gescheiterte Datei erneut und stellt eine in sevDesk wieder entfernte zurück", async () => {
    broken.clear();
    documents.set("ID_404", null);
    const progress = await run();
    expect(progress.sevdeskFiles).toEqual({ ohneDatei: 1, abrufFehlgeschlagen: 0, anhangFehlt: 0, nachgeladen: 1 });
    expect(calls.filter((p) => p.endsWith("/download"))).toEqual(["/Document/ID_603/download"]);
    const states = await latest();
    expect(states.find((s) => s.voucher === "voucher/ID_403")).toEqual({
      voucher: "voucher/ID_403",
      state: "nachgeladen",
      role: "anhang",
      sourceFileId: "ID_603",
    });
    expect(states.find((s) => s.voucher === "voucher/ID_404")).toMatchObject({ state: "ohne_datei" });
    // Der Verlauf behält die Bestätigung und den Fehlschlag
    const history = await dateistand.fileStateHistory(await idOf("voucher/ID_403"));
    expect(history.map((h) => h.state)).toEqual(["ohne_datei", "bestaetigt_ohne_datei", "abruf_fehlgeschlagen", "nachgeladen"]);
  });

  it("hängt bei einem weiteren Abruf nichts doppelt an und schreibt keinen Stand doppelt", async () => {
    const [{ n }] = (await sql`select count(*)::int as n from legacy_file_states`) as unknown as [{ n: number }];
    const before = await files();
    await run();
    expect(calls.filter((p) => p.endsWith("/download"))).toEqual([]);
    expect(await files()).toEqual(before);
    expect((await sql`select count(*)::int as n from legacy_file_states`)[0]!.n).toBe(n);
  });

  it("führt nachgeladene Dateien und ihren Stand im Jahresexport", async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2024, new Date("2026-11-15T10:00:00Z"))) chunks.push(chunk);
    const zip = unzipSync(Buffer.concat(chunks));
    const belege = Object.keys(zip).filter((p) => p.startsWith("lexoffice/belege/"));
    // 401, 403 eigene Datei; 402 Vorlage und eigene; 405 Vorlage
    expect(belege).toHaveLength(5);
    const verlauf = new TextDecoder().decode(zip["lexoffice/dateistand.csv"]);
    expect(verlauf).toContain("ID_602");
    expect(verlauf).toContain("sevDesk nennt die Datei erst nach dem ersten Abruf; ein späterer Abruf hat sie angehängt.");
  });

  it("löst den Fehlschlag auf, wenn sevDesk die neue Datei wieder entfernt und die Datei der Vorlage bleibt", async () => {
    documents.set("ID_405", doc("ID_607"));
    broken.set("/Document/ID_607/download", 500);
    await run();
    expect((await latest()).find((s) => s.voucher === "voucher/ID_405")).toMatchObject({ state: "abruf_fehlgeschlagen", sourceFileId: "ID_607" });
    broken.clear();
    documents.delete("ID_405");
    const progress = await run();
    expect(progress.sevdeskFiles.abrufFehlgeschlagen).toBe(0);
    expect((await archiv.legacyVoucherDetail(await idOf("voucher/ID_405")))!.fileState.status).toBe("vollstaendig");
  });

  it("löst den Fehlschlag auf, wenn sevDesk wieder die schon archivierte Datei nennt", async () => {
    extra.push({ ...ohneDatei("ID_406", 6), document: doc("ID_609") });
    await run();
    expect((await files()).filter((f) => f.voucher === "voucher/ID_406")).toHaveLength(1);
    documents.set("ID_406", doc("ID_608"));
    broken.set("/Document/ID_608/download", 500);
    await run();
    expect((await latest()).find((s) => s.voucher === "voucher/ID_406")).toMatchObject({ state: "abruf_fehlgeschlagen", sourceFileId: "ID_608" });
    broken.clear();
    documents.set("ID_406", doc("ID_609"));
    const progress = await run();
    expect(progress.sevdeskFiles.abrufFehlgeschlagen).toBe(0);
    expect((await archiv.legacyVoucherDetail(await idOf("voucher/ID_406")))!.fileState.status).toBe("vollstaendig");
    expect((await files()).filter((f) => f.voucher === "voucher/ID_406")).toHaveLength(1);
  });
});
