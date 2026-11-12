import { formatEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { getDocumentSettlements, reverseSettlementFn, settleDocumentsFn } from "../server/functions/documents.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Daten = Awaited<ReturnType<typeof getDocumentSettlements>>;

/** Datum als Text; Belegdaten sind optional, ein leerer Wert bleibt leer statt „Invalid Date“ */
const tag = (wert: string | null | undefined) => (wert ? formatDate(wert) : "ohne Datum");

/**
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274): eine Gutschrift des Lieferanten gleicht eine
 * oder mehrere Rechnungen aus. Beide Belege bleiben erhalten, es entsteht kein Bankumsatz. Der Betrag
 * darf den offenen Rest keiner der beiden Seiten überschreiten; bei Teilverrechnung bleibt der Rest offen.
 */
export function BelegVerrechnung({ documentId, supplier, readOnly }: { documentId: string; supplier: string | null; readOnly: boolean }) {
  const laden = useServerFn(getDocumentSettlements);
  const verrechnen = useServerFn(settleDocumentsFn);
  const aufheben = useServerFn(reverseSettlementFn);
  const [daten, setDaten] = useState<Daten | null>(null);
  const [offen, setOffen] = useState(false);
  const [counterId, setCounterId] = useState("");
  const [betrag, setBetrag] = useState("");
  const [grund, setGrund] = useState("");
  const [datum, setDatum] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const action = useAction();

  const holen = useCallback(async () => {
    try {
      setDaten(await laden({ data: documentId }));
      setLadefehler(null);
    } catch (error) {
      setLadefehler((error as Error).message);
    }
  }, [laden, documentId]);
  useEffect(() => {
    void holen();
  }, [holen]);

  const kandidat = daten?.candidates.find((c) => c.id === counterId);
  const moeglich = daten && kandidat ? Math.min(Math.abs(daten.open), Math.abs(kandidat.rest)) : 0;

  const speichern = () =>
    action
      .run(async () => {
        const cents = Math.round(Number(betrag.replace(",", ".")) * 100);
        if (!counterId) throw new Error("Bitte den Gegenbeleg wählen.");
        if (!Number.isFinite(cents) || cents <= 0) throw new Error("Bitte einen Betrag größer null eintragen.");
        if (!datum) throw new Error("Bitte den Tag der Aufrechnung angeben.");
        if (!grund.trim()) throw new Error("Bitte den Grund der Verrechnung angeben.");
        await verrechnen({ data: { documentId, counterDocumentId: counterId, amount: cents, date: datum, note: grund.trim() } });
        setOffen(false);
        setCounterId("");
        setBetrag("");
        setGrund("");
      }, `Verrechnet: ${betrag} EUR`)
      .then((ok) => {
        if (ok) void holen();
      });

  const aufhebenAktion = (id: string) =>
    action
      .run(async () => {
        await aufheben({ data: id });
      }, "Verrechnung aufgehoben")
      .then((ok) => {
        if (ok) void holen();
      });

  if (ladefehler) return <p className="banner banner-danger">{ladefehler}</p>;
  if (!daten) return null;
  const sichtbar = daten.settlements.filter((s) => !s.reversesId);
  const kannVerrechnen = !readOnly && daten.open !== 0 && daten.candidates.length > 0;
  if (!kannVerrechnen && sichtbar.length === 0) return null;

  return (
    <section className="card" aria-labelledby="verrechnung-titel">
      <h2 id="verrechnung-titel">Verrechnung</h2>
      <p className="small muted">
        Gutschrift und Rechnung desselben Lieferanten gleichen sich ohne Zahlung aus. Offen: <span className="mono">{formatEuro(daten.open)}</span>
      </p>
      {sichtbar.length > 0 && (
        <ul className="plain-list">
          {sichtbar.map((s) => (
            <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono">{tag(s.date)}</span>
              <span>
                mit Beleg vom {tag(s.counterDate)} · {s.counterSupplier ?? supplier ?? ""} · {formatEuro(s.counterGross ?? 0)}
              </span>
              <span className="mono">{formatEuro(s.amount)}</span>
              {s.note && <span className="small muted">{s.note}</span>}
              {!readOnly && (
                <button type="button" className="link-button" onClick={() => aufhebenAktion(s.id)} disabled={action.busy}>
                  aufheben
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {kannVerrechnen && !offen && (
        <button type="button" className="btn" onClick={() => setOffen(true)}>
          Mit einem Beleg verrechnen
        </button>
      )}
      {offen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void speichern();
          }}
          style={{ display: "grid", gap: 12, marginTop: 12 }}
        >
          <Field label="Gegenbeleg" hint="Offene Belege desselben Lieferanten mit umgekehrtem Vorzeichen">
            {(control) => (
              <select
                {...control}
                value={counterId}
                onChange={(e) => {
                  setCounterId(e.target.value);
                  const c = daten.candidates.find((x) => x.id === e.target.value);
                  if (c) setBetrag((Math.min(Math.abs(daten.open), Math.abs(c.rest)) / 100).toFixed(2).replace(".", ","));
                }}
              >
                <option value="">bitte wählen</option>
                {daten.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {tag(c.date)} · {formatEuro(c.gross)} · offen {formatEuro(c.rest)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Betrag" hint={moeglich > 0 ? `höchstens ${formatEuro(moeglich)}` : undefined}>
            {(control) => (
              <input {...control} className="mono" inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} placeholder="0,00" />
            )}
          </Field>
          <Field label="Tag der Aufrechnung" hint="verrechnet wird an diesem Tag, nicht rückwirkend">
            {(control) => <input {...control} type="date" required value={datum} onChange={(e) => setDatum(e.target.value)} />}
          </Field>
          <Field label="Grund" hint="etwa „Gutschrift Rechnung 12345“">
            {(control) => <input {...control} required value={grund} onChange={(e) => setGrund(e.target.value)} />}
          </Field>
          <NoticeBanner notice={action.notice} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={action.busy}>
              Verrechnen
            </button>
            <button type="button" className="btn" onClick={() => setOffen(false)} disabled={action.busy}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
      {!offen && <NoticeBanner notice={action.notice} />}
    </section>
  );
}
