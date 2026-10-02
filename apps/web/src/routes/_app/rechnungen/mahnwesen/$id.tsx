import {
  DEFAULT_INTEREST_MARKUP,
  DUNNING_LEVELS,
  dunningAmounts,
  formatDecimal,
  formatEuro,
  parseEuro,
  type CustomerType,
  type DunningLevel,
} from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage, formatDate } from "../../../../lib/format.ts";
import { createDunningFn, getDunningDraft } from "../../../../server/functions/dunning.ts";

export const Route = createFileRoute("/_app/rechnungen/mahnwesen/$id")({
  loader: ({ params }) => getDunningDraft({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: `Mahnung zu ${loaderData?.invoice.number ?? ""} · Haben` }] }),
  component: NewDunningPage,
});

const percent = (basisPoints: number) =>
  `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(basisPoints / 100)} %`;

function NewDunningPage() {
  const draft = Route.useLoaderData();
  const navigate = useNavigate();
  const create = useServerFn(createDunningFn);
  const [level, setLevel] = useState<DunningLevel>(draft.level);
  const [dueDate, setDueDate] = useState(draft.dueDate);
  const [fee, setFee] = useState(draft.fee ? formatDecimal(draft.fee) : "");
  const [flatFee, setFlatFee] = useState(false);
  const [interest, setInterest] = useState<CustomerType | "">("");
  const [intro, setIntro] = useState(draft.texts[draft.level].intro);
  const [closing, setClosing] = useState(draft.texts[draft.level].closing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedFee = fee.trim() ? parseEuro(fee) : 0;
  const interestRate = interest && draft.baseRate !== null ? draft.baseRate + DEFAULT_INTEREST_MARKUP[interest] : null;
  const amounts = dunningAmounts({
    open: draft.invoice.open,
    dueDate: draft.invoice.dueDate,
    date: draft.date,
    fee: parsedFee ?? 0,
    flatFee,
    interestRate,
  });
  const valid = parsedFee !== null && parsedFee >= 0 && dueDate > draft.date && intro.trim() !== "";

  function chooseLevel(next: DunningLevel) {
    setLevel(next);
    setIntro(draft.texts[next].intro);
    setClosing(draft.texts[next].closing);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    create({ data: { invoiceId: draft.invoice.id, level, dueDate, fee: parsedFee ?? 0, flatFee, interest: interest || null, intro, closing } })
      .then(async (result) => {
        window.open(`/api/mahnung/${result.id}`, "_blank", "noopener");
        await navigate({ to: "/rechnungen/$id", params: { id: draft.invoice.id } });
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen/mahnwesen">Mahnwesen</Link> › Rechnung {draft.invoice.number}
          </div>
          <h1>{DUNNING_LEVELS[level].label}</h1>
        </div>
      </div>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <form className="editor-grid" onSubmit={onSubmit}>
        <section className="card stack" aria-label="Mahnung">
          <p className="small muted" style={{ margin: 0 }}>
            Rechnung {draft.invoice.number} an {draft.invoice.customer} vom {formatDate(draft.invoice.issueDate)}, fällig seit{" "}
            {formatDate(draft.invoice.dueDate)}, offen {formatEuro(draft.invoice.open)}.
          </p>
          <div className="form-grid">
            <label className="field">
              Stufe
              <select value={level} onChange={(e) => chooseLevel(Number(e.target.value) as DunningLevel)}>
                {([1, 2, 3] as const).map((l) => (
                  <option key={l} value={l}>
                    {DUNNING_LEVELS[l].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Neue Zahlungsfrist
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-invalid={dueDate <= draft.date} />
            </label>
            <label className="field">
              Mahngebühr (€)
              <input inputMode="decimal" value={fee} placeholder="0,00" onChange={(e) => setFee(e.target.value)} aria-invalid={parsedFee === null} />
            </label>
            <label className="field">
              Verzugszinsen
              <select value={interest} onChange={(e) => setInterest(e.target.value as CustomerType | "")} disabled={draft.baseRate === null} aria-describedby="interest-hint">
                <option value="">keine</option>
                <option value="geschaeftskunde">Geschäftskunde (Basiszins + 9 Prozentpunkte)</option>
                <option value="verbraucher">Verbraucher (Basiszins + 5 Prozentpunkte)</option>
              </select>
              <span id="interest-hint" className="small">
                {draft.baseRate === null ? (
                  <>
                    Für Zinsen den Basiszinssatz in den <Link to="/einstellungen">Einstellungen</Link> eintragen.
                  </>
                ) : (
                  `Basiszinssatz ${percent(draft.baseRate)}`
                )}
              </span>
            </label>
            <label className="checkbox" style={{ gridColumn: "1 / -1" }}>
              <input type="checkbox" checked={flatFee} onChange={(e) => setFlatFee(e.target.checked)} />
              Verzugspauschale 40 € (nur bei Geschäftskunden, § 288 Abs. 5 BGB)
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Einleitung
              <textarea value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={2000} rows={4} />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Schluss
              <textarea value={closing} onChange={(e) => setClosing(e.target.value)} maxLength={2000} rows={3} />
            </label>
          </div>
        </section>
        <section className="card stack" aria-label="Forderung">
          <h2>Forderung</h2>
          <dl className="paper-totals">
            <dt>Offener Rechnungsbetrag</dt>
            <dd>{formatEuro(amounts.open)}</dd>
            {amounts.fee > 0 && (
              <>
                <dt>Mahngebühr</dt>
                <dd>{formatEuro(amounts.fee)}</dd>
              </>
            )}
            {amounts.flatFee > 0 && (
              <>
                <dt>Verzugspauschale</dt>
                <dd>{formatEuro(amounts.flatFee)}</dd>
              </>
            )}
            {amounts.interest > 0 && (
              <>
                <dt>
                  Zinsen {percent(amounts.interestRate)} für {amounts.interestDays} Tage
                </dt>
                <dd>{formatEuro(amounts.interest)}</dd>
              </>
            )}
            <dt className="strong">Zu zahlen</dt>
            <dd className="strong">{formatEuro(amounts.total)}</dd>
          </dl>
          <p className="small muted" style={{ margin: 0 }}>
            Die Mahnung wird als PDF gespeichert und lässt sich danach nicht mehr ändern. Gebühren und Zinsen sind keine Rechnung: Zahlt der
            Kunde sie, ordnest du den Mehrbetrag im Bankabgleich „Mahngebühren und Verzugszinsen“ zu.
          </p>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
              {DUNNING_LEVELS[level].label} erstellen
            </button>
          </div>
        </section>
      </form>
    </>
  );
}
