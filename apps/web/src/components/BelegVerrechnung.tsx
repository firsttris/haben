import { amountError, formatDecimal, formatEuro, germanDay, parseEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { getDocumentSettlements, reverseSettlementFn, settleDocumentsFn } from "../server/functions/documents.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Daten = Awaited<ReturnType<typeof getDocumentSettlements>>;
type Aktion = ReturnType<typeof useAction>;

/** Datum als Text; Belegdaten sind optional, ein leerer Wert bleibt leer statt „Invalid Date“ */
const tag = (wert: string | null | undefined) => (wert ? formatDate(wert) : "ohne Datum");

/**
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274): eine Gutschrift des Lieferanten gleicht eine
 * oder mehrere Rechnungen aus. Beide Belege bleiben erhalten, es entsteht kein Bankumsatz. Der Betrag
 * darf den offenen Rest keiner der beiden Seiten überschreiten; bei Teilverrechnung bleibt der Rest offen.
 */
export function BelegVerrechnung({ documentId, supplier, readOnly }: { documentId: string; supplier: string | null; readOnly: boolean }) {
  const laden = useServerFn(getDocumentSettlements);
  const [daten, setDaten] = useState<Daten | null>(null);
  const [offen, setOffen] = useState(false);
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

  const verrechnen = useVerrechnen({ documentId, daten, action, holen, schliessen: () => setOffen(false) });
  const aufheben = useAufheben({ daten, action, holen });

  if (ladefehler) return <p className="banner banner-danger">{ladefehler}</p>;
  if (!daten) return null;
  // Eine aufgehobene Verrechnung steht als Gegenzeile in der Liste; die Originalzeile selbst hat reversesId null und
  // bliebe sonst mit einem zweiten "aufheben"-Knopf stehen. Beide Seiten ausblenden, wie in document-allocations.ts
  const aufgehoben = new Set(daten.settlements.map((s) => s.reversesId).filter((id): id is string => id !== null));
  const sichtbar = daten.settlements.filter((s) => !s.reversesId && !aufgehoben.has(s.id));
  const kannVerrechnen = !readOnly && daten.open !== 0 && daten.candidates.length > 0;
  if (!kannVerrechnen && sichtbar.length === 0) return null;

  return (
    <section className="card" aria-labelledby="verrechnung-titel">
      <h2 id="verrechnung-titel">Verrechnung</h2>
      <p className="small muted">
        Gutschrift und Rechnung desselben Lieferanten gleichen sich ohne Zahlung aus. Offen: <span className="amount">{formatEuro(daten.open)}</span>
      </p>
      {sichtbar.length > 0 && (
        <ul className="plain-list">
          {sichtbar.map((s) => (
            <VerrechnungZeile key={s.id} s={s} supplier={supplier} readOnly={readOnly} aufheben={aufheben} busy={action.busy} />
          ))}
        </ul>
      )}
      {kannVerrechnen && !offen && (
        <button type="button" className="btn" onClick={() => setOffen(true)}>
          Mit einem Beleg verrechnen
        </button>
      )}
      {offen && <VerrechnenFormular daten={daten} v={verrechnen} action={action} abbrechen={() => setOffen(false)} />}
      {!offen && <NoticeBanner notice={action.notice} />}
    </section>
  );
}

/** Eingaben und Prüfung einer neuen Verrechnung; nach dem Speichern leer bis auf den Tag */
function useVerrechnen({
  documentId,
  daten,
  action,
  holen,
  schliessen,
}: {
  documentId: string;
  daten: Daten | null;
  action: Aktion;
  holen: () => Promise<void>;
  schliessen: () => void;
}) {
  const verrechnen = useServerFn(settleDocumentsFn);
  const [counterId, setCounterId] = useState("");
  const [betrag, setBetrag] = useState("");
  const [grund, setGrund] = useState("");
  const [datum, setDatum] = useState(germanDay);
  const kandidat = daten?.candidates.find((c) => c.id === counterId);
  const moeglich = daten && kandidat ? Math.min(Math.abs(daten.open), Math.abs(kandidat.rest)) : 0;
  const cents = parseEuro(betrag);
  const pruefung = useSubmitCheck({
    counter: counterId ? null : "Wähle den Gegenbeleg.",
    betrag: cents !== null && cents > 0 ? null : amountError("einen Betrag über 0", 4_990),
    datum: datum ? null : "Wähle den Tag der Aufrechnung.",
    grund: grund.trim() ? null : "Trag den Grund der Verrechnung ein, etwa „Gutschrift Rechnung 12345“.",
  });

  const speichern = () =>
    action
      .run(async () => {
        if (cents === null) return;
        await verrechnen({ data: { documentId, counterDocumentId: counterId, amount: cents, date: datum, note: grund.trim() } });
        schliessen();
        setCounterId("");
        setBetrag("");
        setGrund("");
      }, `Verrechnet: ${betrag} EUR`)
      .then((ok) => {
        if (ok) void holen();
      });

  return { counterId, setCounterId, betrag, setBetrag, grund, setGrund, datum, setDatum, moeglich, pruefung, speichern };
}

/** Aufheben einer Verrechnung; es wirkt am Tag der Aufhebung, deshalb fragt es ein eigenes Datum ab (heute vorbelegt) */
function useAufheben({ daten, action, holen }: { daten: Daten | null; action: Aktion; holen: () => Promise<void> }) {
  const aufheben = useServerFn(reverseSettlementFn);
  const [id, setId] = useState<string | null>(null);
  const [datum, setDatum] = useState(germanDay);
  const [grund, setGrund] = useState("");
  // Die Aufhebung wirkt frühestens am Tag der Verrechnung
  const ab = daten?.settlements.find((s) => s.id === id)?.date ?? "";
  const pruefung = useSubmitCheck({
    datum: !datum ? "Wähle den Tag der Aufhebung." : datum < ab ? `Wähle einen Tag ab dem ${tag(ab)}, dem Tag der Verrechnung.` : null,
  });

  const oeffnen = (settlementId: string) => {
    setId(settlementId);
    setDatum(germanDay());
    setGrund("");
  };

  const ausfuehren = (settlementId: string) =>
    action
      .run(async () => {
        await aufheben({ data: { id: settlementId, date: datum, ...(grund.trim() ? { note: grund.trim() } : {}) } });
        setId(null);
        setGrund("");
      }, "Verrechnung aufgehoben")
      .then((ok) => {
        if (ok) void holen();
      });

  return { id, setId, datum, setDatum, grund, setGrund, pruefung, oeffnen, ausfuehren };
}

/** Eine Verrechnung in der Liste, mit „aufheben“ und dem Formular dafür */
function VerrechnungZeile({
  s,
  supplier,
  readOnly,
  aufheben,
  busy,
}: {
  s: Daten["settlements"][number];
  supplier: string | null;
  readOnly: boolean;
  aufheben: ReturnType<typeof useAufheben>;
  busy: boolean;
}) {
  return (
    <li style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span className="mono">{tag(s.date)}</span>
      <span>
        mit Beleg vom {tag(s.counterDate)} · {s.counterSupplier ?? supplier ?? ""} · {formatEuro(s.counterGross ?? 0)}
      </span>
      <span className="amount">{formatEuro(s.amount)}</span>
      {s.note && <span className="small muted">{s.note}</span>}
      {!readOnly && aufheben.id !== s.id && (
        <button type="button" className="link-button" onClick={() => aufheben.oeffnen(s.id)} disabled={busy}>
          aufheben
        </button>
      )}
      {!readOnly && aufheben.id === s.id && (
        <form
          ref={aufheben.pruefung.form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (aufheben.pruefung.check()) void aufheben.ausfuehren(s.id);
          }}
          style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", flexBasis: "100%" }}
        >
          <Field label="Tag der Aufhebung" hint="die Aufhebung wirkt an diesem Tag, nicht rückwirkend" error={aufheben.pruefung.error("datum")}>
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

/** Formular einer neuen Verrechnung: Gegenbeleg, Betrag (vorbelegt mit dem Möglichen), Tag und Grund */
function VerrechnenFormular({ daten, v, action, abbrechen }: { daten: Daten; v: ReturnType<typeof useVerrechnen>; action: Aktion; abbrechen: () => void }) {
  return (
    <form
      ref={v.pruefung.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (v.pruefung.check()) void v.speichern();
      }}
      style={{ display: "grid", gap: 12, marginTop: 12 }}
    >
      <Field label="Gegenbeleg" hint="Offene Belege desselben Lieferanten mit umgekehrtem Vorzeichen" error={v.pruefung.error("counter")}>
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
                {tag(c.date)} · {formatEuro(c.gross)} · offen {formatEuro(c.rest)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Betrag" hint={v.moeglich > 0 ? `höchstens ${formatEuro(v.moeglich)}` : undefined} error={v.pruefung.error("betrag")}>
        {(control) => (
          <input {...control} className="mono" inputMode="decimal" value={v.betrag} onChange={(e) => v.setBetrag(e.target.value)} placeholder="0,00" />
        )}
      </Field>
      <Field label="Tag der Aufrechnung" hint="verrechnet wird an diesem Tag, nicht rückwirkend" error={v.pruefung.error("datum")}>
        {(control) => <input {...control} type="date" required value={v.datum} onChange={(e) => v.setDatum(e.target.value)} />}
      </Field>
      <Field label="Grund" hint="etwa „Gutschrift Rechnung 12345“" error={v.pruefung.error("grund")}>
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
