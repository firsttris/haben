import { compactIban, isValidIban } from "@haben/core";
import type { IncomingInvoice } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import type { Extraction } from "./extraction-schema.ts";

/**
 * Vorschlag für einen neuen Lieferanten aus dem Beleg (#329, #330): aus der E-Rechnung Name, Anschrift, USt-IdNr. und
 * E-Mail des Verkäufers (EN 16931, BG-4/BG-5, BT-31), aus der KI-Auslesung Name und USt-IdNr. Die IBAN ist immer nur
 * ein Vorschlag mit Herkunft, Fundstelle und Prüfziffer: In den Kontakt kommt sie erst, wenn man sie ausdrücklich
 * übernimmt; eine IBAN aus der KI-Auslesung steht nie am Beleg und geht nie in eine Überweisung (document-payees.ts
 * liest nur die der E-Rechnung).
 */

export interface SupplierSuggestion {
  contact: { name?: string; ustId?: string; strasse?: string; plz?: string; ort?: string; land?: string; email?: string };
  iban: { iban: string; source: "e-rechnung" | "ki"; fundstelle: string | null; valid: boolean } | null;
}

/** Wie eine IBAN aussieht: Ländercode, Prüfziffer, 11 bis 30 Zeichen; die Prüfziffer selbst prüft isValidIban */
const IBAN_SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

function ibanOf(raw: string | null | undefined, source: "e-rechnung" | "ki", fundstelle: string | null): SupplierSuggestion["iban"] {
  const iban = raw ? compactIban(raw) : "";
  if (!IBAN_SHAPE.test(iban)) return null;
  return { iban, source, fundstelle: fundstelle?.trim().slice(0, 300) || null, valid: isValidIban(iban) };
}

/** Nur gesetzte Felder, damit ein leerer Wert das Formular nicht überschreibt */
function present(fields: SupplierSuggestion["contact"]): SupplierSuggestion["contact"] {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => typeof value === "string" && value.trim() !== "")) as SupplierSuggestion["contact"];
}

export async function supplierSuggestion(documentId: string): Promise<SupplierSuggestion> {
  const [doc] = await db
    .select({ extractedBy: schema.documents.extractedBy, extraction: schema.documents.extraction })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!doc?.extraction) return { contact: {}, iban: null };
  if (doc.extractedBy === "zugferd" || doc.extractedBy === "xrechnung") {
    const invoice = doc.extraction as unknown as IncomingInvoice;
    const seller = invoice.seller;
    return {
      contact: present({
        name: seller?.name,
        ustId: seller?.ustId?.replace(/\s/g, "").toUpperCase(),
        strasse: seller?.strasse,
        plz: seller?.plz,
        ort: seller?.ort,
        land: seller?.land?.toUpperCase(),
        email: seller?.email,
      }),
      // BT-84 ist das Konto, auf das gezahlt wird (EN 16931); bei einer Gutschrift zahlt der Lieferant, das Konto ist das des Käufers
      iban: invoice.isCreditNote ? null : ibanOf(invoice.iban ?? seller?.iban, "e-rechnung", null),
    };
  }
  if (doc.extractedBy === "ki") {
    const extraction = doc.extraction as unknown as Extraction;
    return {
      contact: present({ name: extraction.lieferant?.trim(), ustId: extraction.lieferantUstId?.replace(/\s/g, "").toUpperCase() }),
      iban: ibanOf(extraction.lieferantIban, "ki", extraction.lieferantIbanFundstelle ?? null),
    };
  }
  return { contact: {}, iban: null };
}
