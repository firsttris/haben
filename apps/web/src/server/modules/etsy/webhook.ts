import { loadEtsyConnection } from "./connections.ts";
import { ETSY_SYNC_ACTOR, syncEtsy } from "./sync.ts";
import { type EtsyWebhookKopf, etsyWebhookSignaturOk } from "./webhook-signatur.ts";

/*
 * Webhooks von Etsy: Bei einer bezahlten oder stornierten Bestellung schickt Etsy einen POST mit schlankem Rumpf
 * (event_type, resource_url, shop_id), signiert nach dem Schema „Standard Webhooks“:
 *
 *   signierter Inhalt = "<webhook-id>.<webhook-timestamp>.<roher Rumpf>"
 *   Schlüssel         = base64-decode(Signaturschlüssel ohne Präfix „whsec_“)
 *   Signatur          = base64(HMAC-SHA256(Inhalt, Schlüssel)), im Kopf webhook-signature als „v1,<wert>“ (mehrere möglich)
 *
 * Haben übernimmt aus der Meldung selbst nichts, sondern plant nur einen Abruf des Verlaufs (sync.ts); so bleibt der
 * Weg derselbe wie beim Zeitplan, und eine gefälschte Meldung könnte höchstens einen Abruf auslösen. Das Zeitfenster
 * schützt gegen wiederholte Zustellung.
 */

/** Ereignisse, nach denen sich der Zahlungsverlauf ändert */
export const ETSY_WEBHOOK_EREIGNISSE: ReadonlySet<string> = new Set(["order.paid", "order.canceled"]);

/** Etsy schreibt die Zeile kurz nach der Meldung in den Verlauf; der Abruf wartet deshalb eine Minute */
const VERZOEGERUNG_MS = 60_000;

/** Größter angenommener Rumpf; Etsy schickt nur wenige Felder */
const MAX_RUMPF = 64 * 1024;

let geplant: Promise<void> | null = null;

/** Plant einen Abruf; kommen mehrere Meldungen kurz nacheinander, bleibt es bei einem */
export function planeEtsyAbruf(verzoegerungMs = VERZOEGERUNG_MS): Promise<void> {
  if (geplant) return geplant;
  geplant = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      syncEtsy(ETSY_SYNC_ACTOR)
        .then((ergebnis) => {
          if (ergebnis.error) console.warn(`Etsy Payments (Webhook): ${ergebnis.error}`);
        })
        .catch((error) => console.error("Etsy Payments (Webhook)", error))
        .finally(() => {
          geplant = null;
          resolve();
        });
    }, verzoegerungMs);
    timer.unref?.();
  });
  return geplant;
}

export interface EtsyWebhookAntwort {
  status: number;
  text: string;
  /** Der geplante Abruf, für Tests */
  abruf?: Promise<void>;
}

/** Nimmt eine Meldung von Etsy an: prüfen, dann einen Abruf planen */
export async function etsyWebhookEmpfangen(
  rumpf: string,
  kopf: EtsyWebhookKopf,
  optionen: { jetzt?: Date; verzoegerungMs?: number } = {},
): Promise<EtsyWebhookAntwort> {
  if (rumpf.length > MAX_RUMPF) return { status: 413, text: "Meldung zu groß." };
  const connection = await loadEtsyConnection();
  const geheimnis = connection?.secret.webhookSecret;
  if (!connection || !geheimnis) return { status: 404, text: "Webhooks sind nicht eingerichtet." };
  const jetzt = optionen.jetzt ?? new Date();
  if (!etsyWebhookSignaturOk(rumpf, kopf, geheimnis, Math.floor(jetzt.getTime() / 1000))) return { status: 401, text: "Signatur ungültig." };
  if (!connection.secret.refreshToken || !connection.row.shopId) return { status: 409, text: "Der Etsy-Zugang ist nicht verbunden." };
  let ereignis: { event_type?: unknown; shop_id?: unknown };
  try {
    ereignis = JSON.parse(rumpf);
  } catch {
    return { status: 400, text: "Die Meldung ist kein JSON." };
  }
  if (String(ereignis.shop_id ?? "") !== connection.row.shopId) return { status: 400, text: "Die Meldung gehört zu einem anderen Shop." };
  const art = typeof ereignis.event_type === "string" ? ereignis.event_type : "";
  if (!ETSY_WEBHOOK_EREIGNISSE.has(art)) return { status: 200, text: `Ereignis ${art || "ohne Art"} ohne Bedeutung für den Zahlungsverlauf.` };
  return { status: 202, text: "Abruf geplant.", abruf: planeEtsyAbruf(optionen.verzoegerungMs) };
}
