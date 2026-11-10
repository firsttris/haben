import {
  bareinnahmeText,
  currentYear,
  CASH_BOOKINGS,
  cashBookingLabel,
  cashEntryLabel,
  formatEuro,
  isKapitalgesellschaft,
  kleinunternehmerImMonat,
  parseEuro,
  type BareinnahmeAngabe,
  type CashBooking,
} from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { z } from "zod/mini";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { BareinnahmeFelder, bareinnahmeWahl } from "../../components/BareinnahmeFelder.tsx";
import { CashInvoiceFields } from "../../components/CashInvoiceFields.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import type { Notice } from "../../lib/use-action.ts";
import { createCashEntryFn, createCashIncomeFn, createCashInvoiceEntryFn, getCashBook, reverseCashEntryFn } from "../../server/functions/cash.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";

export const Route = createFileRoute("/_app/kasse")({
  validateSearch: z.object({
    jahr: z.optional(z.int().check(z.minimum(2000), z.maximum(2100))),
    /** Von der Rechnung aus: diese Rechnung bar kassieren */
    rechnung: z.optional(z.string()),
  }),
  loaderDeps: ({ search }) => ({ year: search.jahr ?? currentYear() }),
  loader: ({ deps }) => getCashBook({ data: deps.year }),
  head: () => ({ meta: [{ title: "Kasse · Haben" }] }),
  component: CashPage,
});

type Data = Awaited<ReturnType<typeof getCashBook>>;

const KINDS = Object.keys(CASH_BOOKINGS) as CashBooking[];

/** Kassenbuchung ohne Beleg, Bareinnahme auf eine Rechnung oder ohne Rechnung */
type Mode = CashBooking | "rechnung" | "einnahme";

function CashPage() {
  const data = Route.useLoaderData();
  const { year } = data;
  const [notice, setNotice] = useState<Notice>(null);
  const thisYear = currentYear();
  const years = [...new Set([thisYear, thisYear - 1, thisYear - 2, year])].sort((a, b) => b - a);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Bargeld</div>
          <h1>Kassenbuch {year}</h1>
        </div>
        <div className="actions">
          <a className="btn" href={`/api/kasse/${year}`}>
            CSV herunterladen
          </a>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Bar bezahlte <Link to="/belege">Belege</Link> landen beim Buchen automatisch hier; Bareinnahmen auf <Link to="/rechnungen">Rechnungen</Link> und ohne
        Rechnung, {isKapitalgesellschaft(data.rechtsform) ? "Geld vom und an den Gesellschafter" : "Einlagen, Entnahmen"} und Geld von oder zur Bank trägst du
        ein. Einträge lassen sich nur stornieren, der Bestand darf nie negativ werden.
      </p>

      {years.length > 1 && (
        <nav className="filter-row" aria-label="Jahr wählen" style={{ marginBottom: 0 }}>
          <div className="chip-row">
            {years.map((y) => (
              <Link key={y} to="/kasse" search={{ jahr: y }} className={y === year ? "chip active" : "chip"} aria-current={y === year ? "page" : undefined}>
                {y}
              </Link>
            ))}
          </div>
        </nav>
      )}

      <div className="grid-3">
        <div className="card">
          <div className="kpi-label">Bestand heute</div>
          <div className="kpi-value">{formatEuro(data.current)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Bestand {year}</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>
            {formatEuro(data.opening)} → {formatEuro(data.closing)}
          </div>
          <div className="small muted">Anfang → Ende des Jahres</div>
        </div>
        <div className="card">
          <div className="kpi-label">Einträge {year}</div>
          <div className="kpi-value">{data.entries.length}</div>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <CashForm data={data} onNotice={setNotice} />
        <NoticeBanner notice={notice} />
        <CashList data={data} onNotice={setNotice} />
      </div>
    </>
  );
}

function CashForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const router = useRouter();
  const create = useServerFn(createCashEntryFn);
  const createForInvoice = useServerFn(createCashInvoiceEntryFn);
  const createIncome = useServerFn(createCashIncomeFn);
  const [gewaehlt, setSteuer] = useState<BareinnahmeAngabe | null>(null);
  const { rechnung } = Route.useSearch();
  const [kind, setKind] = useState<Mode>(rechnung ? "rechnung" : "einlage");
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/complexity/useMathMinMax: Datumstexte (JJJJ-MM-TT), Math.min ergäbe NaN
  const defaultDate = `${data.year}-12-31` < data.today ? `${data.year}-12-31` : data.today;
  const [date, setDate] = useState(defaultDate);
  // Stand am Ende des Monats der Bareinnahme, wie ihn der Server prüft; nach dem Ende von § 19 gilt er für Monate davor weiter
  const kleinunternehmer = kleinunternehmerImMonat(data.kleinunternehmer, date || data.today);
  const steuer = bareinnahmeWahl(gewaehlt, kleinunternehmer);
  /** Neu aufbauen nach dem Buchen: Die bar kassierte Rechnung ist danach womöglich nicht mehr offen */
  const [round, setRound] = useState(0);

  async function book(values: FormData, amount: number): Promise<string> {
    const text = String(values.get("text") ?? "").trim();
    if (kind === "einnahme") {
      const result = await createIncome({ data: { date, amount, text, steuer } });
      return `Nr. ${result.number} gebucht: Bareinnahme über ${formatEuro(amount)}, ${bareinnahmeText(steuer)}.`;
    }
    if (kind !== "rechnung") {
      const result = await create({ data: { kind, date, amount, text } });
      return `Nr. ${result.number} gebucht: ${cashBookingLabel(kind, data.rechtsform)} über ${formatEuro(amount)}.`;
    }
    const invoiceId = String(values.get("invoiceId") ?? "");
    const skonto = values.get("skonto") === "on";
    const invoice = data.openInvoices.find((i) => i.id === invoiceId);
    const number = invoice?.number ?? "";
    // Mehr als offen: Rechnung voll, der Rest als weitere Einnahme mit der gewählten Steuer (#455)
    if (invoice && amount > invoice.open) {
      const [behandlung, satz] = String(values.get("extraSteuer") ?? "").split(":");
      const extra = {
        amount: amount - invoice.open,
        steuer: { behandlung: behandlung as BareinnahmeAngabe["behandlung"], steuersatz: Number(satz) },
        text: String(values.get("extraText") ?? "").trim(),
      };
      const result = await createForInvoice({ data: { invoiceId, date, amount: invoice.open, text, extra } });
      return `Nr. ${result.number} gebucht: Bareinnahme Rechnung ${number} über ${formatEuro(invoice.open)}, dazu ${formatEuro(extra.amount)} als weitere Einnahme (${bareinnahmeText(extra.steuer)}).`;
    }
    const result = await createForInvoice({ data: { invoiceId, date, amount, text, skonto } });
    return `Nr. ${result.number} gebucht: Bareinnahme Rechnung ${number} über ${formatEuro(amount)}${skonto ? ", Rest als Skonto ausgebucht" : ""}.`;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const amount = parseEuro(String(values.get("amount") ?? ""));
    if (amount === null || amount <= 0) {
      onNotice({ tone: "danger", text: "Bitte einen positiven Betrag eingeben." });
      return;
    }
    setBusy(true);
    onNotice(null);
    try {
      const text = await book(values, amount);
      await router.invalidate();
      form.reset();
      setRound((r) => r + 1);
      onNotice({ tone: "ok", text });
    } catch (error) {
      onNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-label="Kassenbuchung eintragen">
      <h2 style={{ margin: 0, fontSize: 16 }}>Eintragen</h2>
      <div className="mode-switch" role="group" aria-label="Art">
        {KINDS.map((k) => (
          <button key={k} type="button" className={`chip${kind === k ? " active" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {cashBookingLabel(k, data.rechtsform)}
          </button>
        ))}
        <button type="button" className={`chip${kind === "rechnung" ? " active" : ""}`} aria-pressed={kind === "rechnung"} onClick={() => setKind("rechnung")}>
          Rechnung bar bezahlt
        </button>
        <button type="button" className={`chip${kind === "einnahme" ? " active" : ""}`} aria-pressed={kind === "einnahme"} onClick={() => setKind("einnahme")}>
          Bareinnahme ohne Rechnung
        </button>
      </div>
      <div className="form-grid">
        <label className="field">
          Datum
          <input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} max={data.today} required />
        </label>
        {kind === "rechnung" ? (
          <CashInvoiceFields key={round} invoices={data.openInvoices} preselected={rechnung} date={date} kleinunternehmer={kleinunternehmer} />
        ) : (
          <label className="field">
            Betrag (€)
            <input name="amount" inputMode="decimal" placeholder="0,00" required />
          </label>
        )}
        {kind === "einnahme" && <BareinnahmeFelder kleinunternehmer={kleinunternehmer} value={steuer} onChange={setSteuer} />}
        {/* key: Pflicht oder nicht wechselt mit der Art; ohne Rechnung ist die Notiz der Nachweis */}
        <label key={kind === "einnahme" ? "notiz" : "text"} className="field" style={{ gridColumn: "1 / -1" }}>
          {kind === "einnahme" ? "Notiz" : "Text (optional)"}
          <input
            name="text"
            maxLength={300}
            required={kind === "einnahme"}
            placeholder={
              kind === "einnahme"
                ? "z. B. Weihnachtsmarkt 28.11., Tagessumme"
                : kind === "rechnung"
                  ? "Rechnungsnummer und Kunde"
                  : cashBookingLabel(kind, data.rechtsform)
            }
          />
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {kind === "einnahme"
          ? "Für Verkäufe an Privatkunden ohne Rechnung, auch als Tagessumme. Gebucht am Tag der Bareinnahme: Kasse an Erlöse, die Umsatzsteuer ist im selben Monat fällig, bei Ist- wie bei Soll-Versteuerung."
          : kind === "rechnung"
            ? "Gebucht wie eine Zahlung im Bankabgleich, nur Kasse an Forderungen; bei Ist-Versteuerung wird die Umsatzsteuer mit der Bareinnahme fällig. Ein Rest bleibt offen oder wird als Skonto ausgebucht; gibt der Kunde mehr, etwa Trinkgeld, wird der Teil darüber eine weitere Einnahme."
            : kind === "abhebung" || kind === "einzahlung"
              ? "Gebucht über Geldtransit. Den Umsatz auf dem Bankkonto ordnest du im Bankabgleich als „Geldtransit“ zu."
              : isKapitalgesellschaft(data.rechtsform)
                ? "Gebucht über das Gesellschafter-Verrechnungskonto, z. B. Wechselgeld vom Gesellschafter oder eine Barauszahlung an ihn."
                : kind === "einlage"
                  ? "Privates Geld in die Kasse, z. B. als Wechselgeld oder um eine Barausgabe zu bezahlen."
                  : "Geld aus der Kasse für private Zwecke."}
      </p>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || (kind === "rechnung" && data.openInvoices.length === 0)}>
          Buchen
        </button>
      </div>
    </form>
  );
}

function CashList({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const router = useRouter();
  const reverse = useServerFn(reverseCashEntryFn);
  const [confirming, setConfirming] = useState<(typeof data.entries)[number] | null>(null);

  async function reverseNow(id: string) {
    try {
      const result = await reverse({ data: id });
      await router.invalidate();
      onNotice({ tone: "ok", text: `Storniert mit Nr. ${result.number}.` });
    } catch (error) {
      onNotice({ tone: "danger", text: errorMessage(error) });
    }
  }

  return (
    <section className="card" aria-label="Kassenbuch">
      <ConfirmDialog
        open={confirming !== null}
        title="Eintrag in der Kasse stornieren?"
        facts={
          confirming
            ? [
                { label: "Nummer", value: String(confirming.number) },
                { label: "Text", value: confirming.text },
                { label: "Betrag", value: `${confirming.amount > 0 ? "+" : ""}${formatEuro(confirming.amount)}`, strong: true },
              ]
            : undefined
        }
        confirmLabel="Stornieren"
        danger
        onConfirm={() => confirming && void reverseNow(confirming.id)}
        onClose={() => setConfirming(null)}
      >
        <p>Haben schreibt eine Gegenzeile mit neuer Nummer und heutigem Datum und bucht gegen.</p>
      </ConfirmDialog>
      {data.entries.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Keine Einträge in {data.year}.
        </p>
      ) : (
        <div className="table">
          <div className="table-row head cash-cols">
            <div>Nr.</div>
            <div>Datum</div>
            <div>Text</div>
            <div className="num">Betrag</div>
            <div className="num">Bestand</div>
            <div />
          </div>
          {data.entries.map((e) => (
            <div key={e.id} className="table-row cash-cols">
              <div className="mono small muted">{e.number}</div>
              <div className="small muted">{formatDate(e.date)}</div>
              <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {e.documentId ? (
                  <Link to="/belege/$id" params={{ id: e.documentId }}>
                    {e.text}
                  </Link>
                ) : e.invoiceId ? (
                  <Link to="/rechnungen/$id" params={{ id: e.invoiceId }}>
                    {e.text}
                  </Link>
                ) : (
                  e.text
                )}
                <span className="small muted" style={{ display: "block" }}>
                  {cashEntryLabel(e.kind, data.rechtsform)}
                  {e.invoiceNumber && ` ${e.invoiceNumber}`}
                  {e.taxTreatment && e.taxRate !== null && ` · ${bareinnahmeText({ behandlung: e.taxTreatment, steuersatz: e.taxRate })}`}
                  {e.reversed && " · storniert"}
                </span>
              </div>
              <div className="num" style={{ fontWeight: 600, color: e.amount < 0 ? "var(--ink)" : "var(--accent-ink)" }}>
                {e.amount > 0 ? "+" : ""}
                {formatEuro(e.amount)}
              </div>
              <div className="num muted">{formatEuro(e.balance)}</div>
              <div style={{ justifySelf: "end" }}>
                {e.kind !== "beleg" && e.kind !== "import" && !e.reversesId && !e.reversed && (
                  <button type="button" className="btn btn-sm" onClick={() => setConfirming(e)} aria-label={`Nr. ${e.number} stornieren`}>
                    Stornieren
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
