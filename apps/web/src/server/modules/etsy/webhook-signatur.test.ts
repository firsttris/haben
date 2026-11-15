import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { etsyWebhookSignaturOk } from "./webhook-signatur.ts";

/** Signaturschlüssel wie in der Etsy-App, mit Präfix „whsec_“; der Wert ist erfunden */
const SCHLUESSEL = Buffer.from("ein-erfundener-schluessel-fuer-tests").toString("base64");
const GEHEIMNIS = `whsec_${SCHLUESSEL}`;
const JETZT = 1_794_740_000;
const RUMPF = '{"event_type":"order.paid","resource_url":"https://openapi.etsy.com/v3/application/shops/1/receipts/2","shop_id":1}';

function signiere(rumpf: string, id: string, zeit: number, schluessel = SCHLUESSEL): string {
  return createHmac("sha256", Buffer.from(schluessel, "base64")).update(`${id}.${zeit}.${rumpf}`).digest("base64");
}

describe("Signatur der Etsy-Webhooks (Standard Webhooks)", () => {
  it("nimmt eine richtig signierte Meldung an, mit und ohne Präfix „whsec_“", () => {
    const kopf = { id: "msg_1", timestamp: String(JETZT), signature: `v1,${signiere(RUMPF, "msg_1", JETZT)}` };
    expect(etsyWebhookSignaturOk(RUMPF, kopf, GEHEIMNIS, JETZT)).toBe(true);
    expect(etsyWebhookSignaturOk(RUMPF, kopf, SCHLUESSEL, JETZT)).toBe(true);
  });

  it("findet die passende unter mehreren Signaturen, etwa beim Wechsel des Schlüssels", () => {
    const alt = signiere(RUMPF, "msg_2", JETZT, Buffer.from("alter-schluessel").toString("base64"));
    const kopf = { id: "msg_2", timestamp: String(JETZT), signature: `v1,${alt} v1,${signiere(RUMPF, "msg_2", JETZT)}` };
    expect(etsyWebhookSignaturOk(RUMPF, kopf, GEHEIMNIS, JETZT)).toBe(true);
  });

  it("lehnt einen veränderten Rumpf, einen fremden Schlüssel und eine andere Kennung ab", () => {
    const signatur = `v1,${signiere(RUMPF, "msg_3", JETZT)}`;
    expect(
      etsyWebhookSignaturOk(RUMPF.replace("order.paid", "order.canceled"), { id: "msg_3", timestamp: String(JETZT), signature: signatur }, GEHEIMNIS, JETZT),
    ).toBe(false);
    expect(
      etsyWebhookSignaturOk(RUMPF, { id: "msg_3", timestamp: String(JETZT), signature: signatur }, `whsec_${Buffer.from("fremd").toString("base64")}`, JETZT),
    ).toBe(false);
    expect(etsyWebhookSignaturOk(RUMPF, { id: "msg_4", timestamp: String(JETZT), signature: signatur }, GEHEIMNIS, JETZT)).toBe(false);
  });

  it("lehnt Meldungen außerhalb von fünf Minuten und ohne Kopfzeilen ab", () => {
    const alt = JETZT - 301;
    expect(etsyWebhookSignaturOk(RUMPF, { id: "msg_5", timestamp: String(alt), signature: `v1,${signiere(RUMPF, "msg_5", alt)}` }, GEHEIMNIS, JETZT)).toBe(
      false,
    );
    const knapp = JETZT - 299;
    expect(etsyWebhookSignaturOk(RUMPF, { id: "msg_6", timestamp: String(knapp), signature: `v1,${signiere(RUMPF, "msg_6", knapp)}` }, GEHEIMNIS, JETZT)).toBe(
      true,
    );
    expect(etsyWebhookSignaturOk(RUMPF, { id: null, timestamp: String(JETZT), signature: "v1,x" }, GEHEIMNIS, JETZT)).toBe(false);
    expect(etsyWebhookSignaturOk(RUMPF, { id: "msg_7", timestamp: String(JETZT), signature: `v1,${signiere(RUMPF, "msg_7", JETZT)}` }, "", JETZT)).toBe(false);
  });
});
