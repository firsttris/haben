import {
  checkAppStoreCredentials,
  createAppStoreClient,
  createGooglePlayClient,
  googlePlayBucket,
  parseServiceAccount,
  type AppStoreClient,
  type AppStoreClientOptions,
  type GooglePlayClient,
  type GooglePlayClientOptions,
} from "@haben/import";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { Store, StoreConfig } from "../../db/schema.ts";
import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { contactRoleProblem } from "../stammdaten/index.ts";

/*
 * Zugänge zu den Finanzberichten von Google Play und App Store Connect (Einstellungen › Bank). Das Geheimnis
 * (Servicekonto-JSON bzw. .p8) liegt nur verschlüsselt in ciphertext; vor dem Speichern ruft Haben die API einmal zur
 * Probe auf, damit ein falscher Zugang gleich auffällt und nicht erst beim nächtlichen Abruf.
 */

export class StoreError extends UserError {}

export const STORE_LABELS: Record<Store, string> = { googleplay: "Google Play", appstore: "App Store" };

/** Für Tests austauschbar: bauen die API-Clients */
let googlePlayFactory = (options: GooglePlayClientOptions): GooglePlayClient => createGooglePlayClient(options);
let appStoreFactory = (options: AppStoreClientOptions): AppStoreClient => createAppStoreClient(options);

export function setStoreClientFactories(factories: {
  googleplay?: (options: GooglePlayClientOptions) => GooglePlayClient;
  appstore?: (options: AppStoreClientOptions) => AppStoreClient;
}) {
  if (factories.googleplay) googlePlayFactory = factories.googleplay;
  if (factories.appstore) appStoreFactory = factories.appstore;
}

/** Basis-URLs für die E2E-Tests (nachgebaute APIs); sonst die echten */
function googleUrls() {
  const e = env();
  return { tokenUrl: e.GOOGLE_PLAY_TOKEN_URL, storageUrl: e.GOOGLE_PLAY_STORAGE_URL };
}

export function googlePlayClientFor(config: Extract<StoreConfig, { store: "googleplay" }>, secret: string): GooglePlayClient {
  return googlePlayFactory({ serviceAccount: parseServiceAccount(secret), bucket: config.bucket, ...googleUrls() });
}

export function appStoreClientFor(config: Extract<StoreConfig, { store: "appstore" }>, secret: string): AppStoreClient {
  const { issuerId, keyId, vendorNumber } = config;
  return appStoreFactory({ credentials: { issuerId, keyId, vendorNumber, privateKey: secret }, baseUrl: env().APP_STORE_CONNECT_URL });
}

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Monat als JJJJ-MM");

export const googlePlaySettingsSchema = z.object({
  store: z.literal("googleplay"),
  bucket: z.string().trim().min(1, "Cloud-Storage-URI fehlt").max(200),
  /** leer: den gespeicherten Schlüssel behalten */
  serviceAccountJson: z.string().max(20_000).optional(),
  /** Erster Berichtsmonat, den Haben abruft */
  fetchFrom: month,
});

export const appStoreSettingsSchema = z.object({
  store: z.literal("appstore"),
  issuerId: z.string().trim().max(100),
  keyId: z.string().trim().max(20),
  vendorNumber: z.string().trim().max(20),
  /** leer: den gespeicherten Schlüssel behalten */
  privateKey: z.string().max(10_000).optional(),
  fetchFrom: month,
});

export const storeSettingsSchema = z.discriminatedUnion("store", [googlePlaySettingsSchema, appStoreSettingsSchema]);

async function loadRow(store: Store) {
  const [row] = await db.select().from(schema.storeConnections).where(eq(schema.storeConnections.store, store));
  return row ?? null;
}

export async function loadConnection(store: Store) {
  const row = await loadRow(store);
  if (!row) return null;
  return { ...row, secret: decrypt(row.ciphertext).toString("utf8") };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Prüft die Angaben (auch mit einem Probeabruf) und speichert sie; das Geheimnis verschlüsselt */
export async function saveStoreConnection(actor: string, input: z.input<typeof storeSettingsSchema>): Promise<void> {
  const data = storeSettingsSchema.parse(input);
  const existing = await loadConnection(data.store);
  const newSecret = data.store === "googleplay" ? data.serviceAccountJson?.trim() : data.privateKey?.trim();
  const secret = newSecret ? (data.store === "appstore" ? `${newSecret}\n` : newSecret) : existing?.secret;
  if (!secret) throw new StoreError(data.store === "googleplay" ? "Die Schlüsseldatei des Servicekontos (JSON) fehlt." : "Der Schlüssel (.p8) fehlt.");
  if (data.fetchFrom > today().slice(0, 7)) throw new StoreError("Der erste Berichtsmonat liegt in der Zukunft.");

  let config: StoreConfig;
  try {
    if (data.store === "googleplay") {
      const account = parseServiceAccount(secret);
      config = { store: "googleplay", bucket: googlePlayBucket(data.bucket), clientEmail: account.clientEmail, contactId: existing?.config.contactId };
    } else {
      const checked = checkAppStoreCredentials({ issuerId: data.issuerId, keyId: data.keyId, vendorNumber: data.vendorNumber, privateKey: secret });
      config = {
        store: "appstore",
        issuerId: checked.issuerId,
        keyId: checked.keyId,
        vendorNumber: checked.vendorNumber,
        contactId: existing?.config.contactId,
      };
    }
  } catch (error) {
    throw new StoreError(message(error));
  }

  try {
    if (config.store === "googleplay") await googlePlayClientFor(config, secret).listEarnings();
    // Ein Monat ohne Bericht (404) ist kein Fehler; abgelehnt werden nur Anmeldung und Rechte
    else await appStoreClientFor(config, secret).financeDetail(data.fetchFrom);
  } catch (error) {
    throw new StoreError(`${STORE_LABELS[data.store]} lehnt den Zugang ab: ${message(error)}`);
  }

  const values = {
    config,
    ciphertext: encrypt(new TextEncoder().encode(secret)),
    fetchFrom: `${data.fetchFrom}-01`,
    lastError: null,
    updatedAt: new Date(),
  };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.storeConnections)
      .values({ store: data.store, ...values })
      .onConflictDoUpdate({ target: schema.storeConnections.store, set: values }),
  );
}

export const storeContactSchema = z.object({ store: z.enum(["googleplay", "appstore"]), contactId: z.uuid().nullable() });

/** Kontakt der Store-Gesellschaft für die Rechnungsentwürfe; er muss im Ausland sitzen */
export async function setStoreContact(actor: string, input: z.input<typeof storeContactSchema>): Promise<void> {
  const data = storeContactSchema.parse(input);
  const row = await loadRow(data.store);
  if (!row) throw new StoreError(`Der Abruf für ${STORE_LABELS[data.store]} ist nicht eingerichtet.`);
  if (data.contactId) {
    const [contact] = await db.select({ land: schema.contacts.land }).from(schema.contacts).where(eq(schema.contacts.id, data.contactId));
    if (!contact) throw new StoreError("Kontakt nicht gefunden.");
    if (contact.land === "DE")
      throw new StoreError("Die Store-Gesellschaft sitzt im Ausland (Google Commerce Ltd und Apple Distribution International in Irland).");
    // Nur ein neuer Kontakt wird geprüft: ein bisheriger, der inzwischen kein Kunde mehr ist, bleibt gewählt
    const problem = data.contactId === row.config.contactId ? null : await contactRoleProblem(db, data.contactId, "kunde");
    if (problem) throw new StoreError(problem);
  }
  const config = { ...row.config, contactId: data.contactId ?? undefined };
  await withActor(actor, (tx) => tx.update(schema.storeConnections).set({ config }).where(eq(schema.storeConnections.store, data.store)));
}

export async function deleteStoreConnection(actor: string, store: Store): Promise<void> {
  // Abgerufene Berichte bleiben im Archiv
  await withActor(actor, (tx) => tx.delete(schema.storeConnections).where(eq(schema.storeConnections.store, store)));
}

/** Für die Einstellungen: Zugänge ohne Geheimnis, mit Stand des Abrufs */
export async function storeConnectionsSummary() {
  const rows = await db
    .select({
      store: schema.storeConnections.store,
      config: schema.storeConnections.config,
      fetchFrom: schema.storeConnections.fetchFrom,
      lastSyncAt: schema.storeConnections.lastSyncAt,
      lastError: schema.storeConnections.lastError,
      updatedAt: schema.storeConnections.updatedAt,
    })
    .from(schema.storeConnections);
  const reports = await db
    .select({ store: schema.storeReports.store, period: schema.storeReports.period, fetchedAt: schema.storeReports.fetchedAt })
    .from(schema.storeReports);
  return rows.map((row) => {
    const own = reports.filter((r) => r.store === row.store);
    return {
      ...row,
      fetchFrom: row.fetchFrom.slice(0, 7),
      label: STORE_LABELS[row.store],
      reports: own.length,
      latestPeriod:
        own
          .map((r) => r.period)
          .sort()
          .at(-1) ?? null,
    };
  });
}
