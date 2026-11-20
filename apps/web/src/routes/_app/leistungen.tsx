import { billableAmount, billableMinutes, formatDuration, formatEuro, germanDay } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Field } from "../../components/Field.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { ServiceBillingForm } from "../../components/ServiceBillingForm.tsx";
import { ServiceEntryForm, type ServiceEntryRow } from "../../components/ServiceEntryForm.tsx";
import { errorMessage, formatDate } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { serviceEntryNote } from "../../lib/zeiteintrag.ts";
import { getServiceEntries, removeServiceEntry } from "../../server/functions/leistungen.ts";

const searchSchema = z.object({
  kunde: z.uuid().optional(),
  von: z.iso.date().optional(),
  bis: z.iso.date().optional(),
  stand: z.enum(["offen", "abgerechnet", "nicht-abrechenbar"]).optional(),
});

type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_app/leistungen")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ kunde: search.kunde, von: search.von, bis: search.bis, stand: search.stand }),
  loader: ({ deps }) => getServiceEntries({ data: { contactId: deps.kunde, from: deps.von, to: deps.bis, status: deps.stand } }),
  head: () => ({ meta: [{ title: "Zeiteinträge · Haben" }] }),
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
  const [billing, setBilling] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<ServiceEntryRow | null>(null);
  const names = new Map(customers.map((c) => [c.id, c.name]));
  const formOpen = creating || editing !== null || billing;

  async function onDelete(entry: ServiceEntryRow) {
    try {
      await remove({ data: { id: entry.id } });
      await router.invalidate();
      setNotice({ tone: "ok", text: "Eintrag gelöscht." });
    } catch (e) {
      setNotice({ tone: "danger", text: errorMessage(e) });
    }
  }

  const filter = (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Verkauf</div>
          <h1>Zeiteinträge</h1>
        </div>
        {!formOpen && (
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditing(null);
                setCreating(false);
                setBilling(true);
                setNotice(null);
              }}
            >
              Abrechnen
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setBilling(false);
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
        {billing && (
          <ServiceBillingForm customers={customers} today={germanDay(new Date())} defaultContactId={search.kunde} onClose={() => setBilling(false)} />
        )}
        {(creating || editing !== null) && (
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
        <EintragLoeschen entry={confirm} names={names} loeschen={onDelete} schliessen={() => setConfirm(null)} />
        <section className="card" aria-label="Leistungsliste">
          <LeistungsFilter search={search} customers={customers} filter={filter} />
          {entries.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {search.kunde || search.von || search.bis || search.stand
                ? "Keine Einträge für diesen Filter."
                : "Noch keine Einträge. Lege den ersten mit „Neuer Eintrag“ an."}
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
                  <LeistungsZeile
                    key={e.id}
                    e={e}
                    kunde={names.get(e.contactId) ?? "Kunde"}
                    bearbeiten={() => {
                      setCreating(false);
                      setEditing(e);
                    }}
                    loeschen={() => setConfirm(e)}
                  />
                ))}
              </div>
              <LeistungsSumme entries={entries} />
            </>
          )}
        </section>
      </div>
    </>
  );
}

type Customers = Awaited<ReturnType<typeof getServiceEntries>>["customers"];

/** Filter der Liste nach Kunde, Stand und Zeitraum; sie stehen in der Adresse */
function LeistungsFilter({ search, customers, filter }: { search: Search; customers: Customers; filter: (patch: Partial<Search>) => void }) {
  return (
    <div className="form-row cols-4" role="group" aria-label="Filter">
      <Field label="Kunde">
        {(control) => (
          <select {...control} value={search.kunde ?? ""} onChange={(e) => filter({ kunde: e.target.value || undefined })}>
            <option value="">Alle Kunden</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.inactive ? `${c.name} (inaktiv)` : c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Stand">
        {(control) => (
          <select {...control} value={search.stand ?? ""} onChange={(e) => filter({ stand: (e.target.value || undefined) as typeof search.stand })}>
            <option value="">Alle</option>
            <option value="offen">Offen</option>
            <option value="abgerechnet">Abgerechnet</option>
            <option value="nicht-abrechenbar">Nicht abrechenbar</option>
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
  );
}

/** Ein Zeiteintrag; auf einer Rechnung lässt er sich weder bearbeiten noch löschen */
function LeistungsZeile({ e, kunde, bearbeiten, loeschen }: { e: ServiceEntryRow; kunde: string; bearbeiten: () => void; loeschen: () => void }) {
  return (
    <div className="table-row service-cols">
      <div>{formatDate(e.workedOn)}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflowWrap: "anywhere" }}>
          <span style={{ fontWeight: 500 }}>{kunde}</span>
          {e.description && <span className="muted"> · {e.description}</span>}
        </div>
        {serviceEntryNote(e) && (
          <div className="small muted" style={{ overflowWrap: "anywhere" }}>
            {serviceEntryNote(e)}
          </div>
        )}
        {e.invoiceId && (
          <div className="small">
            <Link to="/rechnungen/$id" params={{ id: e.invoiceId }}>
              {e.invoiceNumber ? `Rechnung ${e.invoiceNumber}` : "Rechnungsentwurf"}
            </Link>
          </div>
        )}
      </div>
      <div className="num">
        {formatDuration(e.minutes)} Std.
        {!e.nonBillable && e.billableMinutes !== null && (
          <div className="small muted">
            <abbr title="abrechenbar">abr.</abbr> {formatDuration(e.billableMinutes)}
          </div>
        )}
      </div>
      <div className="num">{e.hourlyRateCents === null ? <span className="muted">fehlt</span> : formatEuro(e.hourlyRateCents)}</div>
      <div className="num">{e.hourlyRateCents === null || e.nonBillable ? "" : formatEuro(billableAmount(e))}</div>
      <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={e.invoiceId !== null}
          title={e.invoiceId ? "Auf einer Rechnung: erst den Entwurf löschen oder die Rechnung stornieren" : undefined}
          aria-label={`Eintrag vom ${formatDate(e.workedOn)} bearbeiten`}
          onClick={bearbeiten}
        >
          Bearbeiten
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={e.invoiceId !== null}
          title={e.invoiceId ? "Auf einer Rechnung: erst den Entwurf löschen oder die Rechnung stornieren" : undefined}
          aria-label={`Eintrag vom ${formatDate(e.workedOn)} löschen`}
          onClick={loeschen}
        >
          Löschen
        </button>
      </div>
    </div>
  );
}

/** Rückfrage vor dem Löschen eines Eintrags, mit Tag, Kunde und Dauer */
function EintragLoeschen({
  entry,
  names,
  loeschen,
  schliessen,
}: {
  entry: ServiceEntryRow | null;
  names: Map<string, string>;
  loeschen: (entry: ServiceEntryRow) => void;
  schliessen: () => void;
}) {
  return (
    <ConfirmDialog
      open={entry !== null}
      title="Eintrag löschen?"
      facts={
        entry
          ? [
              { label: "Tag", value: formatDate(entry.workedOn) },
              { label: "Kunde", value: names.get(entry.contactId) ?? "Kunde" },
              { label: "Dauer", value: `${formatDuration(entry.minutes)} Std.`, strong: true },
            ]
          : undefined
      }
      confirmLabel="Löschen"
      danger
      onConfirm={() => entry && loeschen(entry)}
      onClose={schliessen}
    >
      <p>Der Eintrag wird gelöscht. Das steht im Änderungsprotokoll.</p>
    </ConfirmDialog>
  );
}

/** Summe der gezeigten Einträge: Dauer, davon abrechenbar und Betrag; Einträge ohne Stundensatz zählen beim Betrag nicht */
function LeistungsSumme({ entries }: { entries: ServiceEntryRow[] }) {
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const totalBillable = entries.reduce((sum, e) => sum + billableMinutes(e), 0);
  const totalCents = entries.reduce((sum, e) => sum + billableAmount(e), 0);
  const withoutRate = entries.filter((e) => e.hourlyRateCents === null && !e.nonBillable).length;
  return (
    <p className="muted small" style={{ margin: 0 }}>
      {entries.length} {entries.length === 1 ? "Eintrag" : "Einträge"}, {formatDuration(totalMinutes)} Std., davon abrechenbar {formatDuration(totalBillable)}{" "}
      Std. mit {formatEuro(totalCents)}
      {withoutRate > 0 && ` (${withoutRate} ohne Stundensatz nicht gerechnet)`}.
    </p>
  );
}
