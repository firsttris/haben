import type { Cents } from "@haben/core";
import { fbCents, fbDate, fbForArchive, fbPersonName } from "./map.ts";
import type { FbEstimate } from "./types.ts";

/*
 * Angebote aus FastBill (estimate.get) als Auftragsdokumente im Archiv, wie die aus sevDesk: ohne Buchungswirkung, mit
 * dem PDF hinter DOCUMENT_URL. Die gespeicherte Antwort enthält weder DOCUMENT_URL (wer sie kennt, lädt das PDF ohne
 * Anmeldung) noch Bankdaten.
 */

export interface FbMappedEstimate {
  /** Eindeutig über alle Quellen der Tabelle legacy_order_documents */
  externalId: string;
  kind: "AN";
  number: string;
  date: string;
  status: string;
  customerId: string | null;
  contactName: string;
  currency: string;
  net: Cents;
  tax: Cents;
  gross: Cents;
  raw: Record<string, unknown>;
}

const text = (value: unknown) => (value == null ? "" : String(value).trim());

/** null, wenn das Angebot kein Datum hat; dann lässt es sich keinem Jahr zuordnen */
export function mapFbEstimate(e: FbEstimate): FbMappedEstimate | null {
  const date = fbDate(text(e.ESTIMATE_DATE));
  if (!date) return null;
  const id = text(e.ESTIMATE_ID);
  const customerId = text(e.CUSTOMER_ID);
  return {
    externalId: `fastbill/estimate/${id}`,
    kind: "AN",
    number: text(e.ESTIMATE_NUMBER) || `Angebot ${id}`,
    date,
    status: text(e.STATE),
    customerId: customerId && customerId !== "0" ? customerId : null,
    contactName: text(e.ORGANIZATION) || fbPersonName(e.FIRST_NAME, e.LAST_NAME) || "",
    currency: text(e.CURRENCY_CODE).toUpperCase() || "EUR",
    net: fbCents(e.SUB_TOTAL),
    tax: fbCents(e.VAT_TOTAL),
    gross: fbCents(e.TOTAL),
    raw: fbForArchive(e),
  };
}
