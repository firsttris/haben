import { isOwnIban, isOwnName, isOwnSteuernummer, isOwnUstId } from "./company-match.ts";
import { compactId } from "./identifiers.ts";
import { signal } from "./signal.ts";
import type { OwnInvoiceRule, OwnInvoiceSignal } from "./types.ts";

/*
 * Regeln auf Rechnungssteller und -empfänger, wie sie die E-Rechnung (BT-31/BT-32 Verkäufer, BT-48 Käufer nach
 * EN 16931) oder die KI-Auslesung angibt. Die Angaben im XML sind eindeutig zugeordnet, die der KI fast immer; daher
 * die hohen Konfidenzen. Für die KI etwas weniger, weil ein Modell Absender und Empfänger verwechseln kann.
 */

function from(source: "xml" | "ki"): string {
  return source === "xml" ? "in der E-Rechnung" : "laut KI-Auslesung";
}

function scaled(source: "xml" | "ki", confidence: number): number {
  return source === "xml" ? confidence : confidence * 0.95;
}

export const sellerUstIdRule: OwnInvoiceRule = ({ parties }, company) => {
  const ustId = parties?.seller.ustId;
  if (!parties || !ustId) return [];
  if (isOwnUstId(company, ustId)) {
    return [
      signal("rechnungssteller-ust-id", "own", scaled(parties.source, 0.98), `Die USt-IdNr. des Rechnungsstellers ${from(parties.source)} ist deine eigene.`),
    ];
  }
  if (compactId(ustId).length >= 7) {
    return [
      signal(
        "rechnungssteller-ust-id",
        "foreign",
        scaled(parties.source, 0.6),
        `Der Rechnungssteller ${from(parties.source)} hat eine andere USt-IdNr. als du.`,
      ),
    ];
  }
  return [];
};

export const sellerSteuernummerRule: OwnInvoiceRule = ({ parties }, company) =>
  parties && isOwnSteuernummer(company, parties.seller.steuernummer)
    ? [
        signal(
          "rechnungssteller-steuernummer",
          "own",
          scaled(parties.source, 0.98),
          `Die Steuernummer des Rechnungsstellers ${from(parties.source)} ist deine eigene.`,
        ),
      ]
    : [];

export const sellerIbanRule: OwnInvoiceRule = ({ parties }, company) =>
  parties && isOwnIban(company, parties.seller.iban)
    ? [signal("rechnungssteller-iban", "own", scaled(parties.source, 0.85), `Die Zahlung geht ${from(parties.source)} auf deine eigene IBAN.`)]
    : [];

export const sellerNameRule: OwnInvoiceRule = ({ parties }, company) =>
  parties && isOwnName(company, parties.seller.name)
    ? [signal("rechnungssteller-name", "own", scaled(parties.source, 0.7), `Rechnungssteller ${from(parties.source)} ist deine Firma.`)]
    : [];

export const buyerRule: OwnInvoiceRule = ({ parties }, company) => {
  const buyer = parties?.buyer;
  if (!parties || !buyer) return [];
  const signals: OwnInvoiceSignal[] = [];
  if (isOwnUstId(company, buyer.ustId)) {
    signals.push(signal("empfaenger-ust-id", "foreign", scaled(parties.source, 0.9), `Deine USt-IdNr. steht ${from(parties.source)} beim Rechnungsempfänger.`));
  }
  if (isOwnName(company, buyer.name)) {
    signals.push(signal("empfaenger-name", "foreign", scaled(parties.source, 0.6), `Rechnungsempfänger ${from(parties.source)} ist deine Firma.`));
  }
  return signals;
};

/** Eine Ausgangsrechnung mit derselben Nummer und demselben Betrag gibt es in Haben schon */
export const knownInvoiceRule: OwnInvoiceRule = ({ knownInvoiceNumber }) =>
  knownInvoiceNumber ? [signal("rechnung-in-haben", "own", 0.95, `Die Rechnung ${knownInvoiceNumber} hast du in Haben geschrieben.`)] : [];

export const PARTY_RULES: OwnInvoiceRule[] = [sellerUstIdRule, sellerSteuernummerRule, sellerIbanRule, sellerNameRule, buyerRule, knownInvoiceRule];
