import { formatDecimal, formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { elsterNotice, ELSTER_KIND_LABEL, type ElsterKind } from "../../lib/elster.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { ElsterSubmit, type ElsterSetup } from "../ElsterSubmit.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { saveVatDauerfrist, submitVatDauerfrist, type getVatPeriod } from "../../server/functions/vat.ts";

type Overview = Awaited<ReturnType<typeof getVatPeriod>>["dauerfrist"];

/** Volle Euro für Kz 38: „4000“ oder „4.000,00“; Cent sind nicht erlaubt */
function wholeEuros(value: string): number | null {
  const cents = parseEuro(value);
  return cents !== null && cents >= 0 && cents % 100 === 0 ? cents : null;
}

/**
 * Dauerfristverlängerung eines Jahres (§ 46–48 UStDV): Stand, Antrag über ELSTER (USt 1 H) und bei monatlicher Abgabe die
 * Sondervorauszahlung mit dem Vorschlag aus den Vorauszahlungen des Vorjahres; dazu der Eintrag von Hand, wenn der Antrag
 * außerhalb von Haben gestellt wurde oder die Verlängerung endet.
 */
export function DauerfristCard({ overview, setup }: { overview: Overview; setup: ElsterSetup & { companyIssues: string[] } }) {
  const router = useRouter();
  const submit = useServerFn(submitVatDauerfrist);
  const save = useServerFn(saveVatDauerfrist);
  const action = useAction();
  const manual = useAction();
  const { year, frequency, vorschlag } = overview;
  const monthly = frequency === "monatlich";
  const [amount, setAmount] = useState(formatDecimal(overview.own?.sondervorauszahlung ?? vorschlag?.betrag ?? 0));
  const [berichtigt, setBerichtigt] = useState(overview.sent);
  const [manualActive, setManualActive] = useState(overview.own?.active ?? true);
  const parsed = wholeEuros(amount);

  if (frequency === "keine") {
    return (
      <section className="card" aria-labelledby="dauerfrist-heading">
        <h2 id="dauerfrist-heading">Dauerfristverlängerung {year}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Für {year} ist keine Voranmeldung eingestellt; eine Dauerfristverlängerung braucht es dann nicht.
        </p>
      </section>
    );
  }

  const status = overview.active
    ? `Besteht für ${year}${overview.own?.sondervorauszahlung ? `, Sondervorauszahlung ${formatEuro(overview.own.sondervorauszahlung)}` : ""}. Voranmeldungen sind einen Monat später fällig.`
    : `Nicht eingetragen. Voranmeldungen sind am 10. nach Ablauf des Zeitraums fällig.`;

  const onSubmit = (kind: ElsterKind, pin?: string) =>
    action.run(async () => {
      const result = await submit({ data: { year, kind, pin, sondervorauszahlung: monthly ? parsed : null, berichtigt: monthly && berichtigt } });
      await router.invalidate();
      action.setNotice(
        elsterNotice(kind, result, `${monthly ? "Sondervorauszahlung angemeldet" : "Dauerfristverlängerung beantragt"} und für ${year} eingetragen.`),
      );
    });

  function onManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void manual.run(
      async () => {
        await save({ data: { year, active: manualActive, sondervorauszahlung: manualActive && monthly ? parsed : null } });
        await router.invalidate();
      },
      manualActive ? `Dauerfristverlängerung für ${year} eingetragen.` : `Dauerfristverlängerung ab ${year} beendet.`,
    );
  }

  return (
    <section className="card" aria-labelledby="dauerfrist-heading">
      <h2 id="dauerfrist-heading">Dauerfristverlängerung {year}</h2>
      <p className="small" style={{ margin: 0 }}>
        {status}
      </p>
      {monthly ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Bei monatlicher Abgabe meldest du jedes Jahr bis zum 10. Februar eine Sondervorauszahlung an und zahlst sie (§ 47, 48 UStDV). Abgezogen wird sie in
            der Voranmeldung für Dezember (Kz 39).
          </p>
          <label className="field">
            Sondervorauszahlung (Kz 38, volle Euro)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={parsed === null} aria-describedby="svz-hint" />
            <span id="svz-hint" className={parsed === null ? "field-error" : "small muted"}>
              {parsed === null
                ? "Betrag in vollen Euro, nicht negativ."
                : vorschlag
                  ? `Vorschlag ${formatEuro(vorschlag.betrag)}: ein Elftel von ${formatEuro(vorschlag.vorauszahlungen)} Vorauszahlungen ${year - 1} zuzüglich ${formatEuro(vorschlag.angerechnet)} angerechneter Sondervorauszahlung${vorschlag.months < 12 ? `, hochgerechnet von ${vorschlag.months} Monaten` : ""} (aus ${vorschlag.periods} gesendeten Voranmeldungen).`
                  : "Ohne Vorjahr: ein Elftel der zu erwartenden Vorauszahlungen dieses Jahres (§ 47 Abs. 3 UStDV)."}
            </span>
          </label>
          {overview.sent && (
            <label className="checkbox">
              <input type="checkbox" checked={berichtigt} onChange={(e) => setBerichtigt(e.target.checked)} />
              Berichtigte Anmeldung (Kz 10)
            </label>
          )}
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Bei vierteljährlicher Abgabe beantragst du die Verlängerung einmal, ohne Sondervorauszahlung; sie gilt, bis du sie zurücknimmst oder das Finanzamt sie
          widerruft.
        </p>
      )}
      <ElsterSubmit
        setup={setup}
        className="stack"
        title={monthly ? "Sondervorauszahlung an ELSTER" : "Antrag an ELSTER"}
        ready={setup.companyIssues.length === 0 && (!monthly || parsed !== null)}
        busy={action.busy}
        notice={action.notice}
        confirmText={`Der Antrag geht an das Finanzamt${monthly ? " und meldet die Sondervorauszahlung an; zahle sie bis zum 10. Februar" : ""}. Noch einmal klicken zum Senden.`}
        footer="Antrag auf Dauerfristverlängerung (USt 1 H) über ERiC. Das Übertragungsprotokoll wird als PDF abgelegt."
        onSubmit={onSubmit}
      />
      <form className="stack" onSubmit={onManual} aria-labelledby="dauerfrist-manual-heading">
        <h3 id="dauerfrist-manual-heading">Außerhalb von Haben</h3>
        <label className="checkbox">
          <input type="checkbox" checked={manualActive} onChange={(e) => setManualActive(e.target.checked)} />
          Dauerfristverlängerung besteht für {year}
        </label>
        <div className="actions">
          <button type="submit" className="btn" disabled={manual.busy || (manualActive && monthly && parsed === null)}>
            Stand speichern
          </button>
        </div>
        <NoticeBanner notice={manual.notice} />
      </form>
      {overview.submissions.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }} aria-label={`Verlauf Dauerfristverlängerung ${year}`}>
          {overview.submissions.map((entry) => (
            <li key={entry.id}>
              {ELSTER_KIND_LABEL[entry.kind]} {entry.ok ? "OK" : `Fehler ${entry.code}`} · {formatDateTime(entry.createdAt)}
              {entry.kz38 !== null ? ` · ${formatEuro(entry.kz38)}` : ""}
              {entry.berichtigt ? " · berichtigt" : ""}
              {entry.transferTicket ? ` · Ticket ${entry.transferTicket}` : ""}
              {entry.hasPdf && (
                <>
                  {" · "}
                  <a href={`/api/protokoll/${entry.id}`} target="_blank" rel="noreferrer">
                    Protokoll
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
