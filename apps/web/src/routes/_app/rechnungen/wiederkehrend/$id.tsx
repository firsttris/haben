import { formatEuro, type RecurringInterval, type ServicePeriodMode, type TaxTreatment, type UnitLabel } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { RecurringForm } from "../../../../components/RecurringForm.tsx";
import { formatDate, formatDateTime } from "../../../../lib/format.ts";
import { NoticeBanner } from "../../../../components/NoticeBanner.tsx";
import { useAction } from "../../../../lib/use-action.ts";
import { getRecurringDetail, removeRecurring, saveRecurring } from "../../../../server/functions/recurring.ts";
import { ConfirmDialog } from "../../../../components/ConfirmDialog.tsx";

export const Route = createFileRoute("/_app/rechnungen/wiederkehrend/$id")({
  loader: ({ params }) => getRecurringDetail({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.recurring.name ?? "Vorlage"} · Haben` }] }),
  component: RecurringDetailPage,
});

function RecurringDetailPage() {
  const { recurring, invoices, contacts, textBlocks, defaults, sevdesk } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveRecurring);
  const remove = useServerFn(removeRecurring);
  const { busy, notice, run } = useAction();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen/wiederkehrend">Wiederkehrende Rechnungen</Link> › Vorlage
          </div>
          <h1>{recurring.name}</h1>
        </div>
        {invoices.length === 0 && (
          <div className="actions">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
              Löschen
            </button>
            <ConfirmDialog
              open={confirmingDelete}
              title={`${recurring.name} löschen?`}
              confirmLabel="Vorlage löschen"
              danger
              onConfirm={() =>
                run(async () => {
                  await remove({ data: recurring.id });
                  await navigate({ to: "/rechnungen/wiederkehrend" });
                })
              }
              onClose={() => setConfirmingDelete(false)}
            >
              <p>Die Vorlage wird endgültig entfernt. Das lässt sich nicht rückgängig machen.</p>
            </ConfirmDialog>
          </div>
        )}
      </div>
      {recurring.lastError && (
        <div className="banner" role="alert">
          {recurring.lastError}
        </div>
      )}
      <NoticeBanner notice={notice} />
      <div className="editor-grid">
        <RecurringForm
          key={String(recurring.updatedAt)}
          initial={{
            name: recurring.name,
            active: recurring.active,
            contactId: recurring.contactId,
            format: recurring.format,
            paymentTermDays: recurring.paymentTermDays,
            intro: recurring.intro,
            note: recurring.note,
            propertyRetention: recurring.propertyRetention,
            taxTreatment: recurring.taxTreatment as TaxTreatment,
            exemptionReason: recurring.exemptionReason,
            priceMode: recurring.priceMode,
            lines: recurring.lines.map((l) => ({ ...l, detail: l.detail ?? "", unit: l.unit as UnitLabel, taxRate: l.taxRate as 1900 | 700 | 0 })),
            intervalMonths: recurring.intervalMonths as RecurringInterval,
            nextDate: recurring.nextDate,
            endDate: recurring.endDate,
            servicePeriod: recurring.servicePeriod as ServicePeriodMode,
            mode: recurring.mode,
            sendByMail: recurring.sendByMail,
            paymentMethod: recurring.paymentMethod,
          }}
          contacts={contacts}
          textBlocks={textBlocks}
          kleinunternehmer={defaults.kleinunternehmer}
          busy={busy}
          submitLabel="Speichern"
          onSubmit={(values) =>
            run(async () => {
              await save({ data: { id: recurring.id, recurring: values } });
              await router.invalidate();
            }, "Gespeichert.")
          }
        />
        <div className="stack">
          {sevdesk && <SevdeskOrigin origin={sevdesk} />}
          <section className="card stack" aria-labelledby="history-heading">
            <h2 id="history-heading">Erzeugte Rechnungen</h2>
            {recurring.lastRunAt && (
              <p className="small muted" style={{ margin: 0 }}>
                Zuletzt geprüft {formatDateTime(recurring.lastRunAt)}
              </p>
            )}
            {invoices.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Noch keine. Die erste entsteht am {formatDate(recurring.nextDate)}.
              </p>
            ) : (
              <div className="table">
                {invoices.map((invoice) => (
                  <Link key={invoice.id} to="/rechnungen/$id" params={{ id: invoice.id }} className="table-row recurring-history-cols">
                    <div className="small">{formatDate(invoice.issueDate)}</div>
                    <div className="mono small">{invoice.number ?? "Entwurf"}</div>
                    <div className="num">{formatEuro(invoice.gross)}</div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

const SEV_STATUS: Record<string, string> = { "50": "deaktiviert", "100": "aktiv", "1000": "beendet" };

type SevdeskOriginData = {
  status: string;
  billing: "nachfaellig" | "vorschuessig" | "unklar";
  billingEvidence: number;
  placeholders: string[];
  hints: string[];
};

/** Herkunft aus dem Umzug (#472): was Haben abgeleitet hat und was vor dem Aktivieren zu prüfen ist */
function SevdeskOrigin({ origin }: { origin: SevdeskOriginData }) {
  const billing =
    origin.billing === "unklar"
      ? "unklar, in sevDesk nachsehen"
      : `${origin.billing === "nachfaellig" ? "nachfällig" : "vorschüssig"}, abgeleitet aus ${origin.billingEvidence} erzeugten ${origin.billingEvidence === 1 ? "Rechnung" : "Rechnungen"}`;
  return (
    <section className="card stack" aria-labelledby="sevdesk-heading">
      <h2 id="sevdesk-heading">Aus sevDesk übernommen</h2>
      <p className="small" style={{ margin: 0 }}>
        Pausiert, bis du sie prüfst und aktivierst. In sevDesk {SEV_STATUS[origin.status] ?? `Status ${origin.status}`}.
      </p>
      <p className="small" style={{ margin: 0 }}>
        Abrechnung: {billing}.
      </p>
      {origin.placeholders.length > 0 && (
        <p className="small" style={{ margin: 0 }}>
          Platzhalter von sevDesk, als Text übernommen: <span className="mono">{origin.placeholders.join(" ")}</span>
        </p>
      )}
      {origin.hints.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
          {origin.hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
