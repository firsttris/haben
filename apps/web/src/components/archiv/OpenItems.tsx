import { formatEuro } from "@haben/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { takeOverAllOpenItems, takeOverOpenItem, type getMigration } from "../../server/functions/archive.ts";
import { Icon } from "../Icon.tsx";

type Item = Awaited<ReturnType<typeof getMigration>>["openItems"][number];

export function OpenItems({ items, imported }: { items: Item[]; imported: boolean }) {
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
        await takeOver({ data: { id } });
      } else {
        const results = await takeOverAll();
        setMessages(
          results.map((r) => (r.error ? { tone: "danger", text: `${r.number}: ${r.error}` } : { tone: "ok", text: `${r.number}: übernommen.` })),
        );
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
        <h2 id="open-heading" style={{ margin: 0 }}>Offene Posten übernehmen</h2>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Rechnungen, die deine Kunden noch nicht bezahlt haben, und Eingangsrechnungen, die du noch bezahlen musst, holt Haben als offene Posten
        herüber: mit Original-PDF und Nummer aus Lexoffice, gebucht gegen den Saldenvortrag. Kommt das Geld, ordnest du es wie gewohnt im
        Bankabgleich zu. Die Umsatz- und Vorsteuer aus Lexoffice zählt Haben dabei nicht doppelt.
      </p>
      {!imported ? (
        <p className="small muted" style={{ margin: 0 }}>Erst nach dem Abruf.</p>
      ) : items.length === 0 ? (
        <p className="small" style={{ margin: 0 }}>Keine offenen Rechnungen oder Belege in Lexoffice.</p>
      ) : (
        <div className="table-scroll">
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
                  <td className="num mono">{formatEuro(item.open)}</td>
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
        </div>
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
