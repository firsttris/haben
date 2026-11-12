import { billableAmount, billableMinutes, formatDuration, formatEuro, germanDay } from "@haben/core";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Field } from "../../components/Field.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { ServiceEntryForm, type ServiceEntryRow } from "../../components/ServiceEntryForm.tsx";
import { errorMessage, formatDate } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { getServiceEntries, removeServiceEntry } from "../../server/functions/leistungen.ts";

const searchSchema = z.object({ kunde: z.uuid().optional(), von: z.iso.date().optional(), bis: z.iso.date().optional() });

export const Route = createFileRoute("/_app/leistungen")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ kunde: search.kunde, von: search.von, bis: search.bis }),
  loader: ({ deps }) => getServiceEntries({ data: { contactId: deps.kunde, from: deps.von, to: deps.bis } }),
  head: () => ({ meta: [{ title: "Leistungen · Haben" }] }),
  component: ServiceEntriesPage,
});

function ServiceEntriesPage() {
  const { entries, customers } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const remove = useServerFn(removeServiceEntry);
  const [editing, setEditing] = useState<ServiceEntryRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<ServiceEntryRow | null>(null);
  const names = new Map(customers.map((c) => [c.id, c.name]));
  const formOpen = creating || editing !== null;
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const totalBillable = entries.reduce((sum, e) => sum + billableMinutes(e), 0);
  const totalCents = entries.reduce((sum, e) => sum + billableAmount(e), 0);
  const withoutRate = entries.filter((e) => e.hourlyRateCents === null && !e.nonBillable).length;

  async function onDelete(entry: ServiceEntryRow) {
    try {
      await remove({ data: { id: entry.id } });
      await router.invalidate();
      setNotice({ tone: "ok", text: "Eintrag gelöscht." });
    } catch (e) {
      setNotice({ tone: "danger", text: errorMessage(e) });
    }
  }

  const filter = (patch: Partial<z.infer<typeof searchSchema>>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Verkauf</div>
          <h1>Leistungen</h1>
        </div>
        {!formOpen && (
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setCreating(true);
                setNotice(null);
              }}
            >
              Neuer Eintrag
            </button>
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Zeiteinträge je Kunde, von Hand oder aus einem Zeiterfassungsprogramm wie Kimai über die REST-API. Jeder Eintrag behält den Stundensatz vom Anlegen.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {formOpen && (
          <ServiceEntryForm
            key={editing?.id ?? "neu"}
            entry={editing}
            customers={customers}
            today={germanDay(new Date())}
            defaultContactId={search.kunde}
            onDone={(n) => {
              setEditing(null);
              setCreating(false);
              setNotice(n);
            }}
          />
        )}
        <NoticeBanner notice={notice} />
        <ConfirmDialog
          open={confirm !== null}
          title="Eintrag löschen?"
          facts={
            confirm
              ? [
                  { label: "Tag", value: formatDate(confirm.workedOn) },
                  { label: "Kunde", value: names.get(confirm.contactId) ?? "Kunde" },
                  { label: "Dauer", value: `${formatDuration(confirm.minutes)} Std.`, strong: true },
                ]
              : undefined
          }
          confirmLabel="Löschen"
          danger
          onConfirm={() => confirm && onDelete(confirm)}
          onClose={() => setConfirm(null)}
        >
          <p>Der Eintrag wird gelöscht. Das steht im Änderungsprotokoll.</p>
        </ConfirmDialog>
        <section className="card" aria-label="Leistungsliste">
          <div className="form-row cols-3" role="group" aria-label="Filter">
            <Field label="Kunde">
              {(control) => (
                <select {...control} value={search.kunde ?? ""} onChange={(e) => filter({ kunde: e.target.value || undefined })}>
                  <option value="">Alle Kunden</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Von">
              {(control) => <input {...control} type="date" value={search.von ?? ""} onChange={(e) => filter({ von: e.target.value || undefined })} />}
            </Field>
            <Field label="Bis">
              {(control) => <input {...control} type="date" value={search.bis ?? ""} onChange={(e) => filter({ bis: e.target.value || undefined })} />}
            </Field>
          </div>
          {entries.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {search.kunde || search.von || search.bis ? "Keine Einträge für diesen Filter." : "Noch keine Einträge. Lege den ersten mit „Neuer Eintrag“ an."}
            </p>
          ) : (
            <>
              <div className="table">
                <div className="table-row head service-cols">
                  <div>Tag</div>
                  <div>Kunde und Tätigkeit</div>
                  <div className="num">Dauer</div>
                  <div className="num">Satz</div>
                  <div className="num">Betrag</div>
                  <div />
                </div>
                {entries.map((e) => (
                  <div key={e.id} className="table-row service-cols">
                    <div>{formatDate(e.workedOn)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, overflowWrap: "anywhere" }}>{names.get(e.contactId) ?? "Kunde"}</div>
                      {e.description && (
                        <div className="small muted" style={{ overflowWrap: "anywhere" }}>
                          {e.description}
                        </div>
                      )}
                      {(e.project || e.nonBillable) && (
                        <div className="small muted">
                          {e.project}
                          {e.project && e.nonBillable ? " · " : ""}
                          {e.nonBillable && "nicht abrechenbar"}
                        </div>
                      )}
                      {e.source && <div className="small muted">aus {e.source}</div>}
                    </div>
                    <div className="num">
                      {formatDuration(e.minutes)} Std.
                      {!e.nonBillable && e.billableMinutes !== null && <div className="small muted">abrechenbar {formatDuration(e.billableMinutes)}</div>}
                    </div>
                    <div className="num">{e.hourlyRateCents === null ? <span className="muted">fehlt</span> : formatEuro(e.hourlyRateCents)}</div>
                    <div className="num">{e.hourlyRateCents === null || e.nonBillable ? "" : formatEuro(billableAmount(e))}</div>
                    <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={`Eintrag vom ${formatDate(e.workedOn)} bearbeiten`}
                        onClick={() => {
                          setCreating(false);
                          setEditing(e);
                        }}
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        aria-label={`Eintrag vom ${formatDate(e.workedOn)} löschen`}
                        onClick={() => setConfirm(e)}
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {entries.length} {entries.length === 1 ? "Eintrag" : "Einträge"}, {formatDuration(totalMinutes)} Std., davon abrechenbar{" "}
                {formatDuration(totalBillable)} Std. mit {formatEuro(totalCents)}
                {withoutRate > 0 && ` (${withoutRate} ohne Stundensatz nicht gerechnet)`}.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
