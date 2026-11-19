import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { Icon } from "../../../components/Icon.tsx";
import { InvoiceCopyButton } from "../../../components/InvoiceCopyButton.tsx";
import { InvoiceStatus } from "../../../components/InvoiceStatus.tsx";
import { type Detail, titleOf } from "./-rechnung-daten.ts";

/** Kopf einer festgeschriebenen Rechnung: Titel mit Status, Downloads, Kopieren und die Hinweise zu Storno und Leistungsmonat */
export function RechnungKopf({
  data,
  inhaber,
  action,
  cancelled,
}: {
  data: Detail;
  inhaber: boolean;
  action: ComponentProps<typeof InvoiceCopyButton>["action"];
  cancelled: Detail["correctedBy"][number] | undefined;
}) {
  const { invoice } = data;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen">Rechnungen</Link> › {titleOf(invoice)}
          </div>
          {/* Status neben, nicht in der Überschrift: der Titel bleibt „Rechnung 2026-001“ */}
          <div className="title-with-status">
            <h1>
              {titleOf(invoice)} {invoice.number}
            </h1>
            {data.statusFacts && <InvoiceStatus invoice={data.statusFacts} />}
          </div>
        </div>
        <div className="actions">
          <a className="btn" href={`/api/rechnung/${invoice.id}/pdf?download`}>
            PDF herunterladen
          </a>
          {invoice.hasXml && (
            <a className="btn" href={`/api/rechnung/${invoice.id}/xml?download`}>
              XML herunterladen
            </a>
          )}
          {inhaber && invoice.kind === "rechnung" && (
            <a className="btn" href={`/api/dokument/lieferschein-rechnung/${invoice.id}`} target="_blank" rel="noreferrer">
              Lieferschein
            </a>
          )}
          {inhaber && <InvoiceCopyButton invoice={invoice} action={action} />}
        </div>
      </div>

      {cancelled && (
        <div className="banner banner-danger" role="status">
          <Icon name="alert" />
          <span>
            Storniert durch{" "}
            <Link to="/rechnungen/$id" params={{ id: cancelled.id }}>
              Stornorechnung {cancelled.number}
            </Link>
            .
          </span>
        </div>
      )}
      {data.leistungsmonat && (
        <div className="banner banner-warn" role="status">
          <Icon name="alert" />
          <span>{data.leistungsmonat}</span>
        </div>
      )}
    </>
  );
}
