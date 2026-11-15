import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EtsyClient, EtsyLedgerEntry } from "@haben/import";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abruf des Etsy-Zahlungsverlaufs gegen Postgres: Zugang speichern, Verlauf abrufen, ins Konto des
 * Zahlungsdienstleisters übernehmen und beim zweiten Lauf nichts doppelt anlegen.
 *
 * Der Etsy-Client ist nachgebaut (setEtsyClientFactory); die Beträge und Typen stammen aus dem echten Verlauf von
 * Juni 2023, die Kennungen sind erfunden.
 */

const HEUTE = new Date("2023-07-05T10:00:00Z");
const am = (iso: string) => Math.floor(new Date(`${iso}T10:00:00Z`).getTime() / 1000);

const BESTELLUNG_1 = "1000000001";
const BESTELLUNG_2 = "1000000002";

const verlauf: EtsyLedgerEntry[] = [
  {
    entry_id: 1,
    amount: 2200,
    currency: "EUR",
    ledger_type: "PAYMENT_GROSS",
    reference_type: "shop_payment",
    reference_id: "5000000001",
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 2,
    amount: -118,
    currency: "EUR",
    ledger_type: "PAYMENT_PROCESSING_FEE",
    reference_type: "processing_fee",
    reference_id: "5000000001",
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 3,
    amount: -19,
    currency: "EUR",
    ledger_type: "listing",
    reference_type: "listing",
    reference_id: "1470058658",
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 4,
    amount: -143,
    currency: "EUR",
    ledger_type: "transaction",
    reference_type: "transaction",
    reference_id: "3588992730",
    created_timestamp: am("2023-06-07"),
  },
  {
    entry_id: 5,
    amount: 2495,
    currency: "EUR",
    ledger_type: "PAYMENT_GROSS",
    reference_type: "shop_payment",
    reference_id: "5000000002",
    created_timestamp: am("2023-06-13"),
  },
  {
    entry_id: 6,
    amount: -374,
    currency: "EUR",
    ledger_type: "offsite_ads_fee",
    reference_type: "receipt",
    reference_id: BESTELLUNG_2,
    created_timestamp: am("2023-06-13"),
  },
  {
    entry_id: 7,
    amount: -145,
    currency: "EUR",
    ledger_type: "sales_tax",
    reference_type: "receipt",
    reference_id: BESTELLUNG_2,
    created_timestamp: am("2023-06-13"),
  },
  {
    entry_id: 8,
    amount: -3490,
    currency: "EUR",
    ledger_type: "DISBURSE2",
    reference_type: "disbursement",
    reference_id: "133244522577",
    created_timestamp: am("2023-06-20"),
  },
  // Zeile aus dem laufenden Monat: die Gebühr kommt erst mit dem nächsten Abruf
  {
    entry_id: 9,
    amount: -500,
    currency: "EUR",
    ledger_type: "prolist",
    reference_type: "prolist",
    reference_id: "1170673972595",
    created_timestamp: am("2023-07-03"),
  },
];

/** Was der nachgebaute Zugang beim nächsten Abruf liefert */
let imAbruf: EtsyLedgerEntry[] = verlauf;

/** Nachgebauter Etsy-Zugang: liefert den Verlauf und die Bestellnummern */
function fakeClient(): EtsyClient {
  return {
    async ledger() {
      return imAbruf;
    },
    async countriesFor() {
      return new Map([
        [BESTELLUNG_1, "DE"],
        [BESTELLUNG_2, "US"],
      ]);
    },
    async ordersFor() {
      return new Map([
        ["5000000001", BESTELLUNG_1],
        ["5000000002", BESTELLUNG_2],
      ]);
    },
    async shop() {
      return { shopId: "35160089", shopName: "NiruHobbyArt" };
    },
    tokens: () => ({ accessToken: "gut", refreshToken: "erneuern", expiresAt: 4_000_000_000 }),
  };
}

describe.skipIf(!testDatabaseUrl)("Etsy-Zahlungsverlauf (Postgres)", () => {
  let etsy: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    etsy = await import("./index.ts");
    etsy.setEtsyClientFactory(() => fakeClient());
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function kontoAnlegen() {
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Etsy Payments', 'zahlungsdienstleister', 'etsy', 3)`;
  }

  it("speichert den Zugang verschlüsselt und ohne Geheimnis in der Zusammenfassung", async () => {
    await etsy.saveEtsyConnection(actor, { keystring: "abc", sharedSecret: "geheim", fetchFrom: "2023-06", sammelzeilen: true });
    const stand = await etsy.etsySummary();
    expect(stand).toMatchObject({ configured: true, connected: false, keystring: "abc", fetchFrom: "2023-06", sammelzeilen: true, rhythmus: "taeglich" });
    expect(JSON.stringify(stand)).not.toContain("geheim");
    const [row] = await sql`select ciphertext::text as c from etsy_connections`;
    expect(row!.c).not.toContain("geheim");
    expect(await etsy.etsyConnected()).toBe(false);
  });

  it("speichert den Rhythmus des automatischen Abrufs und lehnt unbekannte Werte ab", async () => {
    await etsy.saveEtsyConnection(actor, { keystring: "abc", fetchFrom: "2023-06", sammelzeilen: true, rhythmus: "monatlich" });
    expect((await etsy.etsySummary()).rhythmus).toBe("monatlich");
    await expect(etsy.saveEtsyConnection(actor, { keystring: "abc", fetchFrom: "2023-06", rhythmus: "minuetlich" as "taeglich" })).rejects.toThrow();
    await etsy.saveEtsyConnection(actor, { keystring: "abc", fetchFrom: "2023-06", sammelzeilen: true, rhythmus: "taeglich" });
    expect((await etsy.etsySummary()).rhythmus).toBe("taeglich");
  });

  it("übernimmt den Verlauf ins Konto des Dienstleisters und bündelt die Gebühren", async () => {
    await kontoAnlegen();
    await etsy.storeEtsySecret(
      actor,
      { sharedSecret: "geheim", accessToken: "gut", refreshToken: "erneuern", expiresAt: 4_000_000_000 },
      { shopId: "35160089", shopName: "NiruHobbyArt" },
    );
    expect(await etsy.etsyConnected()).toBe(true);

    const result = await etsy.syncEtsy(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.accountName).toBe("Etsy Payments");
    expect(result.entries).toBe(9);
    // Zwei Verkäufe, eine Auszahlung und vier Sammelzeilen (Einstell-, Transaktions- und Zahlungsgebühren, Werbung);
    // die Sales Tax geht im Verkauf derselben Bestellung auf
    expect(result.added).toBe(7);
    expect(result.messages.join(" ")).toContain("noch laufenden Monat");
    expect(result.messages.join(" ")).toContain("Bestellungen nach Land: 1 Deutschland (19 %), 1 USA (nicht steuerbar, Kz 45)");

    const umsaetze = await sql`select purpose, amount, type from bank_transactions order by purpose`;
    expect(umsaetze.map((u) => u.purpose)).toEqual([
      "Auszahlung · Etsy 2023-06-20",
      "Gebühr · Einstellgebühren (Listing Fees) 2023-06",
      "Gebühr · Offsite Ads (Offsite Ads Fees) 2023-06",
      "Gebühr · Transaktionsgebühren (Transaction Fees) 2023-06",
      "Gebühr · Zahlungsabwicklung (Processing Fees) 2023-06",
      `Verkauf · Etsy Bestellung ${BESTELLUNG_1}`,
      `Verkauf · Etsy Bestellung ${BESTELLUNG_2} · Sales Tax 1,45 € von Etsy abgeführt`,
    ]);
    const summe = (name: string) => Number(umsaetze.find((u) => u.purpose === name)!.amount);
    expect(summe("Gebühr · Einstellgebühren (Listing Fees) 2023-06")).toBe(-19);
    expect(summe("Gebühr · Transaktionsgebühren (Transaction Fees) 2023-06")).toBe(-143);
    expect(summe("Gebühr · Zahlungsabwicklung (Processing Fees) 2023-06")).toBe(-118);
    // Offsite Ads aus Juni; die 5 € Etsy Ads aus Juli bleiben für den nächsten Abruf liegen
    expect(summe("Gebühr · Offsite Ads (Offsite Ads Fees) 2023-06")).toBe(-374);
    // Verkauf mit dem Betrag der Rechnung: 24,95 € brutto ohne die 1,45 € Sales Tax, die Etsy abführt
    expect(summe(`Verkauf · Etsy Bestellung ${BESTELLUNG_2} · Sales Tax 1,45 € von Etsy abgeführt`)).toBe(2350);
    expect(summe("Auszahlung · Etsy 2023-06-20")).toBe(-3490);
  });

  it("legt beim zweiten Abruf nichts doppelt an und zieht den Startpunkt nach", async () => {
    const result = await etsy.syncEtsy(actor, HEUTE);
    expect(result.added).toBe(0);
    const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
    expect(anzahl!.n).toBe(7);
    // Der nächste Abruf beginnt drei Tage vor der jüngsten Zeile (03.07. minus drei Tage)
    const stand = await etsy.etsySummary();
    expect(stand.fetchFrom).toBe("2023-06");
    const [row] = await sql`select fetch_from::text as f, last_sync_at, last_error from etsy_connections`;
    expect(row!.f).toBe("2023-06-30");
    expect(row!.last_error).toBeNull();
    expect(row!.last_sync_at).not.toBeNull();
  });

  it("bildet keine zweite Sammelzeile, wenn ein späterer Abruf noch Zeilen des gebündelten Monats bringt", async () => {
    // Die Überlappung reicht in den Juni, und Etsy liefert dort eine Gebühr: Ohne Prüfung entstünde eine zweite
    // Sammelzeile „Zahlungsabwicklung 2023-06“ mit nur diesem Betrag (anderer Betrag, also keine Dublette im Hash)
    imAbruf = [
      {
        entry_id: 10,
        amount: -50,
        currency: "EUR",
        ledger_type: "PAYMENT_PROCESSING_FEE",
        reference_type: "processing_fee",
        reference_id: "5000000003",
        created_timestamp: am("2023-06-30"),
      },
    ];
    try {
      const result = await etsy.syncEtsy(actor, new Date("2023-07-06T10:00:00Z"));
      expect(result.error).toBeNull();
      expect(result.added).toBe(0);
      expect(result.messages.join(" ")).toContain("schon gebündelten Monat");
      const [anzahl] = await sql`select count(*)::int as n from bank_transactions where purpose like 'Gebühr · Zahlungsabwicklung%'`;
      expect(anzahl!.n).toBe(1);
    } finally {
      imAbruf = verlauf;
    }
  });

  it("trennt die Verbindung, ohne den Schlüssel zu verlieren", async () => {
    await etsy.disconnectEtsyConnection(actor);
    const stand = await etsy.etsySummary();
    expect(stand).toMatchObject({ configured: true, connected: false, keystring: "abc", shopId: "" });
    const [row] = await sql`select ciphertext::text as c from etsy_connections`;
    expect(row!.c).not.toContain("geheim");
    expect(await etsy.etsyConnected()).toBe(false);
  });

  it("meldet fehlende Verbindung statt still nichts zu tun", async () => {
    await expect(etsy.syncEtsy(actor, HEUTE)).rejects.toThrow(/nicht verbunden/);
  });

  it("sagt es, wenn das Konto des Dienstleisters fehlt", async () => {
    await leeren(sql)`truncate bank_accounts cascade`;
    await etsy.storeEtsySecret(
      actor,
      { sharedSecret: "geheim", accessToken: "gut", refreshToken: "erneuern", expiresAt: 4_000_000_000 },
      { shopId: "35160089" },
    );
    const result = await etsy.syncEtsy(actor, HEUTE);
    expect(result.added).toBe(0);
    expect(result.accountName).toBeNull();
    expect(result.messages.join(" ")).toContain("kein Konto");
  });
});
