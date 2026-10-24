import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/mini";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import { getNewInvoice } from "../../../server/functions/invoices.ts";

export const Route = createFileRoute("/_app/rechnungen/neu")({
  /** schluss: Schlussrechnung zu dieser Abschlagsrechnung vorbereiten */
  validateSearch: z.object({ schluss: z.optional(z.uuid()) }),
  loader: () => getNewInvoice(),
  head: () => ({ meta: [{ title: "Neue Rechnung · Haben" }] }),
  component: NewInvoicePage,
});

function NewInvoicePage() {
  const data = Route.useLoaderData();
  const { schluss } = Route.useSearch();
  const abschlag = schluss ? data.abschlaege.find((a) => a.id === schluss) : undefined;
  const contact = abschlag ? data.contacts.find((c) => c.id === abschlag.contactId) : undefined;
  // Von einer Abschlagsrechnung aus: Kunde, Steuer, Preismodus und Angebot übernehmen; abgezogen werden die offenen
  // Abschläge dieses Angebots, ohne Angebot alle offenen Abschläge des Kunden
  const initial =
    abschlag && contact
      ? {
          ...data.draft,
          contactId: contact.id,
          language: contact.language,
          format: contact.defaultFormat ?? (contact.leitwegId ? ("xrechnung-cii" as const) : data.draft.format),
          taxTreatment: abschlag.taxTreatment,
          priceMode: abschlag.priceMode,
          variant: "schluss" as const,
          quoteId: abschlag.quoteId,
          deducts: data.abschlaege.filter((a) => a.contactId === contact.id && (!abschlag.quoteId || a.quoteId === abschlag.quoteId)).map((a) => a.id),
        }
      : data.draft;
  return (
    <InvoiceEditor
      key={abschlag ? abschlag.id : "neu"}
      id={null}
      kind="rechnung"
      initial={initial}
      contacts={data.contacts}
      seller={data.company}
      sellerIssues={data.sellerIssues}
      issues={[]}
      numberCounters={data.numberCounters}
      corrects={null}
      bundesland={data.bundesland}
      kleinunternehmer={data.kleinunternehmer}
      articles={data.articles}
      abschlaege={data.abschlaege}
      quotes={data.quotes}
    />
  );
}
