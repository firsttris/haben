import { formatEuro, isKapitalgesellschaft, MANUAL_MAX_LINES, manualPostingIssues, parseEuro, type ManualLine } from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { createManualEntryFn, getManualEntryForm } from "../../../server/functions/journal.ts";

export const Route = createFileRoute("/_app/buchungen/neu")({
  loader: () => getManualEntryForm(),
  head: () => ({ meta: [{ title: "Buchung erfassen · Haben" }] }),
  component: ManualEntryPage,
});

/** Eine Zeile, wie sie im Formular steht: Beträge als Text, bis zum Buchen */
interface Row {
  key: number;
  account: string;
  debit: string;
  credit: string;
}

const emptyRow = (key: number): Row => ({ key, account: "", debit: "", credit: "" });

/** Betrag aus dem Feld; leer = 0, unlesbar = NaN, damit die Prüfung „Betrag ungültig“ meldet */
const amountOf = (text: string) => (text.trim() === "" ? 0 : (parseEuro(text) ?? Number.NaN));

function ManualEntryPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/buchungen">Buchungen</Link> › Manuell
          </div>
          <h1>Buchung erfassen</h1>
        </div>
      </div>
      {isKapitalgesellschaft(data.rechtsform) ? (
        <ManualEntryForm data={data} />
      ) : (
        <p className="muted" style={{ maxWidth: 760 }}>
          Manuelle Buchungen gibt es nur für GmbH und UG. Im Einzelunternehmen rechnet die Anlage EÜR aus Rechnungen, Belegen und Zahlungen; eine Umbuchung im
          Journal käme dort nicht an. Die Rechtsform steht unter <Link to="/einstellungen">Einstellungen › Firma</Link>.
        </p>
      )}
    </>
  );
}

function ManualEntryForm({ data }: { data: Awaited<ReturnType<typeof getManualEntryForm>> }) {
  const navigate = useNavigate();
  const create = useServerFn(createManualEntryFn);
  const { busy, notice, run } = useAction();
  const [date, setDate] = useState(data.today);
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow(1), emptyRow(2)]);
  const [nextKey, setNextKey] = useState(3);

  const lines: ManualLine[] = rows.map((r) => ({ account: r.account.trim(), debit: amountOf(r.debit), credit: amountOf(r.credit) }));
  const issues = manualPostingIssues(lines, data.kontenrahmen, data.rechtsform);
  const sum = (side: "debit" | "credit") => lines.reduce((s, l) => s + (Number.isFinite(l[side]) ? l[side] : 0), 0);
  const difference = sum("debit") - sum("credit");
  const touched = rows.some((r) => r.account || r.debit || r.credit);

  const update = (key: number, patch: Partial<Row>) => setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function addRow() {
    setRows((current) => [...current, emptyRow(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await create({ data: { date, description, lines } });
      await navigate({ to: "/buchungen", search: { jahr: Number(date.slice(0, 4)), monat: Number(date.slice(5, 7)) } });
    });
  }

  return (
    <form className="card stack" onSubmit={onSubmit} aria-label="Manuelle Buchung">
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Soll an Haben auf frei gewählten Konten ({data.kontenrahmen}), ohne Umsatzsteuer, etwa das Stammkapital, ein Gesellschafterdarlehen oder eine falsche
        Kontierung. Bank, Kasse, offene Posten, Umsatzsteuer, Erlöse aus Rechnungen und Anlagen führen ihre eigenen Seiten und lassen sich hier nicht bebuchen.
        Die Buchung ist sofort festgeschrieben; korrigiert wird per Storno.
      </p>
      <div className="form-row cols-2">
        <label className="field">
          Datum
          <input type="date" value={date} max={data.today} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          Buchungstext
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} required minLength={3} />
        </label>
      </div>

      <table className="report-table">
        <caption className="visually-hidden">Buchungszeilen</caption>
        <thead>
          <tr>
            <th scope="col">Konto</th>
            <th scope="col">Bezeichnung</th>
            <th scope="col" className="num">
              Soll
            </th>
            <th scope="col" className="num">
              Haben
            </th>
            <th scope="col">
              <span className="visually-hidden">Entfernen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, index) => (
            <tr key={r.key}>
              <td>
                <input
                  aria-label={`Konto Zeile ${index + 1}`}
                  className="mono"
                  inputMode="numeric"
                  maxLength={4}
                  size={6}
                  value={r.account}
                  onChange={(e) => update(r.key, { account: e.target.value.replace(/\D/g, "") })}
                />
              </td>
              <td className="small muted">{data.accounts[r.account.trim()] ?? ""}</td>
              <td className="num">
                <input
                  aria-label={`Soll Zeile ${index + 1}`}
                  inputMode="decimal"
                  size={10}
                  value={r.debit}
                  onChange={(e) => update(r.key, { debit: e.target.value })}
                />
              </td>
              <td className="num">
                <input
                  aria-label={`Haben Zeile ${index + 1}`}
                  inputMode="decimal"
                  size={10}
                  value={r.credit}
                  onChange={(e) => update(r.key, { credit: e.target.value })}
                />
              </td>
              <td>
                {rows.length > 2 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))}
                    aria-label={`Zeile ${index + 1} entfernen`}
                  >
                    Entfernen
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>
              Summe{difference !== 0 && ` · Differenz ${formatEuro(Math.abs(difference))}`}
            </th>
            <td className="num">{formatEuro(sum("debit"))}</td>
            <td className="num">{formatEuro(sum("credit"))}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="actions">
        <button type="button" className="btn" onClick={addRow} disabled={rows.length >= MANUAL_MAX_LINES}>
          Zeile hinzufügen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || issues.length > 0 || description.trim().length < 3}>
          Buchen
        </button>
      </div>
      {touched && issues.length > 0 && (
        <ul className="small" role="status" aria-label="Noch nicht buchbar" style={{ margin: 0 }}>
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <NoticeBanner notice={notice} />
    </form>
  );
}
