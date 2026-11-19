import { formatEuro, gruppiereGebuehren } from "@haben/core";
import { useMemo, useState } from "react";
import { Field } from "./Field.tsx";

/**
 * Zahlung und Gebühr derselben Bewegung in einer Zeile (`zahlung-gebuehr.ts` in `@haben/core`); `sichtbar` sind die
 * Umsätze der Zeilen, `index` die Stelle des gewählten Umsatzes darin (−1, wenn er nicht in der Liste steht).
 */
export function useGebuehrZeilen<T extends { id: string; bankAccountId: string; bankReference: string | null; amount: number; open: number }>(
  umsaetze: readonly T[],
  konten: readonly { id: string; purpose: string }[],
  selectedId: string | undefined,
) {
  const dienstleister = useMemo(() => new Set(konten.filter((k) => k.purpose === "zahlungsdienstleister").map((k) => k.id)), [konten]);
  const zeilen = useMemo(() => gruppiereGebuehren(umsaetze, dienstleister), [umsaetze, dienstleister]);
  const sichtbar = useMemo(() => zeilen.map((z) => z.umsatz), [zeilen]);
  return { zeilen, sichtbar, index: sichtbar.findIndex((t) => t.id === selectedId) };
}

/** Betrag des Umsatzes mit Vorzeichen, bei einer Zahlung mit Gebühr darunter die Gebühr */
export function UmsatzBetrag({ betrag, gebuehr }: { betrag: number; gebuehr: number | null }) {
  return (
    <div className="num" style={{ color: betrag > 0 ? "var(--accent-ink)" : undefined }}>
      {betrag > 0 ? "+" : "−"}
      {formatEuro(Math.abs(betrag))}
      {gebuehr !== null && (
        <div className="small muted" title="Gebühr derselben Bewegung">
          Gebühr −{formatEuro(Math.abs(gebuehr))}
        </div>
      )}
    </div>
  );
}

interface GebuehrBetrag {
  amount: number;
  open: number;
}

/**
 * Ob die Gebühr zur Zahlung mitgebucht werden kann: eine ganze Zahlung (Eingang) mit abgezogener, noch offener Gebühr
 * auf eine Rechnung oder einen Beleg. Gegen den Skonto-Weg und andere Ziele (Voranmeldung, direkt buchen) gilt das nicht.
 */
export function gebuehrMoeglich(p: {
  gebuehr: GebuehrBetrag | null;
  tx: GebuehrBetrag;
  skontoRest: number;
  posten: string | undefined;
  signedAmount: number | null;
}): boolean {
  const { gebuehr, tx } = p;
  return (
    gebuehr !== null &&
    gebuehr.open !== 0 &&
    gebuehr.amount < 0 &&
    tx.amount > 0 &&
    tx.open === tx.amount &&
    p.skontoRest === 0 &&
    (p.posten === "invoice" || p.posten === "document") &&
    p.signedAmount === tx.open
  );
}

/** Wahl für die Gebühr: ob sie mitgebucht wird und mit welchem Beleg (leer: ohne Beleg, ohne Steuer) */
export function useGebuehrWahl(moeglich: boolean) {
  const [wahl, setWahl] = useState(true);
  const [beleg, setBeleg] = useState("");
  return { moeglich, mitbuchen: moeglich && wahl, wahl, setWahl, beleg, setBeleg };
}

export type GebuehrWahlZustand = ReturnType<typeof useGebuehrWahl>;

interface OffenerPosten {
  id: string;
  type: string;
  number: string;
  partyName: string;
  open: number;
}

/**
 * Kästchen „Gebühr mitbuchen“ und die Steuer der Gebühr: ohne Beleg wird sie ohne Steuer gebucht, mit dem gebuchten
 * Beleg der Gebühr (Rechnung des Dienstleisters) laufen Vorsteuer bzw. § 13b über ihn.
 */
export function GebuehrWahl({ gebuehr, wahl, belege, busy }: { gebuehr: GebuehrBetrag; wahl: GebuehrWahlZustand; belege: OffenerPosten[]; busy: boolean }) {
  const passend = belege.filter((b) => b.type === "document" && b.open < 0 && Math.abs(b.open) >= Math.abs(gebuehr.open));
  return (
    <>
      <div className="checkbox-hinted">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={wahl.wahl}
            disabled={busy}
            aria-describedby="gebuehr-mitbuchen-hinweis"
            onChange={(e) => wahl.setWahl(e.target.checked)}
          />
          <span>Gebühr {formatEuro(Math.abs(gebuehr.amount))} mitbuchen</span>
        </label>
        <span id="gebuehr-mitbuchen-hinweis" className="field-hint">
          {wahl.mitbuchen && wahl.beleg
            ? "Die Gebühr wird dem gewählten Beleg zugeordnet; Vorsteuer bzw. § 13b laufen über ihn. Die Rechnung gilt mit dem vollen Betrag als bezahlt."
            : "Die einbehaltene Gebühr derselben Bewegung wird Aufwand (Nebenkosten des Geldverkehrs, ohne Steuer); die Rechnung gilt mit dem vollen Betrag als bezahlt."}
        </span>
      </div>
      {wahl.mitbuchen && (
        <Field
          label="Steuer der Gebühr"
          hint="Ohne Beleg wird die Gebühr ohne Steuer gebucht. Für Vorsteuer oder § 13b (Rechnung eines Dienstleisters im Ausland) wähle den gebuchten Beleg der Gebühr."
        >
          {(control) => (
            <select {...control} value={wahl.beleg} onChange={(e) => wahl.setBeleg(e.target.value)}>
              <option value="">Ohne Beleg, ohne Steuer</option>
              {passend.map((b) => (
                <option key={b.id} value={b.id}>
                  Beleg {b.partyName} {b.number} · offen {formatEuro(Math.abs(b.open))}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </>
  );
}
