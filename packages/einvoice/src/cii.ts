import type { InvoiceServiceOptions } from "@e-invoice-eu/core";
import { presentReferences } from "./format.ts";
import type { OrderReferences } from "./types.ts";

/**
 * Nacharbeit am CII, das e-invoice-eu erzeugt (ZUGFeRD und XRechnung CII). Die Reihenfolge der Elemente folgt dem
 * Schema: CrossIndustryInvoice D16B (KoSIT, validator-configuration-xrechnung) bzw. FACTUR-X_EN16931.xsd
 * (ZUGFeRD 2.5), beide mit derselben Teilfolge für die Elemente hier.
 */

type Node = Record<string, unknown>;
type PostProcessor = NonNullable<InvoiceServiceOptions["postProcessor"]>;

/** Elemente vor ram:BuyerOrderReferencedDocument in HeaderTradeAgreementType */
const BEFORE_BUYER_ORDER = [
  "ram:Reference",
  "ram:BuyerReference",
  "ram:SellerTradeParty",
  "ram:BuyerTradeParty",
  "ram:SalesAgentTradeParty",
  "ram:BuyerRequisitionerTradeParty",
  "ram:BuyerAssignedAccountantTradeParty",
  "ram:SellerAssignedAccountantTradeParty",
  "ram:BuyerTaxRepresentativeTradeParty",
  "ram:SellerTaxRepresentativeTradeParty",
  "ram:ProductEndUserTradeParty",
  "ram:ApplicableTradeDeliveryTerms",
  "ram:SellerOrderReferencedDocument",
];

/** Elemente vor ram:DespatchAdviceReferencedDocument in HeaderTradeDeliveryType */
const BEFORE_DESPATCH_ADVICE = [
  "ram:RelatedSupplyChainConsignment",
  "ram:ShipToTradeParty",
  "ram:UltimateShipToTradeParty",
  "ram:ShipFromTradeParty",
  "ram:ActualDespatchSupplyChainEvent",
  "ram:ActualPickUpSupplyChainEvent",
  "ram:ActualDeliverySupplyChainEvent",
  "ram:ActualReceiptSupplyChainEvent",
  "ram:AdditionalReferencedDocument",
];

/** Neues Objekt mit key hinter dem letzten der Schlüssel aus before, die node hat; sonst ganz vorn */
export function insertAfter(node: Node, key: string, value: unknown, before: string[]): Node {
  const keys = Object.keys(node).filter((k) => k !== key);
  const lastBefore = keys.reduce((last, k, i) => (before.includes(k) ? i : last), -1);
  const entries = keys.map((k) => [k, node[k]] as const);
  entries.splice(lastBefore + 1, 0, [key, value]);
  return Object.fromEntries(entries);
}

function transaction(data: unknown): Node | undefined {
  const root = (data as Record<string, Node | undefined>)["rsm:CrossIndustryInvoice"];
  return root?.["rsm:SupplyChainTradeTransaction"] as Node | undefined;
}

/** CII verlangt ApplicableHeaderTradeDelivery auch ohne Inhalt; e-invoice-eu lässt es bei reinem Leistungszeitraum weg. */
function ensureHeaderTradeDelivery(tx: Node): Node {
  if ("ram:ApplicableHeaderTradeDelivery" in tx) return tx;
  return insertAfter(tx, "ram:ApplicableHeaderTradeDelivery", {}, ["ram:IncludedSupplyChainTradeLineItem", "ram:ApplicableHeaderTradeAgreement"]);
}

/**
 * Referenzen, die e-invoice-eu 3.4.2 im CII verliert (gflohr/e-invoice-eu#685):
 * - BT-13 (ram:BuyerOrderReferencedDocument) nur im Profil EXTENDED abgebildet, fehlt also im ZUGFeRD (EN 16931),
 *   obwohl Factur-X es ab dem Profil MINIMUM erlaubt;
 * - BT-16 (ram:DespatchAdviceReferencedDocument) unter cac:Delivery gesucht statt auf Ebene der Rechnung, fehlt in
 *   jedem CII.
 * Setzt beide, wenn sie fehlen; BT-14 (ram:SellerOrderReferencedDocument) kommt an. Ohne Bestellnummer entfällt der
 * Platzhalter „NA“, den UBL in cac:OrderReference/cbc:ID braucht und e-invoice-eu ins XRechnung-CII übernimmt.
 */
function addReferences(tx: Node, references: OrderReferences): Node {
  const { buyerOrder, despatchAdvice } = presentReferences(references);
  let result = tx;
  const agreement = result["ram:ApplicableHeaderTradeAgreement"] as Node | undefined;
  if (!buyerOrder && agreement && "ram:BuyerOrderReferencedDocument" in agreement) {
    const { "ram:BuyerOrderReferencedDocument": _placeholder, ...rest } = agreement;
    result = { ...result, "ram:ApplicableHeaderTradeAgreement": rest };
  }
  if (buyerOrder && agreement && !("ram:BuyerOrderReferencedDocument" in agreement)) {
    const updated = insertAfter(agreement, "ram:BuyerOrderReferencedDocument", { "ram:IssuerAssignedID": buyerOrder }, BEFORE_BUYER_ORDER);
    result = { ...result, "ram:ApplicableHeaderTradeAgreement": updated };
  }
  const delivery = (result["ram:ApplicableHeaderTradeDelivery"] ?? {}) as Node;
  if (despatchAdvice && !("ram:DespatchAdviceReferencedDocument" in delivery)) {
    const updated = insertAfter(delivery, "ram:DespatchAdviceReferencedDocument", { "ram:IssuerAssignedID": despatchAdvice }, BEFORE_DESPATCH_ADVICE);
    result = { ...result, "ram:ApplicableHeaderTradeDelivery": updated };
  }
  return result;
}

/** Nacharbeit für das CII einer Rechnung; UBL bleibt unberührt */
export function ciiPostProcessor(references: OrderReferences | undefined): PostProcessor {
  return async (data) => {
    const tx = transaction(data);
    if (!tx) return;
    const root = (data as Record<string, Node>)["rsm:CrossIndustryInvoice"]!;
    root["rsm:SupplyChainTradeTransaction"] = addReferences(ensureHeaderTradeDelivery(tx), references ?? {});
  };
}
