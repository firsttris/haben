import { amountError, formatDecimal, formatEuro, germanDay, parseEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { getInvoiceSettlements, reverseInvoiceSettlementFn, settleInvoiceFn } from "../server/functions/invoices.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Daten = Awaited<ReturnType<typeof getInvoiceSettlements>>;
type Aktion = ReturnType<typeof useAction>;

const art = (kind: "rechnung" | "korrektur" | "storno") => (kind === "korrektur" ? "Korrektur" : kind === "storno" ? "Storno" : "Rechnung");

/**
 * Verrechnung einer Ausgangsrechnung mit ihrer Kundenkorrektur ohne Zahlung (#877): Die Korrektur mindert den offenen
 * Rest der Rechnung, der Belegbetrag bleibt stehen. Die Anzeige nennt den offenen Rest, die Zeilen der Verrechnung und
 * bietet den offenen Gegenbeleg an; aufgehoben wird am Tag der Aufhebung, nicht rückwirkend.
 */
export function RechnungVerrechnung({ invoiceId, readOnly }: { invoiceId: string; readOnly: boolean }) {
  const laden = useServerFn(getInvoiceSettlements);
  const [daten, setDaten] = useState<Daten | null>(null);
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [offen, setOffen] = useState(false);
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

  const verrechnen = useVerrechnen({ invoiceId, daten, action, holen, schliessen: () => setOffen(false) });
  const aufheben = useAufheben({ action, holen });

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
            <VerrechnungZeile key={s.id} s={s} readOnly={readOnly} aufheben={aufheben} busy={action.busy} />
          ))}
        </ul>
      )}
      {kannVerrechnen && !offen && (
        <button type="button" className="btn" onClick={() => setOffen(true)}>
          Mit der Korrektur verrechnen
        </button>
      )}
      {offen && <VerrechnenFormular daten={daten} v={verrechnen} action={action} abbrechen={() => setOffen(false)} />}
      {!offen && <NoticeBanner notice={action.notice} />}
    </section>
  );
}

/** Eingaben einer neuen Verrechnung; geprüft wird beim Speichern, danach ist sie leer bis auf den Tag */
function useVerrechnen({
  invoiceId,
  daten,
  action,
  holen,
  schliessen,
}: {
  invoiceId: string;
  daten: Daten | null;
  action: Aktion;
  holen: () => Promise<void>;
  schliessen: () => void;
}) {
  const verrechnen = useServerFn(settleInvoiceFn);
  const [counterId, setCounterId] = useState("");
  const [betrag, setBetrag] = useState("");
  const [grund, setGrund] = useState("");
  const [datum, setDatum] = useState(germanDay);
  const kandidat = daten?.candidates.find((c) => c.id === counterId);
  // Höchstens bis zum offenen Rest beider Seiten, wie settleInvoices es prüft
  const moeglich = daten && kandidat ? Math.min(Math.abs(daten.open), Math.abs(kandidat.rest)) : 0;

  const speichern = () =>
    action
      .run(async () => {
        const cents = parseEuro(betrag);
        if (!counterId) throw new Error("Bitte den Gegenbeleg wählen.");
        if (cents === null || cents <= 0) throw new Error(amountError("einen Betrag über 0"));
        if (!datum) throw new Error("Bitte den Tag der Aufrechnung angeben.");
        if (!grund.trim()) throw new Error("Bitte den Grund der Verrechnung angeben.");
        await verrechnen({ data: { invoiceId, counterInvoiceId: counterId, amount: cents, date: datum, note: grund.trim() } });
        schliessen();
        setCounterId("");
        setBetrag("");
        setGrund("");
      }, `Verrechnet: ${betrag} EUR`)
      .then((ok) => {
        if (ok) void holen();
      });

  return { counterId, setCounterId, betrag, setBetrag, grund, setGrund, datum, setDatum, moeglich, speichern };
}

/** Aufheben einer Verrechnung; es wirkt am Tag der Aufhebung, deshalb fragt es ein eigenes Datum ab (heute vorbelegt) */
function useAufheben({ action, holen }: { action: Aktion; holen: () => Promise<void> }) {
  const aufheben = useServerFn(reverseInvoiceSettlementFn);
  const [id, setId] = useState<string | null>(null);
  const [datum, setDatum] = useState(germanDay);
  const [grund, setGrund] = useState("");

  const oeffnen = (settlementId: string) => {
    setId(settlementId);
    setDatum(germanDay());
    setGrund("");
  };

  const ausfuehren = (settlementId: string) =>
    action
      .run(async () => {
        if (!datum) throw new Error("Bitte den Tag der Aufhebung angeben.");
        await aufheben({ data: { id: settlementId, date: datum, ...(grund.trim() ? { note: grund.trim() } : {}) } });
        setId(null);
        setGrund("");
      }, "Verrechnung aufgehoben")
      .then((ok) => {
        if (ok) void holen();
      });

  return { id, setId, datum, setDatum, grund, setGrund, oeffnen, ausfuehren };
}

/** Eine Verrechnung in der Liste, mit „aufheben“ und dem Formular dafür */
function VerrechnungZeile({
  s,
  readOnly,
  aufheben,
  busy,
}: {
  s: Daten["settlements"][number];
  readOnly: boolean;
  aufheben: ReturnType<typeof useAufheben>;
  busy: boolean;
}) {
  return (
    <li style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span className="mono">{formatDate(s.date)}</span>
      <span>
        mit {art(s.counterKind)} {s.counterNumber ?? "–"} vom {formatDate(s.counterIssueDate)} · {formatEuro(s.counterGross)}
      </span>
      <span className="amount">{formatEuro(Math.abs(s.amount))}</span>
      {s.note && <span className="small muted">{s.note}</span>}
      {!readOnly && aufheben.id !== s.id && (
        <button type="button" className="link-button" onClick={() => aufheben.oeffnen(s.id)} disabled={busy}>
          aufheben
        </button>
      )}
      {!readOnly && aufheben.id === s.id && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void aufheben.ausfuehren(s.id);
          }}
          style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", flexBasis: "100%" }}
        >
          <Field label="Tag der Aufhebung" hint="die Aufhebung wirkt an diesem Tag, nicht rückwirkend">
            {(control) => <input {...control} type="date" required min={s.date} value={aufheben.datum} onChange={(e) => aufheben.setDatum(e.target.value)} />}
          </Field>
          <Field label="Grund (optional)">
            {(control) => <input {...control} value={aufheben.grund} onChange={(e) => aufheben.setGrund(e.target.value)} />}
          </Field>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Aufheben
          </button>
          <button type="button" className="btn" onClick={() => aufheben.setId(null)} disabled={busy}>
            Abbrechen
          </button>
        </form>
      )}
    </li>
  );
}

/** Formular einer neuen Verrechnung: Korrektur, Betrag (vorbelegt mit dem Möglichen), Tag und Grund */
function VerrechnenFormular({ daten, v, action, abbrechen }: { daten: Daten; v: ReturnType<typeof useVerrechnen>; action: Aktion; abbrechen: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void v.speichern();
      }}
      style={{ display: "grid", gap: 12, marginTop: 12 }}
    >
      <Field label="Gegenbeleg" hint="die Korrektur zur Rechnung, offen mit Guthaben">
        {(control) => (
          <select
            {...control}
            value={v.counterId}
            onChange={(e) => {
              v.setCounterId(e.target.value);
              const c = daten.candidates.find((x) => x.id === e.target.value);
              if (c) v.setBetrag(formatDecimal(Math.min(Math.abs(daten.open), Math.abs(c.rest))));
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
      <Field label="Betrag" hint={v.moeglich > 0 ? `höchstens ${formatEuro(v.moeglich)}` : undefined}>
        {(control) => (
          <input {...control} className="mono" inputMode="decimal" value={v.betrag} onChange={(e) => v.setBetrag(e.target.value)} placeholder="0,00" />
        )}
      </Field>
      <Field label="Tag der Aufrechnung" hint="verrechnet wird an diesem Tag, nicht rückwirkend">
        {(control) => <input {...control} type="date" required value={v.datum} onChange={(e) => v.setDatum(e.target.value)} />}
      </Field>
      <Field label="Grund" hint="etwa die Nummer der Korrektur">
        {(control) => <input {...control} required value={v.grund} onChange={(e) => v.setGrund(e.target.value)} />}
      </Field>
      <NoticeBanner notice={action.notice} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={action.busy}>
          Verrechnen
        </button>
        <button type="button" className="btn" onClick={abbrechen} disabled={action.busy}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
