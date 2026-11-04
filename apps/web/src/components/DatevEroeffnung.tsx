import { formatEuro } from "@haben/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import { useAction } from "../lib/use-action.ts";
import { bookDatevEroeffnungFn, type getManualEntryForm } from "../server/functions/journal.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Data = NonNullable<Awaited<ReturnType<typeof getManualEntryForm>>["datevEroeffnung"]>;

/**
 * Vorschlag für die Eröffnung aus der Schlussbilanz des DATEV-Stapels: die Zeilen zum Prüfen, gebucht erst nach
 * Bestätigung (zweiter Klick). Was nicht passt, steht als Liste darüber, dann gibt es keinen Knopf.
 */
export function DatevEroeffnung({ data }: { data: Data }) {
  const headingId = useId();
  const navigate = useNavigate();
  const book = useServerFn(bookDatevEroeffnungFn);
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const soll = data.zeilen.reduce((s, z) => s + z.debit, 0);
  const haben = data.zeilen.reduce((s, z) => s + z.credit, 0);
  const buchbar = data.issues.length === 0;

  function onBook() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void run(async () => {
      await book({ data: { year: data.year, fingerprint: data.fingerprint } });
      await navigate({ to: "/buchungen", search: { jahr: data.year, monat: 1 } });
    });
  }

  return (
    <section className="card stack" aria-labelledby={headingId}>
      <h2 id={headingId} style={{ margin: 0 }}>
        Eröffnung aus dem DATEV-Stapel {data.schlussjahr}
      </h2>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Haben schlägt die Eröffnung zum 1.1.{data.year} aus der Schlussbilanz {data.schlussjahr} im{" "}
        <Link to="/archiv" search={{ ansicht: "buchungen", jahr: data.schlussjahr }}>
          Archiv
        </Link>{" "}
        vor: alle Bestandskonten mit Saldo gegen 9000 Saldenvorträge, auch Bank, Kasse, Forderungen, Verbindlichkeiten und Umsatzsteuer. Das Ergebnis{" "}
        {data.schlussjahr} steht als Gewinn- oder Verlustvortrag im Eigenkapital. Vergleiche die Zeilen mit der Bilanz der Steuerberatung (Bilanzsumme{" "}
        {formatEuro(data.bilanzsumme)}); gebucht wird erst nach deiner Bestätigung.
      </p>
      {data.issues.length > 0 && (
        <div role="status" aria-label="Eröffnung aus dem Stapel nicht buchbar">
          <ul className="small" style={{ margin: 0 }}>
            {data.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {data.hinweise.map((text) => (
        <p key={text} className="small" style={{ margin: 0 }}>
          {text}
        </p>
      ))}
      {data.zeilen.length > 0 && (
        <table className="report-table">
          <caption className="visually-hidden">Zeilen der Eröffnung zum 1.1.{data.year}</caption>
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
            </tr>
          </thead>
          <tbody>
            {data.zeilen.map((z) => (
              <tr key={z.account}>
                <td className="mono">{z.account}</td>
                <td className="small muted">{z.name}</td>
                <td className="num">{z.debit ? formatEuro(z.debit) : ""}</td>
                <td className="num">{z.credit ? formatEuro(z.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Summe · {data.zeilen.length} Zeilen
              </th>
              <td className="num">{formatEuro(soll)}</td>
              <td className="num">{formatEuro(haben)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {buchbar && (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onBook} disabled={busy}>
            {confirming ? "Jetzt buchen" : "Eröffnung buchen"}
          </button>
          {confirming && (
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
              Abbrechen
            </button>
          )}
        </div>
      )}
      <NoticeBanner notice={notice} />
    </section>
  );
}
