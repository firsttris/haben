import { createFileRoute } from "@tanstack/react-router";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import { getNewQuote } from "../../../server/functions/quotes.ts";

export const Route = createFileRoute("/_app/angebote/neu")({
  loader: () => getNewQuote(),
  head: () => ({ meta: [{ title: "Neues Angebot · Haben" }] }),
  component: NewQuotePage,
});

function NewQuotePage() {
  const data = Route.useLoaderData();
  return (
    <InvoiceEditor
      id={null}
      kind="angebot"
      initial={{ ...data.draft, paymentTermDays: 0, format: "zugferd" }}
      contacts={data.contacts}
      seller={data.company}
      sellerIssues={data.sellerIssues}
      issues={[]}
      numberCounters={data.numberCounters}
      corrects={null}
      bundesland={data.bundesland}
      kleinunternehmer={data.kleinunternehmer}
    />
  );
}
