import type { Steuerart, SteuerPosten } from "@haben/core";
import { Field } from "./Field.tsx";

/** Steuerart, Bezugsjahr und Teil einer Steuerzahlung im Bankabgleich (packages/core/src/steuerzahlung.ts) */
export interface SteuerWahl {
  art: Steuerart;
  /** Wie eingegeben; geprüft wird beim Buchen */
  jahr: string;
  posten: SteuerPosten;
}

export interface SteuerOptionen {
  steuerarten: { value: Steuerart; label: string }[];
  steuerPosten: { value: SteuerPosten; label: string }[];
}

/** Vorbelegung: Steuer des Vorjahres der Zahlung, die erste Steuerart der Rechtsform */
export function steuerWahlFuer(options: SteuerOptionen, bookingDate: string): SteuerWahl {
  return { art: options.steuerarten[0]?.value ?? "ust", jahr: String(Number(bookingDate.slice(0, 4)) - 1), posten: "steuer" };
}

/** Fehler am Bezugsjahr, solange `steuerangabe` null liefert */
export const BEZUGSJAHR_FEHLER = "Trag das Bezugsjahr vierstellig ein, etwa 2025.";

/** Steuerangabe für den Server; null, solange das Bezugsjahr keine Jahreszahl ist */
export function steuerangabe(wahl: SteuerWahl): { art: Steuerart; jahr: number; posten: SteuerPosten } | null {
  return /^\d{4}$/.test(wahl.jahr.trim()) ? { art: wahl.art, jahr: Number(wahl.jahr.trim()), posten: wahl.posten } : null;
}

/** Was die Wahl steuerlich bedeutet, in einem Satz */
function wirkung(wahl: SteuerWahl): string {
  if (wahl.art === "kapest" || wahl.art === "kapestSoli") {
    return "Von der Bank einbehalten: als negativer Teil einer Aufteilung neben den Zinserträgen; im Einzelunternehmen Entnahme, auf die Einkommensteuer anrechenbar.";
  }
  if (wahl.art === "gewst") {
    return "Keine Betriebsausgabe, auch nicht Zinsen und Zuschläge darauf (§ 4 Abs. 5b EStG); in der EÜR nur nachrichtlich. Erstattungszinsen sind Betriebseinnahmen.";
  }
  if (wahl.art === "est" || wahl.art === "kist" || wahl.art === "soli") {
    return "Steuer des Inhabers: privat (§ 12 Nr. 3 EStG), gebucht als Entnahme bzw. Einlage, mit Zinsen und Zuschlägen.";
  }
  if (wahl.art === "kst") return "Nicht abziehbar (§ 10 Nr. 2 KStG); eine Nachzahlung für ein Vorjahr verbraucht zuerst die Rückstellung.";
  if (wahl.posten === "zinsen235") return "Hinterziehungszinsen sind nie Betriebsausgaben (§ 4 Abs. 5 Satz 1 Nr. 8a EStG); in der EÜR nur nachrichtlich.";
  return wahl.posten === "steuer"
    ? "Nur für frühere Jahre (Jahreserklärung, Bescheid). Die Zahllast einer Voranmeldung ordnest du der Voranmeldung zu."
    : "Zinsen und Zuschläge zur Umsatzsteuer sind Betriebsausgaben; Erstattungszinsen sind Betriebseinnahmen.";
}

/** jahrFehler kommt aus der Prüfung beim Buchen (useSubmitCheck), erst danach zu sehen */
export function SteuerFelder({
  options,
  value,
  onChange,
  jahrFehler,
}: {
  options: SteuerOptionen;
  value: SteuerWahl;
  onChange: (wahl: SteuerWahl) => void;
  jahrFehler?: string | undefined;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="form-row" style={{ gridTemplateColumns: "minmax(0, 1fr) 6.5em" }}>
        <Field label="Steuerart">
          {(control) => (
            <select {...control} value={value.art} onChange={(e) => onChange({ ...value, art: e.target.value as Steuerart })}>
              {options.steuerarten.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Bezugsjahr" error={jahrFehler}>
          {(control) => (
            <input
              {...control}
              className="mono"
              inputMode="numeric"
              maxLength={4}
              value={value.jahr}
              onChange={(e) => onChange({ ...value, jahr: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Teil der Zahlung">
        {(control) => (
          <select {...control} value={value.posten} onChange={(e) => onChange({ ...value, posten: e.target.value as SteuerPosten })}>
            {options.steuerPosten.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <span className="small muted">{wirkung(value)}</span>
    </div>
  );
}
