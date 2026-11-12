import { z } from "zod";
import { resolveRuntime, signJwt, statusPrefix, StoreApiError, storeRequest, type StoreRuntime } from "./http.ts";

/*
 * Finanzberichte aus der Google Play Console. Google legt sie monatlich als ZIP in einen eigenen Cloud-Storage-Bucket
 * (gs://pubsite_prod_rev_<id>); für die Buchhaltung gilt der Ordner earnings/ („Einnahmen“), nicht die geschätzten
 * Verkäufe in sales/. Zugriff hat ein Servicekonto, das in der Play Console unter Nutzer und Berechtigungen mit
 * „Finanzdaten ansehen“ für alle Apps eingeladen ist; IAM-Rollen am Bucket gibt es nicht, er gehört Google.
 *
 * - Berichte: https://support.google.com/googleplay/android-developer/answer/6135870
 * - Servicekonto-Token (JWT-Bearer, RFC 7523): https://developers.google.com/identity/protocols/oauth2/service-account
 * - Cloud Storage JSON API: https://cloud.google.com/storage/docs/json_api/v1/objects/list
 */

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_STORAGE_URL = "https://storage.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";
const LABEL = "Google Cloud Storage";

const serviceAccountSchema = z.looseObject({
  type: z.literal("service_account", { error: "Das ist kein Schlüssel eines Servicekontos (type ist nicht service_account)." }),
  client_email: z.string().email({ error: "client_email fehlt im Schlüssel." }),
  private_key: z.string().includes("PRIVATE KEY", { error: "private_key fehlt im Schlüssel." }),
  token_uri: z.string().url().optional(),
});

export interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
}

/** Liest die JSON-Schlüsseldatei eines Servicekontos; wirft mit lesbarer Meldung */
export function parseServiceAccount(json: string): GoogleServiceAccount {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Die Schlüsseldatei ist kein JSON.");
  }
  const parsed = serviceAccountSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Unbekannter Schlüssel.");
  return { clientEmail: parsed.data.client_email, privateKey: parsed.data.private_key };
}

/**
 * Name des Bucket aus der Angabe der Play Console: „gs://pubsite_prod_rev_01234567890987654321“ (auch mit Ordner) oder
 * nur der Name. Andere Buckets nimmt Haben nicht, damit das Servicekonto nichts anderes liest.
 */
export function googlePlayBucket(input: string): string {
  const name =
    input
      .trim()
      .replace(/^gs:\/\//i, "")
      .split("/")[0] ?? "";
  if (!/^pubsite_prod_(rev_)?[0-9a-z_]+$/i.test(name)) {
    throw new Error("Bitte die Cloud-Storage-URI aus der Play Console angeben (Berichte herunterladen › Finanzberichte), z. B. gs://pubsite_prod_rev_0123…");
  }
  return name;
}

/** Ein Einnahmenbericht im Bucket */
export interface EarningsObject {
  name: string;
  /** Berichtsmonat YYYY-MM aus dem Namen earnings_YYYYMM… */
  month: string;
  size: number;
}

const EARNINGS_NAME = /^earnings\/earnings_(\d{4})(0[1-9]|1[0-2])[^/]*\.zip$/i;

/** Monat aus dem Objektnamen; null für andere Dateien im Ordner */
export function earningsMonth(name: string): string | null {
  const found = EARNINGS_NAME.exec(name);
  return found ? `${found[1]}-${found[2]}` : null;
}

const listSchema = z.looseObject({
  items: z.array(z.looseObject({ name: z.string(), size: z.string().optional() })).default([]),
  nextPageToken: z.string().optional(),
});
const tokenSchema = z.looseObject({ access_token: z.string(), expires_in: z.number().optional() });

/** Schutz gegen eine Endlosschleife beim Blättern */
const MAX_PAGES = 100;

export interface GooglePlayClientOptions extends StoreRuntime {
  serviceAccount: GoogleServiceAccount;
  bucket: string;
  tokenUrl?: string;
  storageUrl?: string;
}

export interface GooglePlayClient {
  /** Alle Einnahmenberichte im Bucket, nach Monat aufsteigend */
  listEarnings(): Promise<EarningsObject[]>;
  /** Lädt einen Bericht unverändert (ZIP) */
  download(name: string): Promise<Uint8Array>;
}

export function createGooglePlayClient(options: GooglePlayClientOptions): GooglePlayClient {
  const rt = resolveRuntime(options);
  const tokenUrl = options.tokenUrl ?? GOOGLE_TOKEN_URL;
  const storageUrl = (options.storageUrl ?? GOOGLE_STORAGE_URL).replace(/\/+$/, "");
  const bucket = googlePlayBucket(options.bucket);
  let token: { value: string; expires: number } | null = null;

  async function accessToken(): Promise<string> {
    const now = Math.floor(rt.now() / 1000);
    if (token && token.expires - 60 > now) return token.value;
    const assertion = signJwt(
      "RS256",
      {},
      { iss: options.serviceAccount.clientEmail, scope: SCOPE, aud: tokenUrl, iat: now, exp: now + 3600 },
      options.serviceAccount.privateKey,
    );
    const response = await storeRequest(
      rt,
      "Google-Anmeldung",
      tokenUrl,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
        // Token holen ändert nichts und darf wiederholt werden
        retry: true,
      },
      oauthError,
    );
    const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new StoreApiError("Unerwartete Antwort der Google-Anmeldung", response.status, new URL(tokenUrl).pathname);
    token = { value: parsed.data.access_token, expires: now + (parsed.data.expires_in ?? 3600) };
    return token.value;
  }

  async function get(url: string): Promise<Response> {
    return storeRequest(rt, LABEL, url, { headers: { authorization: `Bearer ${await accessToken()}` } }, storageError);
  }

  return {
    async listEarnings() {
      const found: EarningsObject[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ prefix: "earnings/", fields: "items(name,size),nextPageToken" });
        if (pageToken) query.set("pageToken", pageToken);
        const response = await get(`${storageUrl}/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`);
        const parsed = listSchema.safeParse(await response.json().catch(() => null));
        if (!parsed.success) throw new StoreApiError("Unerwartete Antwort von Google Cloud Storage", response.status, "/storage/v1/b/o");
        for (const item of parsed.data.items) {
          const month = earningsMonth(item.name);
          if (month) found.push({ name: item.name, month, size: Number(item.size ?? 0) });
        }
        pageToken = parsed.data.nextPageToken;
        if (!pageToken) return found.sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));
      }
      throw new StoreApiError("Zu viele Seiten beim Auflisten der Berichte", 0, "/storage/v1/b/o");
    },

    async download(name) {
      if (earningsMonth(name) === null) throw new StoreApiError(`Kein Einnahmenbericht: ${name}`, 0, name);
      const response = await get(`${storageUrl}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** Google OAuth meldet {error, error_description} */
function oauthError(status: number, body: string): string {
  try {
    const json = JSON.parse(body) as { error?: unknown; error_description?: unknown };
    const detail = [json.error, json.error_description].filter((p): p is string => typeof p === "string" && p !== "").join(": ");
    if (detail) return `Google lehnt das Servicekonto ab (${detail})`;
  } catch {
    // kein JSON
  }
  return `Google lehnt das Servicekonto ab (${statusPrefix(status)})`;
}

/** Cloud Storage meldet {error: {code, message}} */
function storageError(status: number, body: string): string {
  let detail = body.slice(0, 300);
  try {
    const json = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof json.error?.message === "string") detail = json.error.message;
  } catch {
    // kein JSON
  }
  const hint = status === 401 || status === 403 ? " Hat das Servicekonto in der Play Console „Finanzdaten ansehen“ für alle Apps?" : "";
  return `${statusPrefix(status)}${detail ? `: ${detail}` : ""}.${hint}`;
}
