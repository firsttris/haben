import { entfernungspauschale, formatEuro, PAUSCHALE_LABEL, volleKilometer } from "@haben/core";
import { type FormEvent, useState } from "react";
import { Field } from "./Field.tsx";

export interface EntfernungEingabe {
  month: string;
  tage: number;
  km: number;
  betriebsstaette: string;
}

/**
 * Pauschale „Wege zwischen Wohnung und Betriebsstätte“: Tage und einfache Entfernung je Monat. Die Sätze des Jahres und
 * der Betrag kommen aus dem Rechenkern (`entfernungspauschale`); gesendet wird über `onSubmit`, das meldet, ob es gebucht wurde.
 */
export function EntfernungForm({
  year,
  monat,
  busy,
  onSubmit,
}: {
  year: number;
  /** Vorgabe und letzter wählbarer Monat (JJJJ-MM) */
  monat: string;
  busy: boolean;
  onSubmit: (input: EntfernungEingabe, form: HTMLFormElement) => Promise<boolean>;
}) {
  const [month, setMonth] = useState(monat);
  const [tage, setTage] = useState("");
  const [km, setKm] = useState("");
  const [betriebsstaette, setBetriebsstaette] = useState("");
  const jahr = Number(month.slice(0, 4)) || year;
  const strecke = volleKilometer(km);
  const betrag = entfernungspauschale(jahr, Number(tage) || 0, strecke);
  // Die Sätze des Jahres kommen aus dem Rechenkern: Satz bis zum 20. und ab dem 21. Kilometer
  const nah = entfernungspauschale(jahr, 1, 1);
  const fern = entfernungspauschale(jahr, 1, 21) - entfernungspauschale(jahr, 1, 20);
  const satzText =
    nah === fern
      ? `${formatEuro(nah)} je vollem Kilometer der einfachen Strecke.`
      : `${formatEuro(nah)} je vollem Kilometer der einfachen Strecke, ab dem 21. Kilometer ${formatEuro(fern)}.`;

  function senden(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit({ month, tage: Number(tage), km: strecke, betriebsstaette: betriebsstaette.trim() }, event.currentTarget).then((ok) => {
      if (!ok) return;
      setTage("");
      setKm("");
      setBetriebsstaette("");
    });
  }

  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={senden} aria-label={PAUSCHALE_LABEL.entfernung}>
      <p className="small muted" style={{ margin: 0 }}>
        Für jeden Tag, an dem du von der Wohnung zur Betriebsstätte fährst (zum Beispiel zum gemieteten Praxisraum oder Atelier), zählt die
        Entfernungspauschale: {satzText} Hin- und Rückweg sind damit abgegolten. Haben rechnet für ein Fahrzeug, das nicht zu deinem Betriebsvermögen gehört.
        Fahrten zu Kunden und auf Reisen trägst du als Fahrt ein. Ein Tag zählt nur einmal, auch bei mehreren Betriebsstätten.
      </p>
      <div className="form-grid">
        <Field label="Monat">
          {(control) => <input {...control} type="month" value={month} min={`${year}-01`} max={monat} onChange={(e) => setMonth(e.target.value)} required />}
        </Field>
        <Field label="Tage an der Betriebsstätte">
          {(control) => <input {...control} value={tage} onChange={(e) => setTage(e.target.value.replace(/\D/g, ""))} inputMode="numeric" required />}
        </Field>
        <Field label="Kilometer einfach">
          {(control) => <input {...control} value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d,.]/g, ""))} inputMode="decimal" required />}
        </Field>
        <Field label="Betriebsstätte" hint={betrag > 0 && betriebsstaette.trim() === "" ? "Trag die Betriebsstätte ein, dann lässt sich buchen." : undefined}>
          {(control) => (
            <input
              {...control}
              value={betriebsstaette}
              onChange={(e) => setBetriebsstaette(e.target.value)}
              placeholder="Praxisraum, Musterstadt"
              maxLength={300}
              required
            />
          )}
        </Field>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || betrag === 0 || betriebsstaette.trim() === ""}>
          {betrag > 0 ? `${formatEuro(betrag)} buchen` : "Buchen"}
        </button>
      </div>
    </form>
  );
}
