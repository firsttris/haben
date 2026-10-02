import { createFileRoute } from "@tanstack/react-router";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import { getNewInvoice } from "../../../server/functions/invoices.ts";

export const Route = createFileRoute("/_app/rechnungen/neu")({
  loader: () => getNewInvoice(),
  head: () => ({ meta: [{ title: "Neue Rechnung · Haben" }] }),
  component: NewInvoicePage,
});

function NewInvoicePage() {
  const data = Route.useLoaderData();
  return (
    <InvoiceEditor
      id={null}
      kind="rechnung"
      initial={data.draft}
      contacts={data.contacts}
      seller={data.company}
      sellerIssues={data.sellerIssues}
      issues={[]}
      numberCounters={data.numberCounters}
      corrects={null}
    />
  );
}
