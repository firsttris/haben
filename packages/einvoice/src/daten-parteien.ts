import type { Invoice, PartyIdentification } from "./modell.ts";
import { collectedByDirectDebit } from "./format.ts";
import { legalLine } from "./pdf.ts";
import type { InvoiceDocument } from "./types.ts";

/* Verkäufer und Käufer im Rechnungsmodell (daten.ts) */

/**
 * Verkäufer als juristische Person (BG-4): Name (BT-27), bei GmbH und UG die Handelsregisternummer als Kennung aus
 * einem amtlichen Register (BT-30, ohne Schema: ISO/IEC 6523 kennt das deutsche Handelsregister nicht) und die
 * Pflichtangaben nach § 35a GmbHG als „Seller additional legal information“ (BT-33, in CII ram:Description).
 * Quelle: EN 16931-1, Semantisches Datenmodell, BG-4.
 */
function sellerLegalEntity(seller: InvoiceDocument["seller"]) {
  const legal = legalLine(seller.legalInfo);
  return {
    "cbc:RegistrationName": seller.name,
    ...(seller.legalInfo?.registerNumber ? { "cbc:CompanyID": seller.legalInfo.registerNumber } : {}),
    ...(legal ? { "cbc:CompanyLegalForm": legal } : {}),
  };
}

/**
 * Verkäuferkennungen (BT-29, 0..n): zuerst unsere Lieferantennummer beim Kunden (#711), ohne schemeID, denn der Kunde
 * vergibt sie selbst; das Schema (BT-29-1) ist laut EN 16931-1 optional und stammt sonst aus ISO/IEC 6523, das solche
 * Nummern nicht kennt. BR-CO-26: ohne USt-IdNr. dient die Steuernummer als Verkäuferkennung. Bei Lastschrift die
 * Gläubiger-ID als Bank assigned creditor identifier (BT-90, schemeID SEPA); cii.ts setzt sie im CII als ram:CreditorReferenceID.
 */
function sellerIdentifiers(doc: InvoiceDocument, outOfScope: boolean): PartyIdentification[] {
  const { seller, buyer } = doc;
  return [
    ...(buyer.unsereLieferantennummer ? [{ "cbc:ID": buyer.unsereLieferantennummer }] : []),
    ...((!seller.ustId || outOfScope) && (seller.steuernummer || seller.ustId) ? [{ "cbc:ID": seller.steuernummer || seller.ustId! }] : []),
    ...(collectedByDirectDebit(doc) ? [{ "cbc:ID": doc.directDebit.creditorId, "cbc:ID@schemeID": "SEPA" as const }] : []),
  ];
}

/** Verkäufer (BG-4) mit Endpunkt, Kennungen, Anschrift, Steuernummern und Kontakt */
export function sellerParty(doc: InvoiceDocument, outOfScope: boolean): Invoice["cac:AccountingSupplierParty"] {
  const { seller } = doc;
  const sellerTax: { "cbc:CompanyID": string; "cac:TaxScheme": { "cbc:ID": string } }[] = [];
  if (seller.ustId && !outOfScope) sellerTax.push({ "cbc:CompanyID": seller.ustId, "cac:TaxScheme": { "cbc:ID": "VAT" } });
  if (seller.steuernummer) sellerTax.push({ "cbc:CompanyID": seller.steuernummer, "cac:TaxScheme": { "cbc:ID": "FC" } });

  const sellerIds = sellerIdentifiers(doc, outOfScope);
  const sellerContact: NonNullable<Invoice["cac:AccountingSupplierParty"]["cac:Party"]["cac:Contact"]> = {
    "cbc:Name": seller.name,
    "cbc:ElectronicMail": seller.email,
  };
  if (seller.telefon) sellerContact["cbc:Telephone"] = seller.telefon;

  return {
    "cac:Party": {
      "cbc:EndpointID": seller.email,
      "cbc:EndpointID@schemeID": "EM",
      // Verkäuferkennungen (BT-29) und Gläubiger-ID (BT-90), siehe sellerIds
      ...(sellerIds.length > 0 ? { "cac:PartyIdentification": sellerIds } : {}),
      "cac:PostalAddress": {
        "cbc:StreetName": seller.strasse,
        "cbc:CityName": seller.ort,
        "cbc:PostalZone": seller.plz,
        "cac:Country": { "cbc:IdentificationCode": seller.land.toUpperCase() },
      },
      ...(sellerTax.length > 0 ? { "cac:PartyTaxScheme": sellerTax as Invoice["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyTaxScheme"] } : {}),
      "cac:PartyLegalEntity": sellerLegalEntity(seller),
      "cac:Contact": sellerContact,
    },
  };
}

/** Käufer (BG-7) mit Endpunkt, Kundennummer, Anschrift, USt-IdNr. und Kontakt */
export function buyerParty(doc: InvoiceDocument, outOfScope: boolean): Invoice["cac:AccountingCustomerParty"] {
  const { buyer } = doc;
  // BT-49: E-Mail, sonst Leitweg-ID (Schema 0204)
  const buyerEndpoint = buyer.email
    ? { "cbc:EndpointID": buyer.email, "cbc:EndpointID@schemeID": "EM" as const }
    : buyer.leitwegId
      ? { "cbc:EndpointID": buyer.leitwegId, "cbc:EndpointID@schemeID": "0204" as const }
      : {};

  return {
    "cac:Party": {
      ...buyerEndpoint,
      ...(buyer.kundennummer ? { "cac:PartyIdentification": { "cbc:ID": buyer.kundennummer } } : {}),
      "cac:PostalAddress": {
        "cbc:StreetName": buyer.strasse,
        "cbc:CityName": buyer.ort,
        "cbc:PostalZone": buyer.plz,
        "cac:Country": { "cbc:IdentificationCode": buyer.land.toUpperCase() },
      },
      ...(buyer.ustId && !outOfScope ? { "cac:PartyTaxScheme": { "cbc:CompanyID": buyer.ustId, "cac:TaxScheme": { "cbc:ID": "VAT" } } } : {}),
      "cac:PartyLegalEntity": { "cbc:RegistrationName": buyer.name },
      // BT-56 Ansprechpartner des Käufers (#424), BT-58 die E-Mail des Kontakts wie bisher; Reihenfolge laut Schema: Name vor E-Mail
      ...(buyer.email || buyer.ansprechpartner
        ? {
            "cac:Contact": {
              ...(buyer.ansprechpartner ? { "cbc:Name": buyer.ansprechpartner.name } : {}),
              ...(buyer.email ? { "cbc:ElectronicMail": buyer.email } : {}),
            },
          }
        : {}),
    },
  };
}
