import { formatEuro } from "@haben/core";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { takeOverAllOpenItems, takeOverOpenItem, type getMigration } from "../../server/functions/archive.ts";
import { Icon } from "../Icon.tsx";
import { ScrollBox } from "../ScrollTable.tsx";

type MigrationData = Awaited<ReturnType<typeof getMigration>>;
type Item = MigrationData["openItems"][number];
type Cutoff = MigrationData["cutoff"];

export function OpenItems({ items, cutoff, cutoffError, imported }: { items: Item[]; cutoff: Cutoff; cutoffError: string | null; imported: boolean }) {
  const router = useRouter();
  const takeOver = useServerFn(takeOverOpenItem);
  const takeOverAll = useServerFn(takeOverAllOpenItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ tone: "ok" | "danger"; text: string }[]>([]);
  const pending = items.filter((i) => !i.takenOver && !i.blocker);
  const done = imported && items.length > 0 && items.every((i) => i.takenOver || i.blocker);

  async function run(id: string | null) {
    setBusy(id ?? "alle");
    setMessages([]);
    try {
      if (id) {
        await takeOver({ data: { id, stichtag: cutoff.date } });
      } else {
        const results = await takeOverAll({ data: { stichtag: cutoff.date } });
        setMessages(results.map((r) => (r.error ? { tone: "danger", text: `${r.number}: ${r.error}` } : { tone: "ok", text: `${r.number}: übernommen.` })));
      }
      await router.invalidate();
    } catch (e) {
      setMessages([{ tone: "danger", text: errorMessage(e) }]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`card stack${done ? " step-done" : ""}`} aria-labelledby="open-heading">
      <div className="step-head">
        <span className="step-num">{done ? <Icon name="check" /> : "3"}</span>
        <h2 id="open-heading" style={{ margin: 0 }}>
          Offene Posten übernehmen
        </h2>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Rechnungen, die deine Kunden noch nicht bezahlt haben, und Eingangsrechnungen, die du noch bezahlen musst, holt Haben als offene Posten herüber: mit
        Original-PDF und bisheriger Nummer, gebucht gegen den Saldenvortrag. Kommt das Geld, ordnest du es wie gewohnt im Bankabgleich zu. Die schon angemeldete
        Umsatz- und Vorsteuer zählt Haben dabei nicht doppelt.
      </p>
      {imported && <CutoffForm key={cutoff.date} cutoff={cutoff} error={cutoffError} disabled={busy !== null} />}
      {!imported ? (
        <p className="small muted" style={{ margin: 0 }}>
          Erst nach dem Abruf.
        </p>
      ) : items.length === 0 ? (
        <p className="small" style={{ margin: 0 }}>
          Keine offenen Rechnungen oder Belege in der bisherigen Buchhaltung.
        </p>
      ) : (
        <ScrollBox label="Offene Posten">
          <table className="data-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Nummer</th>
                <th>Kontakt</th>
                <th className="num">Offen</th>
                <th>
                  <span className="visually-hidden">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.date)}</td>
                  <td className="mono">{item.number || "–"}</td>
                  <td>
                    {item.contactName}
                    <div className="small muted">
                      {item.direction === "einnahme" ? "Forderung" : "Verbindlichkeit"}
                      {item.dueDate ? `, fällig ${formatDate(item.dueDate)}` : ""}
                    </div>
                  </td>
                  <td className="num mono">
                    {item.openKnown ? formatEuro(item.open) : "Unklar"}
                    {item.paidAfter > 0 && <div className="small muted">danach bezahlt {formatEuro(item.paidAfter)}</div>}
                  </td>
                  <td>
                    {item.takenOver ? (
                      item.takenOver.kind === "invoice" ? (
                        <Link to="/rechnungen/$id" params={{ id: item.takenOver.id }}>
                          übernommen
                        </Link>
                      ) : (
                        <Link to="/belege/$id" params={{ id: item.takenOver.id }}>
                          übernommen
                        </Link>
                      )
                    ) : item.blocker ? (
                      <span className="small muted">{item.blocker}</span>
                    ) : (
                      <button type="button" className="btn" onClick={() => run(item.id)} disabled={busy !== null}>
                        Übernehmen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      )}
      {messages.length > 0 && (
        <ul className="upload-messages" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
      {pending.length > 1 && (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => run(null)} disabled={busy !== null}>
            {busy === "alle" ? "Übernehme …" : `Alle ${pending.length} übernehmen`}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Stichtag der Übernahme: der letzte Tag der alten Buchhaltung. Offen ist, was an diesem Tag offen war; gebucht wird am
 * Tag danach. Legt eine Eröffnung, die erste Übernahme oder der DATEV-Stapel ihn fest, steht nur der Grund da.
 */
function CutoffForm({ cutoff, error, disabled }: { cutoff: Cutoff; error: string | null; disabled: boolean }) {
  const navigate = useNavigate();
  const [value, setValue] = useState(cutoff.date);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void navigate({ to: "/archiv", search: (prev) => ({ ...prev, stichtag: value }) });
  }

  const summary = `Stichtag ${formatDate(cutoff.date)}: Offen ist, was an diesem Tag offen war, auch wenn es danach bezahlt wurde. Gebucht wird zum ${formatDate(cutoff.bookingDate)}, dem ersten Tag in Haben.`;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="small" style={{ margin: 0 }} id="cutoff-summary">
        {summary} {cutoff.fixed}
      </p>
      {!cutoff.fixed && (
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label className="field">
            Stichtag (letzter Tag der alten Buchhaltung)
            <input type="date" value={value} onChange={(e) => setValue(e.target.value)} required aria-describedby="cutoff-summary" disabled={disabled} />
          </label>
          <button type="submit" className="btn" disabled={disabled || value === cutoff.date}>
            Stichtag ändern
          </button>
        </form>
      )}
      {error && (
        <p className="banner banner-danger" role="alert" style={{ margin: 0 }}>
          {error} {cutoff.fixed ? "Es gilt der feste Stichtag." : "Es gilt der Vorschlag."}
        </p>
      )}
    </div>
  );
}
