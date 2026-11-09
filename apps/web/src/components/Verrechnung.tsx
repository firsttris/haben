import { formatEuro } from "@haben/core";
import { useState, type FormEvent } from "react";
import { formatDate } from "../lib/format.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/*
 * Gegenläufige Umsätze verrechnen im Bankabgleich (#457): Anzeige der Verrechnung eines Umsatzes mit Aufheben und das
 * Formular, um einen ganz offenen Umsatz mit einem gegenläufigen desselben Kontos zu verrechnen. Gebucht wird nichts.
 */

type Gegenumsatz = { id: string; bookingDate: string; amount: number; counterpartyName: string; purpose: string };
type Eintrag = { id: string; note: string; reversed: boolean; counterpart: Gegenumsatz };
export type VerrechnungDaten = { active: Eintrag | null; reversed: Eintrag[]; candidates: Gegenumsatz[] };

const betrag = (cents: number) => `${cents < 0 ? "−" : "+"}${formatEuro(Math.abs(cents))}`;
const gegenumsatzText = (c: Gegenumsatz) => `${formatDate(c.bookingDate)} · ${betrag(c.amount)} · ${c.counterpartyName || "–"}`;

/** Gültige und aufgehobene Verrechnungen des Umsatzes; die gültige lässt sich nach Rückfrage aufheben */
export function VerrechnungAnzeige({ daten, busy, onReverse }: { daten: VerrechnungDaten; busy: boolean; onReverse: (id: string) => void }) {
  const [aufheben, setAufheben] = useState<Eintrag | null>(null);
  const eintraege = [...(daten.active ? [daten.active] : []), ...daten.reversed];
  if (eintraege.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="section-label">Verrechnet</div>
      {eintraege.map((e) => (
        <div key={e.id} className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ textDecoration: e.reversed ? "line-through" : undefined }}>Mit Umsatz vom {gegenumsatzText(e.counterpart)}</span>
            <span className="small muted" style={{ overflowWrap: "anywhere" }}>
              {e.reversed ? "aufgehoben · " : "ohne Buchung · "}
              {e.note}
            </span>
          </div>
          {!e.reversed && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setAufheben(e)} disabled={busy}>
              Aufheben
            </button>
          )}
        </div>
      ))}
      {aufheben && (
        <ConfirmDialog
          open
          title="Verrechnung aufheben?"
          confirmLabel="Verrechnung aufheben"
          danger
          facts={[
            { label: "Gegenumsatz", value: gegenumsatzText(aufheben.counterpart) },
            { label: "Notiz", value: aufheben.note },
          ]}
          onConfirm={() => onReverse(aufheben.id)}
          onClose={() => setAufheben(null)}
        >
          <p>Haben legt dafür eine Gegenzeile an; gebucht wird nichts. Beide Umsätze sind danach wieder offen, die aufgehobene Verrechnung bleibt sichtbar.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Knopf und Formular: den Umsatz mit einem gegenläufigen verrechnen, mit Pflicht-Notiz */
export function VerrechnenFormular({
  candidates,
  busy,
  onSubmit,
}: {
  candidates: Gegenumsatz[];
  busy: boolean;
  onSubmit: (input: { counterTransactionId: string; note: string }) => void;
}) {
  const [offen, setOffen] = useState(false);
  const [gegenumsatz, setGegenumsatz] = useState(candidates[0]?.id ?? "");
  const [notiz, setNotiz] = useState("");
  if (candidates.length === 0) return null;
  if (!offen) {
    return (
      <button type="button" className="btn" onClick={() => setOffen(true)} disabled={busy}>
        Mit Gegenumsatz verrechnen
      </button>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!gegenumsatz || !notiz.trim()) return;
    onSubmit({ counterTransactionId: gegenumsatz, note: notiz.trim() });
  }

  return (
    <form className="stack" style={{ gap: 10 }} aria-label="Mit Gegenumsatz verrechnen" onSubmit={submit}>
      <div className="section-label">Mit Gegenumsatz verrechnen</div>
      <p className="small muted" style={{ margin: 0 }}>
        Für Umsätze, die sich aufheben, etwa Kartenprüfung und Rückbuchung. Beide gelten danach als erledigt; es entsteht keine Buchung, Voranmeldung und EÜR
        bleiben unverändert.
      </p>
      <label className="field">
        Gegenumsatz
        <select value={gegenumsatz} onChange={(e) => setGegenumsatz(e.target.value)}>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {gegenumsatzText(c)}
              {c.purpose ? ` · ${c.purpose}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Notiz
        <input value={notiz} onChange={(e) => setNotiz(e.target.value)} maxLength={500} required placeholder="PayPal-Autorisierung mit Rückbuchung" />
        <span className="small muted">Steht mit der Verrechnung im Änderungsprotokoll.</span>
      </label>
      <div className="actions">
        <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }} disabled={busy || !notiz.trim()}>
          Verrechnen
        </button>
        <button type="button" className="btn" onClick={() => setOffen(false)} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
