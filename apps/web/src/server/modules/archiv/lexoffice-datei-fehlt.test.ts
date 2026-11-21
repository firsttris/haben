import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1504: Ein Beleg, dessen Datei in der Sicherung fehlt, wurde bis 0.12.0 gar nicht angelegt. `importVoucher` lud
 * erst alle Dateien und schrieb den Beleg danach; ein Fehler beim Laden brach den ganzen Beleg ab. Jetzt steht der
 * Beleg, die fehlende Datei hängt als Stand an ihm, und der Abgleich nennt ihn als offenen Punkt. Entwürfe und
 * Vorgänge ohne Belegart tauchen nicht mehr ohne Zahl auf.
 */

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../../../../../packages/import/test-fixtures/lexoffice/${name}`, import.meta.url), "utf8"));

const VOUCHER = fixture("voucher-gross.json");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
/** Steuert, ob der Abruf die Anhangsdatei herausgibt; der zweite Lauf holt sie damit nach (#1504) */
let dateiKlappt = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function page(content: unknown[]) {
  return { content, first: true, last: true, totalPages: 1, totalElements: content.length, number: 0, size: 250, numberOfElements: content.length };
}

const listItem = (id: string, voucherStatus: string, voucherNumber: string) => ({
  id,
  voucherType: "purchaseinvoice",
  voucherStatus,
  voucherNumber,
  voucherDate: "2023-02-21T00:00:00.000+01:00",
  createdDate: "2023-02-21T14:43:28.000+01:00",
  updatedDate: "2023-02-21T14:45:01.000+01:00",
  contactName: "Berliner Kindl GmbH",
  totalAmount: 100,
  openAmount: 0,
  currency: "EUR",
  archived: false,
});

/** Nachgebaute Lexware-API: ein Ausgabebeleg, dessen Datei nicht kommt, und ein Entwurf */
function fakeApi() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    if (new Headers(init?.headers).get("authorization") !== "Bearer schluessel-1234567890-abcdefghij") return json({ message: "Unauthorized" }, 401);
    if (path === "/profile") return json(fixture("profile.json"));
    if (path === "/posting-categories") return json([]);
    if (path === "/contacts") return json(page([]));
    if (path === "/voucherlist") {
      if (url.searchParams.get("archived") === "true") return json(page([]));
      return json(page([listItem(String(VOUCHER.id), "paid", "2023-4711"), listItem("00000000-0000-4000-8000-000000000001", "draft", "")]));
    }
    if (path === `/vouchers/${VOUCHER.id}`) return json(VOUCHER);
    // Genau der Fall aus #1504: Der Beleg führt eine Datei, der Abruf liefert sie nicht
    if (path.startsWith("/files/")) {
      if (!dateiKlappt) return json({ message: "Datei nicht in der Sicherung" }, 500);
      return new Response(JPEG, { headers: { "content-type": "image/jpeg", "content-disposition": "attachment; filename=Quittung.jpg" } });
    }
    if (path.startsWith("/payments/")) return json({ message: "not found" }, 404);
    return json({ message: `unbekannt ${path}` }, 404);
  }) as typeof fetch;
}

describe.skipIf(!testDatabaseUrl)("Lexoffice: fehlende Belegdatei (#1504)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  const actor = "test-user";
  let sql: postgres.Sql;
  let voucherId = "";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    const importPkg = await import("@haben/import");
    lexoffice.setLexofficeClientFactory(
      (o) => new importPkg.LexofficeClient({ ...o, fetch: fakeApi(), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await lexoffice.saveApiKey(actor, "schluessel-1234567890-abcdefghij");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt den Beleg trotzdem an, vermerkt die fehlende Datei und zählt den Entwurf", async () => {
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();

    // Der Lauf bleibt grün: eine fehlende Datei ist kein fehlgeschlagener Beleg
    expect(run!.progress).toMatchObject({ listed: 1, imported: 1, files: 0, failed: [] });
    // Der Entwurf stand in der Liste, ist aber kein Beleg; er wird gezählt statt still übergangen
    expect(run!.progress.ignored).toEqual({ drafts: 1 });

    const [voucher] = await sql`select id, number, gross from lexoffice_vouchers where number = '2023-4711'`;
    expect(voucher).toMatchObject({ number: "2023-4711", gross: 12_970 });
    voucherId = String(voucher!.id);

    // Der Stand hängt am Beleg, mit Grund und Kennung der Datei
    const [stand] = await sql`select state, role, source_file_id, message from legacy_file_states where voucher_id = ${voucher!.id}`;
    expect(stand).toMatchObject({ state: "abruf_fehlgeschlagen", role: "anhang" });
    expect(String(stand!.message)).toContain("Datei fehlt in der Sicherung");
    expect(stand!.source_file_id).toBeTruthy();

    // Ansicht: offener Punkt, kein Knopf zum Bestätigen — das Merkmal ohne Beleg trägt der Beleg nicht
    const detail = await lexoffice.legacyVoucherDetail(String(voucher!.id));
    expect(detail!.fileState).toMatchObject({ status: "abruf_fehlgeschlagen", canConfirmWithoutFile: false });
    const { confirmWithoutFile } = await import("./dateistand.ts");
    await expect(confirmWithoutFile(actor, String(voucher!.id), "probe")).rejects.toThrow();

    // Abgleich: „Jeder Beleg hat eine Datei“ bleibt offen und beziffert den fehlenden Beleg
    const jahr = (await lexoffice.reconciliation()).years.find((y) => y.year === 2023)!;
    const check = jahr.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")!;
    expect(check).toMatchObject({ ok: false, detail: "1 Abruf fehlgeschlagen" });
  });

  it("holt die fehlende Datei aus einem späteren Lauf nach und löst den offenen Punkt", async () => {
    // Eine neue Sicherung enthält die Datei: der Beleg ist schon da, die Datei kommt jetzt
    dateiKlappt = true;
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ nachgeladen: 1, failed: [] });

    const [datei] =
      await sql`select role, mime_type from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id where v.number = '2023-4711'`;
    expect(datei).toMatchObject({ role: "anhang", mime_type: "image/jpeg" });

    // Der Stand am Beleg ist aufgelöst, der Abgleich wieder grün
    const [stand] = await sql`select state from legacy_file_states where voucher_id = ${voucherId} order by created_at desc, id desc limit 1`;
    expect(stand!.state).toBe("nachgeladen");
    const jahr = (await lexoffice.reconciliation()).years.find((y) => y.year === 2023)!;
    expect(jahr.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")).toMatchObject({ ok: true, detail: "alle mit Datei" });
  });

  it("zählt nur noch die Entwürfe: Arten, die kein Beleg sind, zeigt der Abruf nicht mehr", async () => {
    // Der Lauf hat einen Entwurf gesehen, aber keinen Vorgang ohne Belegart
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress.ignored).toEqual({ drafts: 1 });
  });
});

/*
 * #1624: Zwei Löcher in `offeneDateien` und `nachladenDateien`. Eine Rechnung trägt ihr PDF ohne eigene Kennung in der
 * Quelle; solche Stände fielen aus der Liste, das PDF kam nie nach, und der Beleg ließ sich weder bestätigen noch
 * übernehmen. Und je Beleg zählte nur die jüngste Zeile: fehlten zwei Anhänge, kam einer nach, und der Beleg stand
 * danach als vollständig da. Beide Fälle laufen hier über einen ersten und einen zweiten Lauf.
 */

const RECHNUNG = fixture("invoice-two-rates.json");
const ANHANG_A = "5a1d2b6e-3c4f-4e5a-9b8c-7d6e5f4a3b2c";
const ANHANG_B = "6b2e3c7f-4d5a-4f6b-8c9d-8e7f6a5b4c3d";
/** Derselbe Ausgabebeleg wie oben, aber mit zwei Anhängen in der Quelle */
const BELEG_ZWEI_ANHAENGE = { ...VOUCHER, files: [ANHANG_A, ANHANG_B] };
const PDF = new TextEncoder().encode("%PDF-1.4\n% Rechnung RE1019\n%%EOF\n");

/** Was der Abruf herausgibt; der erste Lauf liefert nichts, die späteren holen es nach (#1624) */
const angekommen = new Set<string>();
let pdfKlappt = false;

/** Zwei verschiedene Anhänge brauchen verschiedene Bytes: gleiche Bytes hängen nur einmal am Beleg */
function anhangBytes(fileId: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4 + fileId.length);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  bytes.set(new TextEncoder().encode(fileId), 4);
  return bytes;
}

const eintrag = (id: string, voucherType: string, voucherNumber: string) => ({ ...listItem(id, "paid", voucherNumber), voucherType });

/** Nachgebaute Lexware-API: eine Rechnung ohne PDF und ein Ausgabebeleg mit zwei Anhängen, die nicht kommen */
function fakeApiMitRechnung() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const accept = new Headers(init?.headers).get("accept") ?? "";
    if (new Headers(init?.headers).get("authorization") !== "Bearer schluessel-1234567890-abcdefghij") return json({ message: "Unauthorized" }, 401);
    if (path === "/profile") return json(fixture("profile.json"));
    if (path === "/posting-categories") return json([]);
    if (path === "/contacts") return json(page([]));
    if (path === "/voucherlist") {
      if (url.searchParams.get("archived") === "true") return json(page([]));
      return json(page([eintrag(String(RECHNUNG.id), "invoice", "RE1019"), eintrag(String(VOUCHER.id), "purchaseinvoice", "2023-4711")]));
    }
    if (path === `/invoices/${RECHNUNG.id}`) return json(RECHNUNG);
    if (path === `/vouchers/${VOUCHER.id}`) return json(BELEG_ZWEI_ANHAENGE);
    if (path === `/invoices/${RECHNUNG.id}/file`) {
      // Die Rechnung ist keine E-Rechnung: nach XML fragt der Client hier vergebens
      if (accept.includes("xml")) return new Response("", { status: 406 });
      if (!pdfKlappt) return json({ message: "Datei nicht in der Sicherung" }, 500);
      return new Response(PDF, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="RE1019.pdf"' } });
    }
    if (path.startsWith("/files/")) {
      const fileId = path.slice("/files/".length);
      if (!angekommen.has(fileId)) return json({ message: "Datei nicht in der Sicherung" }, 500);
      return new Response(anhangBytes(fileId), { headers: { "content-type": "image/jpeg", "content-disposition": `attachment; filename="${fileId}.jpg"` } });
    }
    if (path.startsWith("/payments/")) return json({ message: "not found" }, 404);
    return json({ message: `unbekannt ${path}` }, 404);
  }) as typeof fetch;
}

describe.skipIf(!testDatabaseUrl)("Lexoffice: was ein späterer Lauf nachholt (#1624)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  const actor = "test-user";
  let sql: postgres.Sql;
  let belegId = "";
  let rechnungId = "";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    const importPkg = await import("@haben/import");
    lexoffice.setLexofficeClientFactory(
      (o) => new importPkg.LexofficeClient({ ...o, fetch: fakeApiMitRechnung(), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await lexoffice.saveApiKey(actor, "schluessel-1234567890-abcdefghij");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("lässt Rechnungs-PDF und beide Anhänge offen, ohne den Lauf zu gefährden", async () => {
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ listed: 2, imported: 2, files: 0, failed: [] });

    const [beleg] = await sql`select id from lexoffice_vouchers where number = '2023-4711'`;
    belegId = String(beleg!.id);
    // Zwei fehlende Anhänge, jeder mit seiner Kennung: nur so kann ein späterer Lauf beide holen
    const staende = await sql`select state, role, source_file_id from legacy_file_states where voucher_id = ${beleg!.id} order by source_file_id`;
    expect(staende.map((s) => [s.state, s.role, s.source_file_id])).toEqual([
      ["abruf_fehlgeschlagen", "anhang", ANHANG_A],
      ["abruf_fehlgeschlagen", "anhang", ANHANG_B],
    ]);
    // Der Beleg gilt vor dem zweiten Lauf nicht als vollständig
    const belegDetail = await lexoffice.legacyVoucherDetail(belegId);
    expect(belegDetail!.fileState.status).toBe("abruf_fehlgeschlagen");

    // Die Rechnung führt ihr PDF ohne Kennung in der Quelle; der Stand nennt trotzdem die Rolle
    const [rechnung] = await sql`select id from lexoffice_vouchers where number = 'RE1019'`;
    rechnungId = String(rechnung!.id);
    const [pdfStand] = await sql`select state, role, source_file_id from legacy_file_states where voucher_id = ${rechnung!.id}`;
    expect(pdfStand).toMatchObject({ state: "abruf_fehlgeschlagen", role: "pdf", source_file_id: null });
    const rechnungDetail = await lexoffice.legacyVoucherDetail(rechnungId);
    expect(rechnungDetail!.fileState).toMatchObject({ status: "abruf_fehlgeschlagen", canConfirmWithoutFile: false });
  });

  it("holt aus einem Lauf, der nur einen der beiden Anhänge enthält, genau diesen nach und lässt den Beleg offen", async () => {
    // Eine der beiden Dateien fehlt weiter; der Beleg darf danach nicht als vollständig gelten (#1624)
    angekommen.add(ANHANG_A);
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ nachgeladen: 1, failed: [] });

    const anhaenge = await sql`select lexoffice_file_id from lexoffice_voucher_files where voucher_id = ${belegId}`;
    expect(anhaenge.map((f) => f.lexoffice_file_id)).toEqual([ANHANG_A]);
    const belegDetail = await lexoffice.legacyVoucherDetail(belegId);
    expect(belegDetail!.fileState.status).toBe("abruf_fehlgeschlagen");
    // Der fehlende Anhang und das PDF der Rechnung bleiben offen; der angekommene zählt nicht mehr
    const jahr = (await lexoffice.reconciliation()).years.find((y) => y.year === 2023)!;
    expect(jahr.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")).toMatchObject({ ok: false, detail: "2 Abruf fehlgeschlagen" });
  });

  it("holt beide Anhänge und das Rechnungs-PDF nach und schließt die offenen Punkte", async () => {
    angekommen.add(ANHANG_B);
    pdfKlappt = true;
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ nachgeladen: 2, failed: [] });

    // Beide Anhänge hängen am Beleg, jeder mit eigener Kennung und eigenem Stand
    const anhaenge = await sql`select role, mime_type, lexoffice_file_id from lexoffice_voucher_files where voucher_id = ${belegId} order by lexoffice_file_id`;
    expect(anhaenge.map((f) => [f.role, f.mime_type, f.lexoffice_file_id])).toEqual([
      ["anhang", "image/jpeg", ANHANG_A],
      ["anhang", "image/jpeg", ANHANG_B],
    ]);
    const nachgeladen =
      await sql`select role, source_file_id from legacy_file_states where voucher_id = ${belegId} and state = 'nachgeladen' order by source_file_id`;
    expect(nachgeladen.map((s) => [s.role, s.source_file_id])).toEqual([
      ["anhang", ANHANG_A],
      ["anhang", ANHANG_B],
    ]);
    const belegDetail = await lexoffice.legacyVoucherDetail(belegId);
    expect(belegDetail!.fileState.status).toBe("vollstaendig");
    // „(nachgeladen)“ in der Belegansicht: der Stand trägt Rolle und Kennung (#1624)
    expect(belegDetail!.files.map((f) => [f.role, f.reloadedAt !== null])).toEqual([
      ["anhang", true],
      ["anhang", true],
    ]);

    // Das PDF der Rechnung kommt ohne Kennung, aber mit Rolle und Zeitpunkt
    const pdf = await sql`select role, mime_type from lexoffice_voucher_files where voucher_id = ${rechnungId}`;
    expect(pdf).toEqual([{ role: "pdf", mime_type: "application/pdf" }]);
    const rechnungDetail = await lexoffice.legacyVoucherDetail(rechnungId);
    expect(rechnungDetail!.files.map((f) => [f.role, f.reloadedAt !== null])).toEqual([["pdf", true]]);
    expect(rechnungDetail!.fileState.status).toBe("vollstaendig");

    // Abgleich: nichts bleibt offen
    const jahr = (await lexoffice.reconciliation()).years.find((y) => y.year === 2023)!;
    expect(jahr.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")).toMatchObject({ ok: true, detail: "alle mit Datei" });
  });
});
