import { CASH_BOOKINGS, formatEuro, parseEuro, type CashBooking } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { createCashEntryFn, getCashBook, reverseCashEntryFn } from "../../server/functions/cash.ts";

export const Route = createFileRoute("/_app/kasse")({
  validateSearch: z.object({ jahr: z.number().int().min(2000).max(2100).optional() }),
  loaderDeps: ({ search }) => ({ year: search.jahr ?? new Date().getFullYear() }),
  loader: ({ deps }) => getCashBook({ data: deps.year }),
  head: () => ({ meta: [{ title: "Kasse · Haben" }] }),
  component: CashPage,
});

type Data = Awaited<ReturnType<typeof getCashBook>>;
type Notice = { tone: "ok" | "danger"; text: string } | null;

const KINDS = Object.keys(CASH_BOOKINGS) as CashBooking[];

function CashPage() {
  const data = Route.useLoaderData();
  const { year } = data;
  const [notice, setNotice] = useState<Notice>(null);
  const thisYear = new Date().getFullYear();
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
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Jede Bewegung der Barkasse steht hier mit fortlaufender Nummer. Bar bezahlte <Link to="/belege">Belege</Link> landen beim Buchen
        automatisch im Kassenbuch; Einlagen, Entnahmen und Geld von der Bank oder zur Bank trägst du hier ein. Einträge lassen sich nicht
        ändern, nur stornieren, und der Bestand darf nie negativ werden. Zähle die Kasse regelmäßig und vergleiche mit dem Bestand.
      </p>

      <nav className="filter-row" aria-label="Jahr wählen">
        <div className="chip-row">
          {years.map((y) => (
            <Link key={y} to="/kasse" search={{ jahr: y }} className={y === year ? "chip active" : "chip"} aria-current={y === year ? "page" : undefined}>
              {y}
            </Link>
          ))}
        </div>
      </nav>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="kpi-label">Anfangsbestand {year}</div>
          <div className="kpi-value">{formatEuro(data.opening)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Endbestand {year}</div>
          <div className="kpi-value">{formatEuro(data.closing)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Bestand heute</div>
          <div className="kpi-value">{formatEuro(data.current)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Einträge {year}</div>
          <div className="kpi-value">{data.entries.length}</div>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <CashForm data={data} onNotice={setNotice} />
        {notice && (
          <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
            {notice.text}
          </div>
        )}
        <CashList data={data} onNotice={setNotice} />
      </div>
    </>
  );
}

function CashForm({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const router = useRouter();
  const create = useServerFn(createCashEntryFn);
  const [kind, setKind] = useState<CashBooking>("einlage");
  const [busy, setBusy] = useState(false);
  const defaultDate = `${data.year}-12-31` < data.today ? `${data.year}-12-31` : data.today;

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
      const result = await create({
        data: { kind, date: String(values.get("date")), amount, text: String(values.get("text") ?? "").trim() },
      });
      await router.invalidate();
      form.reset();
      onNotice({ tone: "ok", text: `Nr. ${result.number} gebucht: ${CASH_BOOKINGS[kind].label} über ${formatEuro(amount)}.` });
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
            {CASH_BOOKINGS[k].label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label className="field">
          Datum
          <input type="date" name="date" defaultValue={defaultDate} max={data.today} required />
        </label>
        <label className="field">
          Betrag (€)
          <input name="amount" inputMode="decimal" placeholder="0,00" required />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Text (optional)
          <input name="text" maxLength={300} placeholder={CASH_BOOKINGS[kind].label} />
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {kind === "abhebung" || kind === "einzahlung"
          ? "Gebucht über Geldtransit. Den Umsatz auf dem Bankkonto ordnest du im Bankabgleich als „Geldtransit“ zu."
          : kind === "einlage"
            ? "Privates Geld in die Kasse, z. B. als Wechselgeld oder um eine Barausgabe zu bezahlen."
            : "Geld aus der Kasse für private Zwecke."}
      </p>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Buchen
        </button>
      </div>
    </form>
  );
}

function CashList({ data, onNotice }: { data: Data; onNotice: (n: Notice) => void }) {
  const router = useRouter();
  const reverse = useServerFn(reverseCashEntryFn);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function onReverse(id: string) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
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
      {data.entries.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Keine Einträge in {data.year}.
        </p>
      ) : (
        <div className="table">
          {data.entries.map((e) => (
            <div key={e.id} className="history-row" style={{ alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflowWrap: "anywhere" }}>
                  <span className="mono small muted">Nr. {e.number} · </span>
                  {e.documentId ? (
                    <Link to="/belege/$id" params={{ id: e.documentId }}>
                      {e.text}
                    </Link>
                  ) : (
                    e.text
                  )}
                </div>
                <div className="small muted">
                  {formatDate(e.date)} · {e.kind === "beleg" ? "Beleg" : CASH_BOOKINGS[e.kind].label}
                  {e.reversed && " · storniert"} · Bestand {formatEuro(e.balance)}
                </div>
              </div>
              <div className="actions" style={{ flexShrink: 0, alignItems: "center" }}>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {e.amount > 0 ? "+" : ""}
                  {formatEuro(e.amount)}
                </span>
                {e.kind !== "beleg" && !e.reversesId && !e.reversed && (
                  <button type="button" className="btn btn-sm" onClick={() => void onReverse(e.id)} aria-label={`Nr. ${e.number} stornieren`}>
                    {confirming === e.id ? "Jetzt stornieren" : "Stornieren"}
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
