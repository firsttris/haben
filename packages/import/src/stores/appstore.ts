import { createPrivateKey } from "node:crypto";
import { resolveRuntime, signJwt, statusPrefix, StoreApiError, storeRequest, type StoreRuntime } from "./http.ts";

/*
 * Finanzberichte aus App Store Connect (GET /v1/financeReports). Für die Buchhaltung gilt der Bericht FINANCE_DETAIL
 * der Region Z1 (alle Länder, mit Transaktions- und Abrechnungsdatum), nicht die geschätzten Sales-and-Trends-Berichte.
 * Der Monat ist Apples Fiskalmonat (YYYY-MM); der Bericht kommt als gzip-TSV und wird unverändert archiviert.
 *
 * Anmeldung mit einem Team-Schlüssel (Rolle Finance oder Admin; persönliche Schlüssel sehen keine Finanzberichte):
 * JWT ES256 mit kid = Key ID, iss = Issuer ID, aud = appstoreconnect-v1, höchstens 20 Minuten gültig.
 *
 * - https://developer.apple.com/documentation/appstoreconnectapi/get-v1-financereports
 * - https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
 * - https://developer.apple.com/help/app-store-connect/reference/financial-report-regions-and-currencies
 */

export const APP_STORE_CONNECT_URL = "https://api.appstoreconnect.apple.com";
const LABEL = "App Store Connect";
/** Apple erlaubt höchstens 20 Minuten; etwas weniger, damit Uhrabweichungen nicht stören */
const TOKEN_SECONDS = 15 * 60;

export interface AppStoreCredentials {
  issuerId: string;
  keyId: string;
  /** Inhalt der .p8-Datei (PKCS#8, EC P-256) */
  privateKey: string;
  vendorNumber: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prüft die Angaben ohne Netz; wirft mit lesbarer Meldung */
export function checkAppStoreCredentials(input: AppStoreCredentials): AppStoreCredentials {
  const issuerId = input.issuerId.trim();
  const keyId = input.keyId.trim();
  const vendorNumber = input.vendorNumber.trim();
  if (!UUID.test(issuerId)) throw new Error("Die Issuer ID ist eine UUID (App Store Connect › Benutzer und Zugriff › Integrationen).");
  if (!/^[A-Z0-9]{10}$/.test(keyId)) throw new Error("Die Key ID hat zehn Zeichen, z. B. aus dem Dateinamen AuthKey_XXXXXXXXXX.p8.");
  if (!/^\d{6,12}$/.test(vendorNumber)) throw new Error("Die Vendor-Nummer steht in App Store Connect unter Zahlungen und Finanzberichte.");
  try {
    const key = createPrivateKey(input.privateKey);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("erwartet einen EC-Schlüssel P-256");
  } catch (error) {
    throw new Error(`Der Schlüssel ist keine gültige .p8-Datei von App Store Connect: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { issuerId, keyId, vendorNumber, privateKey: input.privateKey };
}

export interface AppStoreClientOptions extends StoreRuntime {
  credentials: AppStoreCredentials;
  baseUrl?: string;
}

export interface AppStoreClient {
  /** Bericht FINANCE_DETAIL (Z1) eines Fiskalmonats als gzip; null, wenn es für den Monat (noch) keinen gibt */
  financeDetail(fiscalMonth: string): Promise<Uint8Array | null>;
}

export function createAppStoreClient(options: AppStoreClientOptions): AppStoreClient {
  const rt = resolveRuntime(options);
  const baseUrl = (options.baseUrl ?? APP_STORE_CONNECT_URL).replace(/\/+$/, "");
  const { issuerId, keyId, privateKey, vendorNumber } = options.credentials;
  let token: { value: string; expires: number } | null = null;

  function bearer(): string {
    const now = Math.floor(rt.now() / 1000);
    if (token && token.expires - 60 > now) return token.value;
    const expires = now + TOKEN_SECONDS;
    token = { value: signJwt("ES256", { kid: keyId }, { iss: issuerId, iat: now, exp: expires, aud: "appstoreconnect-v1" }, privateKey), expires };
    return token.value;
  }

  return {
    async financeDetail(fiscalMonth) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fiscalMonth)) throw new StoreApiError(`Ungültiger Monat ${fiscalMonth}`, 0, "/v1/financeReports");
      const query = new URLSearchParams({
        "filter[vendorNumber]": vendorNumber,
        "filter[regionCode]": "Z1",
        "filter[reportType]": "FINANCE_DETAIL",
        "filter[reportDate]": fiscalMonth,
      });
      const response = await storeRequest(
        rt,
        LABEL,
        `${baseUrl}/v1/financeReports?${query}`,
        { headers: { authorization: `Bearer ${bearer()}`, accept: "application/a-gzip" }, accept: [404] },
        appleError,
      );
      // 404: kein Bericht, weil der Monat noch nicht abgerechnet ist oder es keine Verkäufe gab
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** App Store Connect meldet {errors: [{code, title, detail}]} */
function appleError(status: number, body: string): string {
  let detail = body.slice(0, 300);
  try {
    const json = JSON.parse(body) as { errors?: { title?: unknown; detail?: unknown }[] };
    const first = json.errors?.[0];
    const parts = [first?.title, first?.detail].filter((p): p is string => typeof p === "string" && p !== "");
    if (parts.length > 0) detail = parts.join(": ");
  } catch {
    // kein JSON
  }
  const hint = status === 401 ? " Passen Issuer ID, Key ID und .p8 zusammen?" : status === 403 ? " Hat der Team-Schlüssel die Rolle Finance oder Admin?" : "";
  return `${statusPrefix(status)}${detail ? `: ${detail}` : ""}.${hint}`;
}
