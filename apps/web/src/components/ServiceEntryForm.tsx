import { billableAmount, formatDecimal, formatDuration, parseDuration, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../lib/format.ts";
import type { Notice } from "../lib/use-action.ts";
import { saveServiceEntry, type getServiceEntries } from "../server/functions/leistungen.ts";
import { Field } from "./Field.tsx";

type Data = Awaited<ReturnType<typeof getServiceEntries>>;
export type ServiceEntryRow = Data["entries"][number];

/** Eintrag anlegen oder ändern (#417): Kunde, Arbeitstag, Dauer, Tätigkeit und, wenn er vom Satz des Kunden abweicht, ein eigener Stundensatz */
export function ServiceEntryForm({
  entry,
  customers,
  today,
  defaultContactId,
  onDone,
}: {
  entry: ServiceEntryRow | null;
  customers: Data["customers"];
  today: string;
  defaultContactId?: string;
  onDone: (notice: Notice) => void;
}) {
  const router = useRouter();
  const save = useServerFn(saveServiceEntry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactId, setContactId] = useState(entry?.contactId ?? defaultContactId ?? "");
  const customerRate = customers.find((c) => c.id === contactId)?.hourlyRateCents ?? null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const minutes = parseDuration(text("duration"));
    if (minutes === null) return setError("Die Dauer ist nicht lesbar. Schreibe sie als 1:30, 1,5 oder 90 min (höchstens 24 Stunden).");
    const billableText = text("billable");
    const billable = billableText === "" ? null : parseDuration(billableText);
    if (billableText !== "" && billable === null) return setError("Die abrechenbare Dauer ist nicht lesbar. Schreibe sie als 1:30, 1,5 oder 90 min.");
    const rate = text("rate") === "" ? undefined : parseEuro(text("rate"));
    if (rate === null || (rate !== undefined && rate < 0)) return setError("Der Stundensatz ist kein gültiger Betrag.");
    setBusy(true);
    setError(null);
    try {
      await save({
        data: {
          id: entry?.id,
          entry: {
            contactId,
            workedOn: text("workedOn"),
            minutes,
            description: text("description"),
            hourlyRateCents: rate,
            nonBillable: form.get("nonBillable") === "on",
            billableMinutes: billable,
            project: text("project"),
          },
        },
      });
      await router.invalidate();
      onDone({ tone: "ok", text: entry ? "Eintrag gespeichert." : "Eintrag angelegt." });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" aria-label={entry ? "Eintrag ändern" : "Neuer Eintrag"} onSubmit={onSubmit}>
      <h2 style={{ margin: 0 }}>{entry ? "Eintrag ändern" : "Neuer Eintrag"}</h2>
      <div className="form-row cols-2">
        <Field label="Kunde">
          {(control) => (
            <select {...control} name="contactId" value={contactId} onChange={(e) => setContactId(e.target.value)} required autoFocus>
              <option value="" disabled>
                Kunde wählen
              </option>
              {customers
                .filter((c) => !c.inactive || c.id === entry?.contactId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label="Arbeitstag">{(control) => <input {...control} name="workedOn" type="date" defaultValue={entry?.workedOn ?? today} required />}</Field>
        <Field label="Dauer" hint="Stunden:Minuten (1:30), Stunden dezimal (1,5) oder Minuten (90 min).">
          {(control) => <input {...control} name="duration" defaultValue={entry ? formatDuration(entry.minutes) : ""} placeholder="1:30" required />}
        </Field>
        <Field
          label="Stundensatz (€, optional)"
          hint={
            entry
              ? "Leer: bleibt, wie er ist."
              : customerRate === null
                ? "Der Kunde hat keinen Stundensatz; ohne Angabe bleibt der Eintrag ohne Satz."
                : `Leer: ${formatDecimal(customerRate)} € vom Kunden.`
          }
        >
          {(control) => (
            <input
              {...control}
              name="rate"
              inputMode="decimal"
              defaultValue={entry?.hourlyRateCents == null ? "" : formatDecimal(entry.hourlyRateCents)}
              placeholder="95,00"
            />
          )}
        </Field>
        <Field label="Abrechenbare Dauer (optional)" hint="Leer: wie erfasst. Eine andere Dauer, wenn du nur einen Teil berechnest.">
          {(control) => (
            <input {...control} name="billable" defaultValue={entry?.billableMinutes == null ? "" : formatDuration(entry.billableMinutes)} placeholder="1:00" />
          )}
        </Field>
        <Field label="Projekt (optional)" hint="Freier Text, zum Gruppieren und Filtern.">
          {(control) => <input {...control} name="project" defaultValue={entry?.project ?? ""} maxLength={200} />}
        </Field>
        <Field label="Tätigkeit (optional)" hint="Steht später auf der Rechnung." style={{ gridColumn: "1 / -1" }}>
          {(control) => <input {...control} name="description" defaultValue={entry?.description ?? ""} maxLength={2000} />}
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" name="nonBillable" defaultChecked={entry?.nonBillable ?? false} />
        Nicht abrechenbar (erfasst, kommt aber nie in einen Rechnungsentwurf)
      </label>
      {entry && entry.hourlyRateCents !== null && (
        <p className="muted small" style={{ margin: 0 }}>
          Bisher abrechenbar: {formatDecimal(billableAmount(entry))} €.
        </p>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={() => onDone(null)}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {entry ? "Speichern" : "Anlegen"}
        </button>
      </div>
    </form>
  );
}
