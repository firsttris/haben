import { FREQUENCY_START_MONTHS, formatEuro, MONTHS, VAT_FREQUENCIES, VAT_FREQUENCY_LABEL, type VatFrequency } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../../lib/use-action.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { saveVatFrequency, type getVatPeriod } from "../../server/functions/vat.ts";
import { Field } from "../Field.tsx";

type FrequencyOverviewData = Awaited<ReturnType<typeof getVatPeriod>>["frequency"];
type StartMonth = (typeof FREQUENCY_START_MONTHS)[number];

/**
 * Voranmeldungszeitraum eines Jahres (§ 18 Abs. 2 UStG), wie ihn das Finanzamt festgelegt hat, mit dem Vorschlag aus der
 * Steuer des Vorjahres. Ein Wechsel im Jahr geht nur ab einem Quartal.
 */
export function VatFrequencyCard({ frequency: overview }: { frequency: FrequencyOverviewData }) {
  const router = useRouter();
  const save = useServerFn(saveVatFrequency);
  const { busy, notice, run, setNotice } = useAction();
  const [frequency, setFrequency] = useState<VatFrequency>(overview.own.at(-1)?.frequency ?? overview.frequency);
  const [fromMonth, setFromMonth] = useState<StartMonth>(1);
  const { year } = overview;

  const source =
    overview.own.length > 0
      ? overview.own.map((s) => `${s.fromMonth === 1 ? "" : `ab ${MONTHS[s.fromMonth - 1]}: `}${VAT_FREQUENCY_LABEL[s.frequency]}`).join(", ")
      : `${VAT_FREQUENCY_LABEL[overview.frequency]} (ohne eigene Einstellung für ${year}, ${overview.inherited ? "aus dem Vorjahr übernommen" : "wie bisher"})`;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const result = await save({ data: { year, fromMonth, frequency } });
      await router.invalidate();
      const orphaned =
        result.orphanedDrafts.length > 0 ? ` Entwürfe, die nicht mehr dazu passen und sich nicht senden lassen: ${result.orphanedDrafts.join(", ")}.` : "";
      setNotice({ tone: "ok", text: `Voranmeldungszeitraum ${year} gespeichert.${orphaned}` });
    });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="vat-frequency-heading">
      <h2 id="vat-frequency-heading">Voranmeldungszeitraum {year}</h2>
      <p className="small" style={{ margin: 0 }}>
        Eingestellt: {source}
      </p>
      {overview.suggestion ? (
        <p className="small muted" style={{ margin: 0 }}>
          Vorschlag: {VAT_FREQUENCY_LABEL[overview.suggestion.frequency]}. {overview.suggestion.reason}
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          {overview.previousYearTax === null
            ? `Ohne Buchungen im Vorjahr kein Vorschlag; maßgeblich ist die voraussichtliche Steuer ${year}.`
            : `Steuer ${year - 1}: ${formatEuro(overview.previousYearTax)}.`}
        </p>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Festgelegt wird der Zeitraum vom Finanzamt. Gesendete Voranmeldungen bleiben, wie sie sind; einen Wechsel im Jahr trägst du nur ein, wenn das Finanzamt
        ihn festlegt.
      </p>
      <div className="form-grid">
        <Field label="Zeitraum">
          {(control) => (
            <select {...control} value={frequency} onChange={(event) => setFrequency(event.target.value as VatFrequency)}>
              {VAT_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {VAT_FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Gilt ab">
          {(control) => (
            <select {...control} value={fromMonth} onChange={(event) => setFromMonth(Number(event.target.value) as StartMonth)}>
              {FREQUENCY_START_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {MONTHS[m - 1]} {year}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>
          Zeitraum speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
