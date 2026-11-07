import { toElsterSteuernummer, type Bundesland, type OwnCompany, type StatedParties } from "@haben/core";
import type { IncomingInvoice } from "@haben/einvoice";
import type { Extraction } from "./extraction-schema.ts";

/*
 * Firmendaten, E-Rechnung und KI-Antwort in der Form der Erkennung eigener Ausgangsrechnungen (@haben/core); ohne
 * Datenbank, damit die Tests der Textebene ohne Postgres laufen.
 */

/** Firmendaten in der Form der Erkennung; die Steuernummer auch im ELSTER-Format, wie manche Programme sie drucken */
export function ownCompanyOf(company: { name: string; ustId: string; steuernummer: string; bundesland: string | null; iban: string; plz: string }): OwnCompany {
  return {
    name: company.name,
    ustId: company.ustId,
    steuernummern: [company.steuernummer, elsterForm(company.steuernummer, company.bundesland)].filter((s): s is string => !!s),
    iban: company.iban,
    plz: company.plz,
  };
}

function elsterForm(steuernummer: string, bundesland: string | null): string | null {
  if (!steuernummer || !bundesland) return null;
  try {
    return toElsterSteuernummer(steuernummer, bundesland as Bundesland);
  } catch {
    return null;
  }
}

export function partiesOfEInvoice(invoice: IncomingInvoice): StatedParties {
  return {
    source: "xml",
    seller: { name: invoice.seller.name, ustId: invoice.seller.ustId, steuernummer: invoice.seller.steuernummer, iban: invoice.iban ?? invoice.seller.iban },
    buyer: invoice.buyer ? { name: invoice.buyer.name, ustId: invoice.buyer.ustId } : undefined,
  };
}

export function partiesOfExtraction(extraction: Extraction): StatedParties {
  return {
    source: "ki",
    seller: { name: extraction.lieferant, ustId: extraction.lieferantUstId },
    buyer: { name: extraction.empfaenger, ustId: extraction.empfaengerUstId },
  };
}
