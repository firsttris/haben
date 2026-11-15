import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signatur der Webhooks von Etsy nach dem Schema „Standard Webhooks“ (https://www.standardwebhooks.com/), ohne
 * Datenbank, damit sie sich für sich prüfen lässt. Beschreibung des Schemas in webhook.ts.
 */

/** Abweichung des Zeitstempels, die Haben noch annimmt */
const TOLERANZ_SEKUNDEN = 5 * 60;

export interface EtsyWebhookKopf {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/** Prüft Signatur und Zeitfenster einer Meldung (Standard Webhooks) */
export function etsyWebhookSignaturOk(rumpf: string, kopf: EtsyWebhookKopf, geheimnis: string, jetztSekunden: number): boolean {
  const schluessel = Buffer.from(geheimnis.startsWith("whsec_") ? geheimnis.slice("whsec_".length) : geheimnis, "base64");
  if (schluessel.length === 0 || !kopf.id || !kopf.timestamp || !kopf.signature) return false;
  const zeit = Number(kopf.timestamp);
  if (!Number.isInteger(zeit) || Math.abs(jetztSekunden - zeit) > TOLERANZ_SEKUNDEN) return false;
  const erwartet = createHmac("sha256", schluessel).update(`${kopf.id}.${kopf.timestamp}.${rumpf}`).digest();
  return kopf.signature
    .split(" ")
    .filter(Boolean)
    .some((teil) => {
      const gegeben = Buffer.from(teil.includes(",") ? teil.slice(teil.indexOf(",") + 1) : teil, "base64");
      return gegeben.length === erwartet.length && timingSafeEqual(gegeben, erwartet);
    });
}
