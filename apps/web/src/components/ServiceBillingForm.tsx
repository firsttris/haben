import { formatDuration, formatEuro, formatQuantity } from "@haben/core";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { errorMessage } from "../lib/format.ts";
import { billEntries, getBillingPreview, type getServiceEntries } from "../server/functions/leistungen.ts";
import { Field } from "./Field.tsx";

type Customers = Awaited<ReturnType<typeof getServiceEntries>>["customers"];
type Preview = Awaited<ReturnType<typeof getBillingPreview>>;

/** Vorgabe für den Zeitraum: in den ersten Tagen eines Monats der vergangene Monat, sonst der laufende bis heute */
export function defaultBillingPeriod(today: string): { from: string; to: string } {
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  if (day > 10) return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: today };
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  return { from: previous.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** Abrechnen (#417): die offenen, abrechenbaren Einträge eines Kunden und Zeitraums werden ein Rechnungsentwurf */
export function ServiceBillingForm({
  customers,
  today,
  defaultContactId,
  onClose,
}: {
  customers: Customers;
  today: string;
  defaultContactId?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const preview = useServerFn(getBillingPreview);
  const bill = useServerFn(billEntries);
  const [contactId, setContactId] = useState(defaultContactId ?? "");
  const [period, setPeriod] = useState(() => defaultBillingPeriod(today));
  const [result, setResult] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = contactId !== "" && period.from !== "" && period.to !== "" && period.from <= period.to;

  useEffect(() => {
    if (!valid) {
      setResult(null);
      return;
    }
    let current = true;
    preview({ data: { contactId, from: period.from, to: period.to } })
      .then((p) => {
        if (current) {
          setResult(p);
          setError(null);
        }
      })
      .catch((e) => current && setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [valid, contactId, period.from, period.to, preview]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { invoiceId } = await bill({ data: { contactId, from: period.from, to: period.to } });
      await navigate({ to: "/rechnungen/$id", params: { id: invoiceId } });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const empty = result !== null && result.entries === 0;
  const missing = result !== null && result.withoutRate > 0;
  return (
    <form className="card stack" aria-label="Leistungen abrechnen" onSubmit={onSubmit}>
      <h2 style={{ margin: 0 }}>Leistungen abrechnen</h2>
      <p className="muted small" style={{ margin: 0, maxWidth: 680 }}>
        Aus den offenen, abrechenbaren Einträgen eines Kunden wird ein Rechnungsentwurf: eine Position je Stundensatz, der Leistungszeitraum vom ersten bis zum
        letzten Arbeitstag. Gebucht wird erst, wenn du die Rechnung festschreibst.
      </p>
      <div className="form-row cols-3">
        <Field label="Kunde">
          {(control) => (
            <select {...control} value={contactId} onChange={(e) => setContactId(e.target.value)} required autoFocus>
              <option value="" disabled>
                Kunde wählen
              </option>
              {customers
                .filter((c) => !c.inactive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label="Von">
          {(control) => <input {...control} type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} required />}
        </Field>
        <Field label="Bis">
          {(control) => <input {...control} type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} required />}
        </Field>
      </div>
      {result && !empty && (
        <div className="stack" style={{ gap: 6 }} aria-live="polite">
          <div>
            {result.entries} {result.entries === 1 ? "Eintrag" : "Einträge"}, {formatDuration(result.minutes)} Std., zusammen {formatEuro(result.net)} netto
          </div>
          {result.lines.map((line) => (
            <div key={line.rateCents} className="small muted">
              Position: {formatQuantity(line.quantity)} Std. zu {formatEuro(line.rateCents)}
              {line.projects.length > 0 && ` · ${line.projects.join(", ")}`}
            </div>
          ))}
        </div>
      )}
      {empty && !missing && (
        <p className="muted" style={{ margin: 0 }} aria-live="polite">
          Im Zeitraum gibt es keine offenen, abrechenbaren Einträge dieses Kunden.
        </p>
      )}
      {missing && (
        <div className="banner banner-danger" role="alert">
          Bei {result.withoutRate} {result.withoutRate === 1 ? "Eintrag fehlt" : "Einträgen fehlt"} der Stundensatz. Trage ihn am Eintrag oder im Kontakt ein,
          dann lässt sich abrechnen.
        </div>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !valid || result === null || empty || missing}>
          Rechnungsentwurf anlegen
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
