import { describe, expect, it } from "vitest";
import { mapFbEstimate } from "./angebote.ts";
import type { FbEstimate } from "./types.ts";

// Angebot in der Form von estimate.get am echten Konto (Feldformen); Namen, Beträge und Bankdaten erfunden
const angebot = (fields: Partial<FbEstimate> = {}): FbEstimate => ({
  ESTIMATE_ID: "7701",
  ESTIMATE_NUMBER: "AN-2026-4",
  ESTIMATE_DATE: "2026-05-04",
  DUE_DATE: "2026-06-03",
  STATE: "sent",
  CUSTOMER_ID: "601",
  ORGANIZATION: "Muster GmbH",
  FIRST_NAME: "",
  LAST_NAME: "",
  CURRENCY_CODE: "EUR",
  SUB_TOTAL: "1000.00",
  VAT_TOTAL: "190.00",
  TOTAL: "1190.00",
  DOCUMENT_URL: "https://my.fastbill.com/download/angebot-7701",
  BANK_IBAN: "DE02120300000000202051",
  ITEMS: [{ ESTIMATE_ITEM_ID: "1", DESCRIPTION: "Konzept", QUANTITY: "1.0000", UNIT_PRICE: "1000.00" }],
  ...fields,
});

describe("mapFbEstimate", () => {
  it("bildet ein Angebot als Auftragsdokument ab, mit eigener Kennung je Quelle und Beträgen in Cent", () => {
    expect(mapFbEstimate(angebot())).toMatchObject({
      externalId: "fastbill/estimate/7701",
      kind: "AN",
      number: "AN-2026-4",
      date: "2026-05-04",
      status: "sent",
      customerId: "601",
      contactName: "Muster GmbH",
      currency: "EUR",
      net: 100_000,
      tax: 19_000,
      gross: 119_000,
    });
  });

  it("speichert die Antwort ohne Download-Adresse und ohne Bankdaten, mit Gültigkeit und Positionen", () => {
    const raw = mapFbEstimate(angebot())!.raw;
    expect(raw).not.toHaveProperty("DOCUMENT_URL");
    expect(raw).not.toHaveProperty("BANK_IBAN");
    expect(raw).toMatchObject({ DUE_DATE: "2026-06-03", ITEMS: [{ DESCRIPTION: "Konzept" }] });
  });

  it("nimmt bei Privatkunden den Namen aus Vor- und Nachname und ohne Nummer eine aus der ID", () => {
    const mapped = mapFbEstimate(angebot({ ORGANIZATION: "", FIRST_NAME: "Erika", LAST_NAME: "Beispiel", ESTIMATE_NUMBER: "", CUSTOMER_ID: "0" }));
    expect(mapped).toMatchObject({ contactName: "Erika Beispiel", number: "Angebot 7701", customerId: null });
  });

  it("übernimmt ein Angebot ohne Datum nicht", () => {
    expect(mapFbEstimate(angebot({ ESTIMATE_DATE: "0000-00-00" }))).toBeNull();
  });
});
