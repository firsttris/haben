import { describeExchangeRate, discountFromColumns, formatExchangeRate, type UnitLabel } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { InvoiceAttachments } from "../../../components/InvoiceAttachments.tsx";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import { InvoiceServiceEntries } from "../../../components/InvoiceServiceEntries.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { getInvoiceDetail } from "../../../server/functions/invoices.ts";
import { FinalInvoice } from "./-rechnung-festgeschrieben.tsx";

export const Route = createFileRoute("/_app/rechnungen/$id")({
  loader: ({ params }) => getInvoiceDetail({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.invoice.number ? `Rechnung ${loaderData.invoice.number}` : "Rechnungsentwurf"} · Haben` }],
  }),
  component: InvoicePage,
});

function InvoicePage() {
  const data = Route.useLoaderData();
  const { invoice } = data;
  const draftAction = useAction();
  // Nachweis der Leistungen, aus denen die Rechnung entstanden ist (#417)
  const nachweis = <InvoiceServiceEntries entries={data.serviceEntries} />;
  if (invoice.status === "draft") {
    return (
      <>
        <InvoiceEditor
          // nach dem Speichern mit den gespeicherten Werten neu aufsetzen
          key={`${invoice.id}-${String(invoice.updatedAt)}`}
          action={draftAction}
          id={invoice.id}
          kind={invoice.kind}
          initial={{
            contactId: invoice.contactId,
            contactPersonId: invoice.contactPersonId,
            issueDate: invoice.issueDate,
            serviceFrom: invoice.serviceFrom,
            serviceTo: invoice.serviceTo,
            paymentTermDays: invoice.paymentTermDays,
            skonto: invoice.skonto,
            format: invoice.format,
            intro: invoice.intro,
            note: invoice.note,
            propertyRetention: invoice.propertyRetention,
            buyerOrderReference: invoice.buyerOrderReference,
            sellerOrderReference: invoice.sellerOrderReference,
            despatchAdviceReference: invoice.despatchAdviceReference,
            taxTreatment: invoice.taxTreatment,
            taxDetails: invoice.taxDetails,
            exemptionReason: invoice.exemptionReason,
            priceMode: invoice.priceMode,
            language: invoice.language,
            variant: invoice.variant,
            advanceType: invoice.advanceType,
            currency: invoice.currency,
            // Ein übernommener USt-Kurs bleibt im Feld leer: er folgt dem Leistungsmonat
            exchangeRate: invoice.exchangeRate && invoice.exchangeRateSource !== "ust" ? formatExchangeRate(invoice.exchangeRate) : null,
            exchangeRateDate: invoice.exchangeRateSource === "ust" ? null : invoice.exchangeRateDate,
            // Schlussrechnung zu einem Angebot: inzwischen festgeschriebene Abschläge dieses Angebots gleich mit vorschlagen
            deducts: [
              ...new Set([
                ...data.lines.flatMap((line) => (line.deductionOf ? [line.deductionOf] : [])),
                ...(invoice.variant === "schluss" && invoice.quoteId ? data.abschlaege.filter((a) => a.quoteId === invoice.quoteId).map((a) => a.id) : []),
              ]),
            ],
            quoteId: invoice.quoteId,
            discount: discountFromColumns(invoice.discountPercent, invoice.discountAmount),
            paymentMethod: invoice.paymentMethod,
            paidVia: invoice.paidVia,
            paidOn: invoice.paidOn,
            sepaMandateId: invoice.sepaMandateId,
            // Abzüge erzeugt Haben beim Speichern; im Editor stehen nur die eigenen Positionen
            lines: data.lines
              .filter((line) => !line.deductionOf)
              .map((line) => ({
                description: line.description,
                detail: line.detail,
                itemNumber: line.itemNumber,
                quantity: line.quantity,
                unit: line.unit as UnitLabel,
                unitPrice: line.unitPrice,
                taxRate: line.taxRate as 1900 | 700 | 0,
                discount: discountFromColumns(line.discountPercent, line.discountAmount),
              })),
          }}
          contacts={data.contacts}
          seller={data.company}
          sellerIssues={data.sellerIssues}
          letterIssues={data.letterIssues}
          issues={data.issues}
          numberCounters={data.numberCounters}
          numberRunning={data.numberRunning}
          numberPerCustomer={data.numberPerCustomer}
          numberFormat={data.numberFormat}
          lastFinalized={data.lastFinalized}
          corrects={data.corrects}
          bundesland={data.bundesland}
          kleinunternehmer={data.kleinunternehmer}
          companySkonto={data.companySkonto}
          mandates={data.mandates}
          contactPersons={data.contactPersons}
          articles={data.articles}
          units={data.units}
          textBlocks={data.textBlocks}
          abschlaege={data.abschlaege}
          quotes={data.quotes}
          tageskurs={data.tageskurs}
          rateInfo={
            invoice.exchangeRate ? describeExchangeRate(invoice.currency, invoice.exchangeRate, invoice.exchangeRateSource, invoice.exchangeRateDate) : null
          }
          attachments={<InvoiceAttachments ownerId={invoice.id} attachments={data.attachments} editable />}
          // Korrektur einer Schlussrechnung: Ihre Abzüge bleiben fest und außerhalb der Grundlage des Gesamtrabatts
          keptDeductions={
            invoice.kind === "rechnung"
              ? []
              : data.lines.flatMap((line) =>
                  line.deductionOf
                    ? [
                        {
                          description: line.description,
                          quantity: line.quantity,
                          unit: line.unit as UnitLabel,
                          unitPrice: line.unitPrice,
                          taxRate: line.taxRate as 1900 | 700 | 0,
                          deductionOf: line.deductionOf,
                        },
                      ]
                    : [],
                )
          }
        />
        {nachweis}
      </>
    );
  }
  return (
    <>
      <FinalInvoice data={data} />
      {nachweis}
    </>
  );
}
