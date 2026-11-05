import type { Steuerart, SteuerPosten } from "@haben/core";

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

/** Steuerangabe für den Server; null, solange das Bezugsjahr keine Jahreszahl ist */
export function steuerangabe(wahl: SteuerWahl): { art: Steuerart; jahr: number; posten: SteuerPosten } | null {
  return /^\d{4}$/.test(wahl.jahr.trim()) ? { art: wahl.art, jahr: Number(wahl.jahr.trim()), posten: wahl.posten } : null;
}

/** Was die Wahl steuerlich bedeutet, in einem Satz */
function wirkung(wahl: SteuerWahl): string {
  if (wahl.art === "kapest" || wahl.art === "kapestSoli") {
    return "Von der Bank einbehalten: als negativer Teil einer Aufteilung neben den Zinserträgen; im Einzelunternehmen Entnahme, auf die Einkommensteuer anrechenbar.";
  }
  if (wahl.art === "gewst") return "Keine Betriebsausgabe, auch nicht Zinsen und Zuschläge darauf (§ 4 Abs. 5b EStG); in der EÜR nur nachrichtlich.";
  if (wahl.art === "est" || wahl.art === "kist" || wahl.art === "soli") {
    return "Steuer des Inhabers: privat (§ 12 Nr. 3 EStG), gebucht als Entnahme bzw. Einlage, mit Zinsen und Zuschlägen.";
  }
  if (wahl.art === "kst") return "Nicht abziehbar (§ 10 Nr. 2 KStG); eine Nachzahlung für ein Vorjahr verbraucht zuerst die Rückstellung.";
  return wahl.posten === "steuer"
    ? "Nur für frühere Jahre (Jahreserklärung, Bescheid). Die Zahllast einer Voranmeldung ordnest du der Voranmeldung zu."
    : "Zinsen und Zuschläge zur Umsatzsteuer sind Betriebsausgaben; Erstattungszinsen sind Betriebseinnahmen.";
}

export function SteuerFelder({ options, value, onChange }: { options: SteuerOptionen; value: SteuerWahl; onChange: (wahl: SteuerWahl) => void }) {
  const jahrOk = steuerangabe(value) !== null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="form-row" style={{ gridTemplateColumns: "minmax(0, 1fr) 6.5em" }}>
        <label className="field">
          Steuerart
          <select value={value.art} onChange={(e) => onChange({ ...value, art: e.target.value as Steuerart })}>
            {options.steuerarten.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Bezugsjahr
          <input
            className="mono"
            inputMode="numeric"
            maxLength={4}
            value={value.jahr}
            onChange={(e) => onChange({ ...value, jahr: e.target.value })}
            aria-invalid={!jahrOk}
          />
        </label>
      </div>
      <label className="field">
        Teil der Zahlung
        <select value={value.posten} onChange={(e) => onChange({ ...value, posten: e.target.value as SteuerPosten })}>
          {options.steuerPosten.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <span className="small muted">{wirkung(value)}</span>
    </div>
  );
}
