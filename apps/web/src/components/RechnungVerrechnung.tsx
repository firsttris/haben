import { formatDecimal, formatEuro, parseEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { getInvoiceSettlements, reverseInvoiceSettlementFn, settleInvoiceFn } from "../server/functions/invoices.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Daten = Awaited<ReturnType<typeof getInvoiceSettlements>>;

/** Heute in deutscher Zeit als JJJJ-MM-TT, wie die Datumsfelder es erwarten */
const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

const art = (kind: "rechnung" | "korrektur" | "storno") => (kind === "korrektur" ? "Korrektur" : kind === "storno" ? "Storno" : "Rechnung");

/**
 * Verrechnung einer Ausgangsrechnung mit ihrer Kundenkorrektur ohne Zahlung (#877): Die Korrektur mindert den offenen
 * Rest der Rechnung, der Belegbetrag bleibt stehen. Die Anzeige nennt den offenen Rest, die Zeilen der Verrechnung und
 * bietet den offenen Gegenbeleg an; aufgehoben wird am Tag der Aufhebung, nicht rückwirkend.
 */
export function RechnungVerrechnung({ invoiceId, readOnly }: { invoiceId: string; readOnly: boolean }) {
  const laden = useServerFn(getInvoiceSettlements);
  const verrechnen = useServerFn(settleInvoiceFn);
  const aufheben = useServerFn(reverseInvoiceSettlementFn);
  const [daten, setDaten] = useState<Daten | null>(null);
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [offen, setOffen] = useState(false);
  const [counterId, setCounterId] = useState("");
  const [betrag, setBetrag] = useState("");
  const [grund, setGrund] = useState("");
  const [datum, setDatum] = useState(heute);
  const [aufhebenId, setAufhebenId] = useState<string | null>(null);
  const [aufhebenDatum, setAufhebenDatum] = useState(heute);
  const [aufhebenGrund, setAufhebenGrund] = useState("");
  const action = useAction();

  const holen = useCallback(async () => {
    try {
      setDaten(await laden({ data: invoiceId }));
      setLadefehler(null);
    } catch (error) {
      setLadefehler((error as Error).message);
    }
  }, [laden, invoiceId]);
  useEffect(() => {
    void holen();
  }, [holen]);

  const kandidat = daten?.candidates.find((c) => c.id === counterId);
  // Höchstens bis zum offenen Rest beider Seiten, wie settleInvoices es prüft
  const moeglich = daten && kandidat ? Math.min(Math.abs(daten.open), Math.abs(kandidat.rest)) : 0;

  const speichern = () =>
    action
      .run(async () => {
        const cents = parseEuro(betrag);
        if (!counterId) throw new Error("Bitte den Gegenbeleg wählen.");
        if (cents === null || cents <= 0) throw new Error("Bitte einen Betrag größer null eintragen.");
        if (!datum) throw new Error("Bitte den Tag der Aufrechnung angeben.");
        if (!grund.trim()) throw new Error("Bitte den Grund der Verrechnung angeben.");
        await verrechnen({ data: { invoiceId, counterInvoiceId: counterId, amount: cents, date: datum, note: grund.trim() } });
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
        if (!aufhebenDatum) throw new Error("Bitte den Tag der Aufhebung angeben.");
        await aufheben({ data: { id, date: aufhebenDatum, ...(aufhebenGrund.trim() ? { note: aufhebenGrund.trim() } : {}) } });
        setAufhebenId(null);
        setAufhebenGrund("");
      }, "Verrechnung aufgehoben")
      .then((ok) => {
        if (ok) void holen();
      });

  if (ladefehler) return <p className="banner banner-danger">{ladefehler}</p>;
  if (!daten) return null;
  // Eine aufgehobene Verrechnung steht als Gegenzeile in der Liste; die aufgehobene Originalzeile und die Gegenzeile
  // selbst verschwinden, wie in BelegVerrechnung
  const aufgehoben = new Set(daten.settlements.map((s) => s.reversesId).filter((id): id is string => id !== null));
  const sichtbar = daten.settlements.filter((s) => !s.reversesId && !aufgehoben.has(s.id));
  const kannVerrechnen = !readOnly && daten.status === "final" && daten.currency === "EUR" && daten.open !== 0 && daten.candidates.length > 0;
  if (!kannVerrechnen && sichtbar.length === 0) return null;

  return (
    <section className="card" aria-labelledby="verrechnung-heading">
      <h2 id="verrechnung-heading">Verrechnung</h2>
      <p className="small muted">
        Die Kundenkorrektur gleicht die Rechnung ohne Zahlung aus. Der Belegbetrag bleibt stehen, offen sind noch{" "}
        <span className="amount">{formatEuro(daten.open)}</span>.
      </p>
      {sichtbar.length > 0 && (
        <ul className="plain-list">
          {sichtbar.map((s) => (
            <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono">{formatDate(s.date)}</span>
              <span>
                mit {art(s.counterKind)} {s.counterNumber ?? "–"} vom {formatDate(s.counterIssueDate)} · {formatEuro(s.counterGross)}
              </span>
              <span className="amount">{formatEuro(Math.abs(s.amount))}</span>
              {s.note && <span className="small muted">{s.note}</span>}
              {!readOnly && aufhebenId !== s.id && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setAufhebenId(s.id);
                    setAufhebenDatum(heute());
                    setAufhebenGrund("");
                  }}
                  disabled={action.busy}
                >
                  aufheben
                </button>
              )}
              {!readOnly && aufhebenId === s.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void aufhebenAktion(s.id);
                  }}
                  style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", flexBasis: "100%" }}
                >
                  <Field label="Tag der Aufhebung" hint="die Aufhebung wirkt an diesem Tag, nicht rückwirkend">
                    {(control) => (
                      <input {...control} type="date" required min={s.date} value={aufhebenDatum} onChange={(e) => setAufhebenDatum(e.target.value)} />
                    )}
                  </Field>
                  <Field label="Grund (optional)">
                    {(control) => <input {...control} value={aufhebenGrund} onChange={(e) => setAufhebenGrund(e.target.value)} />}
                  </Field>
                  <button type="submit" className="btn btn-primary" disabled={action.busy}>
                    Aufheben
                  </button>
                  <button type="button" className="btn" onClick={() => setAufhebenId(null)} disabled={action.busy}>
                    Abbrechen
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {kannVerrechnen && !offen && (
        <button type="button" className="btn" onClick={() => setOffen(true)}>
          Mit der Korrektur verrechnen
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
          <Field label="Gegenbeleg" hint="die Korrektur zur Rechnung, offen mit Guthaben">
            {(control) => (
              <select
                {...control}
                value={counterId}
                onChange={(e) => {
                  setCounterId(e.target.value);
                  const c = daten.candidates.find((x) => x.id === e.target.value);
                  if (c) setBetrag(formatDecimal(Math.min(Math.abs(daten.open), Math.abs(c.rest))));
                }}
              >
                <option value="">bitte wählen</option>
                {daten.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {art(c.kind)} {c.number ?? "–"} vom {formatDate(c.issueDate)} · {formatEuro(c.gross)} · offen {formatEuro(c.rest)}
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
          <Field label="Grund" hint="etwa die Nummer der Korrektur">
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
