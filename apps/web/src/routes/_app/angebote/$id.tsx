import { discountFromColumns, type UnitLabel } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { InvoiceAttachments } from "../../../components/InvoiceAttachments.tsx";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { getQuoteDetail } from "../../../server/functions/quotes.ts";
import { FinalQuote } from "./-finales-angebot.tsx";

export const Route = createFileRoute("/_app/angebote/$id")({
  loader: ({ params }) => getQuoteDetail({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.quote.number ? `Angebot ${loaderData.quote.number}` : "Angebotsentwurf"} · Haben` }],
  }),
  component: QuotePage,
});

function QuotePage() {
  const data = Route.useLoaderData();
  const { quote } = data;
  const draftAction = useAction();
  if (quote.status === "draft") {
    return (
      <InvoiceEditor
        key={`${quote.id}-${String(quote.updatedAt)}`}
        action={draftAction}
        id={quote.id}
        kind="angebot"
        initial={{
          contactId: quote.contactId,
          contactPersonId: quote.contactPersonId,
          issueDate: quote.issueDate,
          validUntil: quote.validUntil,
          serviceFrom: quote.serviceFrom,
          serviceTo: quote.serviceTo,
          paymentTermDays: 0,
          format: "zugferd",
          intro: quote.intro,
          note: quote.note,
          buyerOrderReference: quote.buyerOrderReference,
          sellerOrderReference: quote.sellerOrderReference,
          despatchAdviceReference: quote.despatchAdviceReference,
          taxTreatment: quote.taxTreatment,
          taxDetails: quote.taxDetails,
          exemptionReason: quote.exemptionReason,
          priceMode: quote.priceMode,
          language: quote.language,
          discount: discountFromColumns(quote.discountPercent, quote.discountAmount),
          paymentPlan: quote.paymentPlan,
          paymentPlanInConfirmation: quote.paymentPlanInConfirmation,
          lines: data.lines.map((line) => ({
            description: line.description,
            detail: line.detail,
            itemNumber: line.itemNumber,
            quantity: line.quantity,
            unit: line.unit as UnitLabel,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate as 1900 | 700 | 0,
            discount: discountFromColumns(line.discountPercent, line.discountAmount),
            kind: line.kind,
          })),
        }}
        planTemplates={data.planTemplates}
        contactPersons={data.contactPersons}
        contacts={data.contacts}
        seller={data.company}
        sellerIssues={data.sellerIssues}
        letterIssues={data.letterIssues}
        issues={data.issues}
        numberCounters={data.numberCounters}
        numberRunning={data.numberRunning}
        numberPerCustomer={data.numberPerCustomer}
        numberFormat={data.numberFormat}
        corrects={null}
        bundesland={data.bundesland}
        kleinunternehmer={data.kleinunternehmer}
        articles={data.articles}
        units={data.units}
        textBlocks={data.textBlocks}
        attachments={<InvoiceAttachments kind="angebot" ownerId={quote.id} attachments={data.attachments} editable />}
      />
    );
  }
  return <FinalQuote data={data} />;
}
