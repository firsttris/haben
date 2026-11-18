import type { VividAccount, VividClient, VividTransaction } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const ACTOR = "test-user";
const HEUTE = "2026-11-18";
const IBAN_HAUPT = "DE89370400440532013000";
const IBAN_RUECKLAGE = "DE02120300000000202051";
const SCHLUESSEL = "vivid_sk_v1_testschluessel";
/** Abrufzeitpunkt am Morgen des Tages in Deutschland */
const zeit = (tag: string) => new Date(`${tag}T06:00:00Z`);

const konto = (id: string, iban: string | null, name: string, currency = "EUR"): VividAccount => ({
  id,
  name,
  currency,
  state: "active",
  account_details: iban ? [{ iban, bic: null, type: "local" }] : [],
});

const umsatz = (id: string, tag: string, amount: string, over: Partial<VividTransaction> = {}): VividTransaction => ({
  id,
  account_id: "konto-haupt",
  type: "card_payment",
  state: "completed",
  amount,
  currency: "EUR",
  show_at: `${tag}T10:00:00Z`,
  created_at: `${tag}T10:00:05Z`,
  merchant: { name: "Kaffee Beispiel", city: "Leipzig", country: "DE" },
  card: { last_4: "4242" },
  ...over,
});

/** Nachgestellte Vivid-API: Konten und Umsätze je Konto; `abgelehnt` wirft wie ein abgelaufener Schlüssel */
function fakeVivid() {
  const state = {
    accounts: [
      konto("konto-haupt", IBAN_HAUPT, "Hauptkonto"),
      konto("konto-usd", "DE75512108001245126199", "Dollar", "USD"),
      konto("konto-ohne", null, "Ohne IBAN"),
    ],
    transactions: {} as Record<string, VividTransaction[]>,
    abgelehnt: null as Error | null,
    keys: [] as string[],
  };
  const client = (apiKey: string): VividClient => {
    state.keys.push(apiKey);
    const pruefen = () => {
      if (state.abgelehnt) throw state.abgelehnt;
    };
    return {
      async ping() {
        pruefen();
      },
      async accounts() {
        pruefen();
        return state.accounts;
      },
      async transactions(accountId) {
        pruefen();
        return state.transactions[accountId] ?? [];
      },
    };
  };
  return { state, client };
}

describe.skipIf(!testDatabaseUrl)("Kontoabruf über Vivid (Postgres)", () => {
  let vivid: typeof import("./vivid.ts");
  let abruf: typeof import("./vivid-abruf.ts");
  let bank: typeof import("./bank.ts");
  let db: typeof import("../../db/index.ts");
  let VividApiError: typeof import("@haben/import").VividApiError;
  let sql: postgres.Sql;
  const api = fakeVivid();

  const umsaetze = async (iban: string) =>
    sql`select t.booking_date::text as tag, t.amount::int as betrag, t.purpose, t.counterparty_name as name, i.format
        from bank_transactions t join bank_accounts a on a.id = t.bank_account_id join bank_imports i on i.id = t.import_id
        where a.iban = ${iban} order by t.booking_date, t.amount`;
  const verbindungen = () => sql`select * from vivid_connections order by created_at`;

  beforeAll(async () => {
    sql = await setupTestDb();
    vivid = await import("./vivid.ts");
    abruf = await import("./vivid-abruf.ts");
    bank = await import("./bank.ts");
    db = await import("../../db/index.ts");
    ({ VividApiError } = await import("@haben/import"));
    abruf.setVividClientFactory((o) => api.client(o.apiKey));

    // Das Hauptkonto kam bis zum 30.09. per CSV
    await db.db.transaction((t) =>
      bank.storeStatement(
        t,
        {
          format: "dkb-csv",
          accountIban: IBAN_HAUPT,
          accountName: "Vivid aus CSV",
          currency: "EUR",
          transactions: [{ bookingDate: "2026-09-30", amount: 5000, currency: "EUR", counterpartyName: "Muster GmbH", purpose: "Rechnung RE-1", index: 0 }],
          warnings: [],
        },
        { filename: "vivid.csv", sha256: "csv" },
        null,
      ),
    );
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(() => {
    api.state.abgelehnt = null;
  });

  it("verbindet, ordnet nur Konten in Euro mit IBAN zu und holt ab dem Tag nach der Datei die abgeschlossenen Umsätze", async () => {
    api.state.transactions["konto-haupt"] = [
      umsatz("u-vorgemerkt", "2026-11-16", "-8.00", { state: "pending" }),
      umsatz("u-ok", "2026-11-10", "-12.50"),
      umsatz("u-abgelehnt", "2026-11-09", "0.00", { state: "declined" }),
      umsatz("u-ueberweisung", "2026-10-15", "300.00", { type: "transfer", merchant: null, card: null }),
      // Liegt in der CSV-Zeit: kommt nicht noch einmal
      umsatz("u-alt", "2026-09-30", "50.00", { type: "transfer", merchant: null, card: null }),
    ];
    const ergebnis = await vivid.vividVerbinden(ACTOR, { apiKey: ` ${SCHLUESSEL} ` }, zeit(HEUTE));
    expect(ergebnis).toEqual({
      ok: true,
      meldung: "Vivid verbunden: 2 neue Umsätze.",
      hinweise: ["1 Konten ohne IBAN ruft Haben nicht ab.", "1 Konten in Fremdwährung (USD) werden nicht abgerufen, Haben bucht nur in Euro."],
      neu: 2,
    });
    expect(await umsaetze(IBAN_HAUPT)).toEqual([
      { tag: "2026-09-30", betrag: 5000, purpose: "Rechnung RE-1", name: "Muster GmbH", format: "dkb-csv" },
      { tag: "2026-10-15", betrag: 30000, purpose: "Überweisung", name: "", format: "vivid" },
      { tag: "2026-11-10", betrag: -1250, purpose: "Kartenzahlung, Karte …4242, Leipzig, DE", name: "Kaffee Beispiel", format: "vivid" },
    ]);
    const [v] = await verbindungen();
    expect(v).toMatchObject({ status: "aktiv", last_error: null });
    expect(v!.accounts).toEqual([{ uid: "konto-haupt", iban: IBAN_HAUPT, name: "Vivid aus CSV", bankAccountId: expect.any(String), syncedTo: HEUTE }]);
    const [quelle] = await sql`select provider, external_account_id, account_kind from import_sources`;
    expect(quelle).toEqual({ provider: "vivid", external_account_id: "konto-haupt", account_kind: "bank" });
    const [protokoll] = await sql`select warnings from bank_imports where format = 'vivid'`;
    expect(protokoll!.warnings).toContain("1 vorgemerkte Umsätze folgen, sobald Vivid sie bucht.");
  });

  it("speichert den Schlüssel nur verschlüsselt und nie im Änderungsprotokoll", async () => {
    const [v] = await verbindungen();
    expect(Buffer.from(v!.ciphertext).toString("utf8")).not.toContain(SCHLUESSEL);
    const protokoll =
      await sql`select coalesce(old_value::text, '') || coalesce(new_value::text, '') as wert from audit_log where table_name = 'vivid_connections'`;
    expect(protokoll.length).toBeGreaterThan(0);
    for (const p of protokoll) {
      expect(p.wert).not.toContain(SCHLUESSEL);
      expect(p.wert).not.toContain("ciphertext");
    }
    expect(api.state.keys.at(-1)).toBe(SCHLUESSEL);
  });

  it("übernimmt eine gebuchte Vormerkung mit ihrem Tag und legt beim nächsten Abruf nichts doppelt an", async () => {
    const [v] = await verbindungen();
    api.state.transactions["konto-haupt"] = api.state.transactions["konto-haupt"]!.map((t) =>
      t.id === "u-vorgemerkt" ? { ...t, state: "completed", amount: "-8.40" } : t,
    );
    // Gebucht erst Tage später: Der Tag bleibt der der Kartenzahlung, der Abruf findet sie trotzdem
    expect(await abruf.vividAbrufen(ACTOR, v!.id, zeit("2026-11-25"))).toMatchObject({ ok: true, neu: 1, meldung: "Vivid: 1 neuer Umsatz." });
    expect(await abruf.vividAbrufen(ACTOR, v!.id, zeit("2026-11-25"))).toMatchObject({ ok: true, neu: 0 });
    const tage = (await umsaetze(IBAN_HAUPT)).filter((u) => u.format === "vivid").map((u) => [u.tag, u.betrag]);
    expect(tage).toEqual([
      ["2026-10-15", 30000],
      ["2026-11-10", -1250],
      ["2026-11-16", -840],
    ]);
  });

  it("hält bei einem geänderten Betrag nur das Konto an und speichert vom Abruf nichts", async () => {
    const [v] = await verbindungen();
    const vorher = await umsaetze(IBAN_HAUPT);
    api.state.transactions["konto-haupt"] = [...api.state.transactions["konto-haupt"]!.filter((t) => t.id !== "u-ok"), umsatz("u-ok", "2026-11-10", "-13.00")];
    const ergebnis = await abruf.vividAbrufen(ACTOR, v!.id, zeit("2026-11-26"));
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.meldung).toMatch(/^Vivid aus CSV: Konflikt mit schon übernommenen Umsätzen/);
    expect(await umsaetze(IBAN_HAUPT)).toEqual(vorher);
    const [nachher] = await verbindungen();
    expect(nachher).toMatchObject({ status: "aktiv", last_error: ergebnis.meldung });
    api.state.transactions["konto-haupt"] = api.state.transactions["konto-haupt"]!.map((t) => (t.id === "u-ok" ? { ...t, amount: "-12.50" } : t));
  });

  it("setzt die Verbindung bei abgelaufenem Schlüssel auf Fehler; der Hintergrund versucht es dann nicht wieder", async () => {
    const [v] = await verbindungen();
    api.state.abgelehnt = new VividApiError(
      "Der API-Schlüssel ist abgelaufen. Bitte in Vivid einen neuen anlegen.",
      401,
      "key_expired",
      "/api/v1/accounts/current/list",
    );
    expect(await abruf.vividAbrufen(ACTOR, v!.id, zeit("2026-11-27"))).toMatchObject({
      ok: false,
      meldung: "Abruf fehlgeschlagen: Der API-Schlüssel ist abgelaufen. Bitte in Vivid einen neuen anlegen.",
    });
    expect((await verbindungen())[0]).toMatchObject({ status: "fehler" });
    api.state.abgelehnt = null;
    expect(await abruf.runDueVividSyncs(new Date(Date.now() + 2 * 86_400_000))).toEqual({ synced: 0, added: 0, errors: [] });
  });

  it("lässt den Status bei einem Ausfall von Vivid, der nächste Lauf versucht es wieder", async () => {
    await sql`update vivid_connections set status = 'aktiv', last_sync_at = null`;
    api.state.abgelehnt = new VividApiError("HTTP 503 (internal_error)", 503, "internal_error", "/api/v1/accounts/current/list");
    const lauf = await abruf.runDueVividSyncs(new Date());
    expect(lauf).toEqual({ synced: 1, added: 0, errors: ["Vivid: Abruf fehlgeschlagen: HTTP 503 (internal_error)"] });
    const [v] = await verbindungen();
    expect(v).toMatchObject({ status: "aktiv" });
    expect(v!.last_sync_at).not.toBeNull();
    // Innerhalb von 20 Stunden kein zweiter Versuch
    expect(await abruf.runDueVividSyncs(new Date())).toEqual({ synced: 0, added: 0, errors: [] });
  });

  it("löst mit einem neuen Schlüssel die alte Verbindung ab und behält den Abrufstand", async () => {
    const [alt] = await verbindungen();
    api.state.accounts = [...api.state.accounts, konto("konto-ruecklage", IBAN_RUECKLAGE, "Rücklage")];
    api.state.transactions["konto-ruecklage"] = [
      umsatz("r-1", "2026-11-02", "1000.00", { account_id: "konto-ruecklage", type: "transfer", merchant: null, card: null }),
    ];
    const ergebnis = await vivid.vividVerbinden(ACTOR, { apiKey: "vivid_sk_v1_neu" }, zeit("2026-11-28"));
    expect(ergebnis.hinweise).toContain(
      "Neu angelegt: Vivid Rücklage …2051. Name und Zweck (z. B. Steuerkonto) legst du unter Bank mit „Name und Zweck“ fest.",
    );
    const alle = await verbindungen();
    expect(alle.map((v) => v.id)).not.toContain(alt!.id);
    expect(alle).toHaveLength(1);
    expect(alle[0]!.accounts.find((a: { uid: string }) => a.uid === "konto-haupt")).toMatchObject({ syncedTo: "2026-11-28" });
    expect(await umsaetze(IBAN_RUECKLAGE)).toEqual([{ tag: "2026-11-02", betrag: 100000, purpose: "Überweisung", name: "", format: "vivid" }]);
    // Ohne „Umsätze abrufen ab“ ab Jahresbeginn gewünscht, Vivid gibt aber nur 90 Tage: Hinweis auf den Dateiimport
    expect(ergebnis.hinweise).toContain(
      "Vivid Rücklage …2051: Vivid gibt nur die letzten 90 Tage heraus; Umsätze vom 2026-01-01 bis vor dem 2026-08-31 per Datei importieren.",
    );
  });

  it("lehnt einen Schlüssel ab, den Vivid nicht annimmt, ohne etwas zu speichern", async () => {
    const vorher = await verbindungen();
    api.state.abgelehnt = new VividApiError("Der API-Schlüssel ist ungültig.", 401, "invalid_key", "/api/v1/accounts/current/list");
    await expect(vivid.vividVerbinden(ACTOR, { apiKey: "vivid_sk_v1_falsch" }, zeit(HEUTE))).rejects.toThrow(
      "Vivid hat den Schlüssel nicht angenommen: Der API-Schlüssel ist ungültig.",
    );
    expect(await verbindungen()).toEqual(vorher);
    await expect(vivid.vividVerbinden(ACTOR, { apiKey: "Bearer vivid_sk_v1_x" }, zeit(HEUTE))).rejects.toThrow("ohne „Bearer“");
  });

  it("listet die Verbindung ohne Schlüssel und trennt sie, die Umsätze bleiben", async () => {
    const [eintrag] = await vivid.listVividConnections();
    expect(eintrag).not.toHaveProperty("ciphertext");
    expect(eintrag!.accounts.map((a) => a.iban)).toEqual([IBAN_HAUPT, IBAN_RUECKLAGE]);
    await vivid.removeVividConnection(ACTOR, eintrag!.id);
    expect(await verbindungen()).toEqual([]);
    expect((await umsaetze(IBAN_HAUPT)).length).toBe(4);
  });
});

describe("vividStart", () => {
  it("beginnt nach der Datei, nie vor den 90 Tagen und nie nach heute", async () => {
    const { vividStart } = await import("./vivid-abruf.ts");
    expect(vividStart({ syncedTo: null }, "2026-09-30", HEUTE)).toEqual({ from: "2026-10-01", gekappt: null });
    expect(vividStart({ syncedTo: null }, null, HEUTE)).toEqual({ from: "2026-08-21", gekappt: "2026-01-01" });
    expect(vividStart({ syncedTo: "2026-11-01" }, null, HEUTE)).toEqual({ from: "2026-08-21", gekappt: null });
    expect(vividStart({ syncedTo: null, fetchFrom: "2026-11-01" }, "2026-09-30", HEUTE)).toEqual({ from: "2026-11-01", gekappt: null });
    expect(vividStart({ syncedTo: "2026-11-17", fetchFrom: "2026-11-01" }, null, HEUTE)).toEqual({ from: "2026-11-01", gekappt: null });
    expect(vividStart({ syncedTo: null }, "2026-11-20", HEUTE)).toEqual({ from: HEUTE, gekappt: null });
  });
});
