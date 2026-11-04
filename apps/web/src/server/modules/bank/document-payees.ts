import { compactIban } from "@haben/core";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/** Woher Haben das Konto eines Lieferanten kennt */
export interface DocumentPayee {
  /** IBAN aus dem Kontakt des Lieferanten */
  contactIban: string | null;
  /** IBAN aus der E-Rechnung (BT-84) */
  einvoiceIban: string | null;
  /** Zahlungsbedingungen der E-Rechnung (BT-20), darin ggf. Skonto */
  paymentTerms: string | null;
  /** EndToEndIds der SEPA-Überweisungen, die Haben für den Beleg erzeugt hat */
  references: string[];
  /** IBANs, auf die diese Überweisungen gingen */
  transferIbans: string[];
}

const blankToNull = (value: string | null | undefined) => (value && value.trim() !== "" ? compactIban(value) : null);

/**
 * Konto und Überweisungsreferenzen je Beleg: für die SEPA-Datei und für die Zuordnung im Bankabgleich. Die E-Rechnung
 * steht so, wie sie gelesen wurde, in `documents.extraction` (IncomingInvoice aus @haben/einvoice).
 */
export async function documentPayees(ids: string[], q: Db | Tx = db): Promise<Map<string, DocumentPayee>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({
      id: schema.documents.id,
      contactIban: schema.contacts.iban,
      einvoiceIban: sql<
        string | null
      >`case when ${schema.documents.extractedBy} in ('zugferd', 'xrechnung') then ${schema.documents.extraction} ->> 'iban' end`,
      paymentTerms: sql<
        string | null
      >`case when ${schema.documents.extractedBy} in ('zugferd', 'xrechnung') then ${schema.documents.extraction} ->> 'paymentTerms' end`,
    })
    .from(schema.documents)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.documents.supplierContactId))
    .where(inArray(schema.documents.id, ids));
  const items = await q
    .select({ documentId: schema.sepaTransferItems.documentId, endToEndId: schema.sepaTransferItems.endToEndId, iban: schema.sepaTransferItems.creditorIban })
    .from(schema.sepaTransferItems)
    .where(inArray(schema.sepaTransferItems.documentId, ids));
  return new Map(
    rows.map((r) => {
      const own = items.filter((i) => i.documentId === r.id);
      return [
        r.id,
        {
          contactIban: blankToNull(r.contactIban),
          einvoiceIban: blankToNull(r.einvoiceIban),
          paymentTerms: r.paymentTerms,
          references: own.map((i) => i.endToEndId),
          transferIbans: [...new Set(own.map((i) => i.iban))],
        },
      ];
    }),
  );
}

/** Alle bekannten IBANs eines Lieferanten, für den Bankabgleich */
export function payeeIbans(payee: DocumentPayee | undefined): string[] {
  if (!payee) return [];
  return [...new Set([payee.contactIban, payee.einvoiceIban, ...payee.transferIbans].filter((i): i is string => i !== null))];
}
