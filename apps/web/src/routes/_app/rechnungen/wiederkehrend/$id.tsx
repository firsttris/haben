import { formatEuro, type RecurringInterval, type ServicePeriodMode, type TaxTreatment, type UnitLabel } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { RecurringForm } from "../../../../components/RecurringForm.tsx";
import { errorMessage, formatDate, formatDateTime } from "../../../../lib/format.ts";
import { getRecurringDetail, removeRecurring, saveRecurring } from "../../../../server/functions/recurring.ts";

export const Route = createFileRoute("/_app/rechnungen/wiederkehrend/$id")({
  loader: ({ params }) => getRecurringDetail({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.recurring.name ?? "Vorlage"} · Haben` }] }),
  component: RecurringDetailPage,
});

function RecurringDetailPage() {
  const { recurring, invoices, contacts, defaults } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveRecurring);
  const remove = useServerFn(removeRecurring);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  function run(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setNotice(null);
    work()
      .then(() => success && setNotice({ tone: "ok", text: success }))
      .catch((error: unknown) => setNotice({ tone: "danger", text: errorMessage(error) }))
      .finally(() => setBusy(false));
  }

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
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                if (!confirmingDelete) return setConfirmingDelete(true);
                run(async () => {
                  await remove({ data: recurring.id });
                  await navigate({ to: "/rechnungen/wiederkehrend" });
                });
              }}
            >
              {confirmingDelete ? "Endgültig löschen" : "Löschen"}
            </button>
          </div>
        )}
      </div>
      {recurring.lastError && (
        <div className="banner" role="alert">
          {recurring.lastError}
        </div>
      )}
      {notice && (
        <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}
      <div className="editor-grid">
        <RecurringForm
          key={String(recurring.updatedAt)}
          initial={{
            name: recurring.name,
            active: recurring.active,
            contactId: recurring.contactId,
            format: recurring.format,
            paymentTermDays: recurring.paymentTermDays,
            note: recurring.note,
            taxTreatment: recurring.taxTreatment as TaxTreatment,
            exemptionReason: recurring.exemptionReason,
            lines: recurring.lines.map((l) => ({ ...l, unit: l.unit as UnitLabel, taxRate: l.taxRate as 1900 | 700 | 0 })),
            intervalMonths: recurring.intervalMonths as RecurringInterval,
            nextDate: recurring.nextDate,
            endDate: recurring.endDate,
            servicePeriod: recurring.servicePeriod as ServicePeriodMode,
            mode: recurring.mode,
            sendByMail: recurring.sendByMail,
          }}
          contacts={contacts}
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
        <section className="card stack" aria-labelledby="history-heading">
          <h2 id="history-heading">Erzeugte Rechnungen</h2>
          {recurring.lastRunAt && <p className="small muted" style={{ margin: 0 }}>Zuletzt geprüft {formatDateTime(recurring.lastRunAt)}</p>}
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
    </>
  );
}
