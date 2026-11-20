import { PayPalClient, type PayPalClientOptions } from "@haben/import";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { env } from "../../env.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { keineExterneQuelleFuerAbruf, openConflicts } from "../bank/index.ts";
import { MAX_RUECKBLICK_TAGE, minusDays, PAYPAL_RHYTHMEN, type PayPalRhythmus } from "./abruf-regeln.ts";

/*
 * Zugang zur Transaction Search von PayPal (Einstellungen › Bank, #1512).
 *
 * Der Betreiber legt im PayPal Developer Dashboard (Apps & Credentials) eine App an, schaltet für sie „Transaction Search“
 * ein und trägt Client-ID und Secret in Haben ein; die Sandbox hat eigene Zugangsdaten. Beim Speichern fragt Haben PayPal nach
 * dem Saldo des Kontos (`GET /v1/reporting/balances`): Das prüft die Zugangsdaten und das Recht und liefert die Kennung des
 * Händlerkontos, unter der die Quellenbindung läuft. Beide Werte liegen zusammen AES-256-GCM-verschlüsselt in ciphertext,
 * nie im Klartext in der Datenbank, im Protokoll oder in einer Meldung.
 */

export class PayPalError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: PayPalClientOptions): PayPalClient => new PayPalClient(options);

export function setPayPalClientFactory(factory: (options: PayPalClientOptions) => PayPalClient) {
  clientFactory = factory;
}

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
}

export function paypalClientFor(credentials: PayPalCredentials): PayPalClient {
  return clientFactory({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    environment: credentials.sandbox ? "sandbox" : "live",
    baseUrl: env().PAYPAL_API_URL,
  });
}

async function loadRow() {
  const [row] = await db.select().from(schema.paypalConnections).where(eq(schema.paypalConnections.id, "paypal"));
  return row ?? null;
}

export interface PayPalConnection {
  row: typeof schema.paypalConnections.$inferSelect;
  credentials: PayPalCredentials;
}

export async function loadPayPalConnection(): Promise<PayPalConnection | null> {
  const row = await loadRow();
  if (!row) return null;
  const secret = JSON.parse(decrypt(row.ciphertext).toString("utf8")) as { clientId: string; clientSecret: string };
  return { row, credentials: { ...secret, sandbox: row.sandbox } };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tag als JJJJ-MM-TT");

function istZeitzone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export const paypalSettingsSchema = z.object({
  /** leer: die gespeicherten Zugangsdaten behalten */
  clientId: z.string().trim().max(300).optional(),
  clientSecret: z.string().trim().max(300).optional(),
  /** Zugangsdaten der Sandbox */
  sandbox: z.boolean().default(false),
  /** Zeitzone des PayPal-Kontos, in der der Aktivitätenexport das Datum schreibt */
  zeitzone: z.string().trim().min(1).max(64).default("Europe/Berlin"),
  /** Erster Tag, den der Abruf holt */
  fetchFrom: day,
  /** Wie oft der Zeitplan abruft */
  rhythmus: z.enum(PAYPAL_RHYTHMEN).default("taeglich"),
});

/** Meldung zu einem Fehler von PayPal beim Prüfen der Zugangsdaten; die Meldungen des Clients nennen sie nicht */
function pruefFehler(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return `PayPal nimmt die Zugangsdaten nicht an: ${text}`;
}

/**
 * Speichert Zugangsdaten und Einstellungen. Neue Zugangsdaten werden gegen PayPal geprüft und liefern die Kontokennung; gehören sie
 * zu einem anderen Konto, beginnt der Abruf wieder am gewählten Tag, weil der Stand des alten Kontos nichts über das neue sagt.
 */
export async function savePayPalConnection(actor: string, input: z.input<typeof paypalSettingsSchema>): Promise<void> {
  const data = paypalSettingsSchema.parse(input);
  if (data.fetchFrom > today()) throw new PayPalError("Der erste Tag des Abrufs liegt in der Zukunft.");
  if (data.fetchFrom < minusDays(today(), MAX_RUECKBLICK_TAGE)) {
    throw new PayPalError("PayPal liefert Transaktionen nur für die letzten drei Jahre. Ältere Umsätze kommen über den Aktivitätenexport (CSV).");
  }
  if (!istZeitzone(data.zeitzone)) throw new PayPalError(`„${data.zeitzone}“ ist keine Zeitzone (etwa Europe/Berlin).`);
  // Ein Konto, eine Quelle (#306): hat das Konto des Abrufs schon eine externe Quelle, kein Zugang
  await keineExterneQuelleFuerAbruf(db, "paypal");
  const existing = await loadPayPalConnection();
  const clientId = data.clientId?.trim();
  const clientSecret = data.clientSecret?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) throw new PayPalError("Client-ID und Secret gehören zusammen: Trage beide ein oder keines.");
  if (!clientId && !existing) throw new PayPalError("Client-ID und Secret der PayPal-App fehlen.");
  if (!clientId && existing && existing.row.sandbox !== data.sandbox) {
    throw new PayPalError("Live und Sandbox haben verschiedene Zugangsdaten: Trage die Client-ID und das Secret der gewählten Umgebung ein.");
  }
  let accountId = existing?.row.accountId ?? "";
  let credentials = existing?.credentials ?? { clientId: "", clientSecret: "", sandbox: data.sandbox };
  if (clientId && clientSecret) {
    credentials = { clientId, clientSecret, sandbox: data.sandbox };
    try {
      accountId = await paypalClientFor(credentials).accountId();
    } catch (error) {
      throw new PayPalError(pruefFehler(error));
    }
  }
  const anderesKonto = existing !== null && existing.row.accountId !== accountId;
  const startGeaendert = existing?.row.abrufStart !== data.fetchFrom;
  const values = {
    accountId,
    keyHint: credentials.clientId.slice(-4),
    sandbox: credentials.sandbox,
    ciphertext: encrypt(new TextEncoder().encode(JSON.stringify({ clientId: credentials.clientId, clientSecret: credentials.clientSecret }))),
    zeitzone: data.zeitzone,
    abrufStart: data.fetchFrom,
    rhythmus: data.rhythmus,
    // Ein anderer Start oder ein anderes Konto beginnt wieder am gewählten Tag
    fetchFrom: anderesKonto || startGeaendert || !existing ? data.fetchFrom : existing.row.fetchFrom,
    ...(anderesKonto || clientId ? { lastError: null } : {}),
    updatedAt: new Date(),
  };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.paypalConnections)
      .values({ id: "paypal", ...values })
      .onConflictDoUpdate({ target: schema.paypalConnections.id, set: values }),
  );
}

/** Entfernt den Zugang ganz; übernommene Umsätze bleiben im Konto stehen */
export async function deletePayPalConnection(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.paypalConnections).where(eq(schema.paypalConnections.id, "paypal")));
}

/** Für die Einstellungen: Stand ohne Client-ID und Secret */
export async function paypalSummary() {
  const row = await loadRow();
  return {
    configured: row !== null,
    accountId: row?.accountId ?? "",
    keyHint: row?.keyHint ?? "",
    sandbox: row?.sandbox ?? false,
    zeitzone: row?.zeitzone ?? "Europe/Berlin",
    // Die Wahl aus den Einstellungen, nicht der vorrückende Stand des Abrufs (der steht in naechsterAbrufAb)
    fetchFrom: row?.abrufStart ?? today(),
    naechsterAbrufAb: row?.fetchFrom ?? null,
    rhythmus: (row?.rhythmus ?? "taeglich") as PayPalRhythmus,
    lastSyncAt: row?.lastSyncAt ?? null,
    lastError: row?.lastError ?? null,
    updatedAt: row?.updatedAt ?? null,
    /** Offene Konflikte des Abrufs (#306): Bis sie geklärt sind, übernimmt Haben aus dem PayPal-Abruf nichts */
    konflikte: (await openConflicts()).filter((k) => k.provider === "paypal"),
  };
}
