import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/mini";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import { customerDraft } from "../../../lib/invoice.ts";
import { getNewInvoice } from "../../../server/functions/invoices.ts";

export const Route = createFileRoute("/_app/rechnungen/neu")({
  /** schluss: Schlussrechnung zu dieser Abschlagsrechnung vorbereiten; kunde: Entwurf für diesen Kunden (Kontaktseite, #1557) */
  validateSearch: z.object({ schluss: z.optional(z.uuid()), kunde: z.optional(z.uuid()) }),
  loader: () => getNewInvoice(),
  head: () => ({ meta: [{ title: "Neue Rechnung · Haben" }] }),
  component: NewInvoicePage,
});

function NewInvoicePage() {
  const data = Route.useLoaderData();
  const { schluss, kunde } = Route.useSearch();
  const abschlag = schluss ? data.abschlaege.find((a) => a.id === schluss) : undefined;
  const withContact = customerDraft(data.draft, data.contacts, abschlag ? abschlag.contactId : kunde, data.companySkonto, data.contactPersons);
  // Von einer Abschlagsrechnung aus: dazu Steuer, Preismodus und Angebot; abgezogen werden die offenen
  // Abschläge dieses Angebots, ohne Angebot alle offenen Abschläge des Kunden
  const initial =
    abschlag && withContact
      ? {
          ...withContact,
          taxTreatment: abschlag.taxTreatment,
          taxDetails: abschlag.taxDetails,
          exemptionReason: abschlag.exemptionReason,
          priceMode: abschlag.priceMode,
          propertyRetention: abschlag.propertyRetention,
          variant: "schluss" as const,
          quoteId: abschlag.quoteId,
          deducts: data.abschlaege
            .filter((a) => a.contactId === withContact.contactId && (!abschlag.quoteId || a.quoteId === abschlag.quoteId))
            .map((a) => a.id),
        }
      : (withContact ?? data.draft);
  return (
    <InvoiceEditor
      key={abschlag ? abschlag.id : (withContact?.contactId ?? "neu")}
      id={null}
      kind="rechnung"
      initial={initial}
      contacts={data.contacts}
      seller={data.company}
      sellerIssues={data.sellerIssues}
      letterIssues={data.letterIssues}
      issues={[]}
      numberCounters={data.numberCounters}
      numberRunning={data.numberRunning}
      numberPerCustomer={data.numberPerCustomer}
      numberFormat={data.numberFormat}
      lastFinalized={data.lastFinalized}
      corrects={null}
      bundesland={data.bundesland}
      kleinunternehmer={data.kleinunternehmer}
      companySkonto={data.companySkonto}
      articles={data.articles}
      units={data.units}
      textBlocks={data.textBlocks}
      abschlaege={data.abschlaege}
      quotes={data.quotes}
      mandates={data.mandates}
      contactPersons={data.contactPersons}
    />
  );
}
