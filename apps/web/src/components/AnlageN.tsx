import { formatDecimal, parseEuro } from "@haben/core";
import type { EstArbeitnehmer, EstLohnsteuerbescheinigung } from "@haben/elster";

/**
 * Eingabe der Anlage N einer Person: Lohnsteuerbescheinigungen (Nummern wie auf der Bescheinigung)
 * und Werbungskosten. Der Zustand liegt beim Formular der Einkommensteuer, hier nur Felder und Umwandlung.
 */

const BETRAEGE = [
  ["brutto", "Nr. 3 Bruttoarbeitslohn"],
  ["lohnsteuer", "Nr. 4 Lohnsteuer"],
  ["soli", "Nr. 5 Solidaritätszuschlag"],
  ["kirchensteuer", "Nr. 6 Kirchensteuer"],
  ["kirchensteuerEhegatte", "Nr. 7 Kirchensteuer Ehegatte"],
  ["rvArbeitgeber", "Nr. 22a Rentenversicherung Arbeitgeber"],
  ["rvArbeitnehmer", "Nr. 23a Rentenversicherung Arbeitnehmer"],
  ["kvArbeitnehmer", "Nr. 25 Krankenversicherung"],
  ["pvArbeitnehmer", "Nr. 26 Pflegeversicherung"],
  ["avArbeitnehmer", "Nr. 27 Arbeitslosenversicherung"],
] as const;

type BetragKey = (typeof BETRAEGE)[number][0];

export type BescheinigungDraft = { key: number; steuerklasse: string } & Record<BetragKey, string>;

const WK_BETRAEGE = [
  ["arbeitsmittel", "Arbeitsmittel", "z. B. Laptop, Fachliteratur, Arbeitskleidung"],
  ["fortbildung", "Fortbildung", undefined],
  ["gewerkschaft", "Gewerkschaft", "ab 2026 zusätzlich zum Pauschbetrag"],
  ["berufsverbaende", "Berufsverbände", undefined],
  ["sonstige", "Weitere Werbungskosten", "z. B. Kontoführung pauschal 16 €, Bewerbungen"],
] as const;

type WkKey = (typeof WK_BETRAEGE)[number][0];

export type ArbeitnehmerDraft = {
  aktiv: boolean;
  bescheinigungen: BescheinigungDraft[];
  tage: string;
  km: string;
  adresse: string;
  arbeitstageJeWoche: string;
  urlaubstage: string;
  homeofficeTage: string;
  keinAndererArbeitsplatz: boolean;
} & Record<WkKey, string>;

const centsText = (cents: number | undefined) => (cents ? formatDecimal(cents) : "");
const numberText = (n: number | undefined) => (n ? String(n).replace(".", ",") : "");
let nextKey = 1;

function emptyBescheinigung(): BescheinigungDraft {
  return { key: nextKey++, steuerklasse: "1", ...(Object.fromEntries(BETRAEGE.map(([k]) => [k, ""])) as Record<BetragKey, string>) };
}

export function toArbeitnehmerDraft(an: EstArbeitnehmer | undefined): ArbeitnehmerDraft {
  const w = an?.werbungskosten ?? {};
  return {
    aktiv: Boolean(an && an.bescheinigungen.length > 0),
    bescheinigungen: an?.bescheinigungen.length
      ? an.bescheinigungen.map((b) => ({
          key: nextKey++,
          steuerklasse: String(b.steuerklasse),
          ...(Object.fromEntries(BETRAEGE.map(([k]) => [k, centsText(b[k])])) as Record<BetragKey, string>),
        }))
      : [emptyBescheinigung()],
    tage: numberText(w.wege?.tage),
    km: numberText(w.wege?.km),
    adresse: w.wege?.adresse ?? "",
    arbeitstageJeWoche: numberText(w.wege?.arbeitstageJeWoche),
    urlaubstage: numberText(w.wege?.urlaubstage),
    homeofficeTage: numberText(w.homeofficeTage),
    keinAndererArbeitsplatz: w.keinAndererArbeitsplatz ?? false,
    ...(Object.fromEntries(WK_BETRAEGE.map(([k]) => [k, centsText(w[k])])) as Record<WkKey, string>),
  };
}

/** Wandelt den Entwurf um; ungültige Felder landen in `bad` */
export function parseArbeitnehmer(d: ArbeitnehmerDraft, wer: string, bad: string[]): EstArbeitnehmer | undefined {
  if (!d.aktiv) return undefined;
  const amount = (text: string, label: string) => {
    if (!text.trim()) return undefined;
    const cents = parseEuro(text);
    if (cents === null || cents < 0) {
      bad.push(`${label} (${wer})`);
      return undefined;
    }
    return cents || undefined;
  };
  const whole = (text: string, label: string, max: number) => {
    if (!text.trim()) return undefined;
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > max) {
      bad.push(`${label} (${wer})`);
      return undefined;
    }
    return n || undefined;
  };
  const bescheinigungen = d.bescheinigungen.map((b, i): EstLohnsteuerbescheinigung => {
    const values = Object.fromEntries(BETRAEGE.map(([k, label]) => [k, amount(b[k], `Bescheinigung ${i + 1}: ${label}`)])) as Partial<Record<BetragKey, number>>;
    if (!values.brutto) bad.push(`Bescheinigung ${i + 1}: Bruttoarbeitslohn (${wer})`);
    return { ...values, steuerklasse: Number(b.steuerklasse) as EstLohnsteuerbescheinigung["steuerklasse"], brutto: values.brutto ?? 0 };
  });
  const tage = whole(d.tage, "Arbeitstage an der Tätigkeitsstätte", 366);
  const km = whole(d.km, "Entfernung", 9999);
  if ((tage || km) && !(tage && km && d.adresse.trim())) bad.push(`Wege zur Arbeit: Tage, Entfernung und Anschrift (${wer})`);
  const arbeitstageJeWoche = whole(d.arbeitstageJeWoche, "Arbeitstage je Woche", 7);
  const urlaubstage = whole(d.urlaubstage, "Urlaubs- und Krankheitstage", 366);
  return {
    bescheinigungen,
    werbungskosten: {
      ...(tage && km
        ? {
            wege: {
              tage: Math.floor(tage),
              km,
              adresse: d.adresse.trim(),
              ...(arbeitstageJeWoche ? { arbeitstageJeWoche: Math.floor(arbeitstageJeWoche) } : {}),
              ...(urlaubstage ? { urlaubstage: Math.floor(urlaubstage) } : {}),
            },
          }
        : {}),
      homeofficeTage: whole(d.homeofficeTage, "Homeoffice-Tage", 366),
      keinAndererArbeitsplatz: d.keinAndererArbeitsplatz || undefined,
      ...(Object.fromEntries(WK_BETRAEGE.map(([k, label]) => [k, amount(d[k], label)])) as Partial<Record<WkKey, number>>),
    },
  };
}

export function AnlageNFields({ wer, draft, onChange }: { wer: string; draft: ArbeitnehmerDraft; onChange: (draft: ArbeitnehmerDraft) => void }) {
  const set = (patch: Partial<ArbeitnehmerDraft>) => onChange({ ...draft, ...patch });
  const setB = (key: number, patch: Partial<BescheinigungDraft>) =>
    set({ bescheinigungen: draft.bescheinigungen.map((b) => (b.key === key ? { ...b, ...patch } : b)) });

  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }} aria-label={`Anlage N · ${wer}`}>
      <legend className="subhead">Arbeitslohn (Anlage N) · {wer}</legend>
      <label className="checkbox">
        <input type="checkbox" checked={draft.aktiv} onChange={(e) => set({ aktiv: e.target.checked })} />
        {wer} hatte Arbeitslohn aus einer Anstellung
      </label>
      {draft.aktiv && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Die Beträge stehen auf der Lohnsteuerbescheinigung, die der Arbeitgeber schickt; Haben übernimmt die Sozialversicherung in die
            Anlage Vorsorgeaufwand. Bei mehreren Arbeitgebern je Bescheinigung eine Zeile.
          </p>
          {draft.bescheinigungen.map((b, index) => (
            <div key={b.key} className="form-grid" role="group" aria-label={`Lohnsteuerbescheinigung ${index + 1} · ${wer}`}>
              <label className="field">
                Steuerklasse
                <select value={b.steuerklasse} onChange={(e) => setB(b.key, { steuerklasse: e.target.value })}>
                  {[1, 2, 3, 4, 5, 6].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              {BETRAEGE.map(([k, label]) => (
                <label key={k} className="field">
                  {label}
                  <input inputMode="decimal" value={b[k]} onChange={(e) => setB(b.key, { [k]: e.target.value })} placeholder="0,00" required={k === "brutto"} />
                </label>
              ))}
              {draft.bescheinigungen.length > 1 && (
                <div className="actions" style={{ gridColumn: "1 / -1" }}>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => set({ bescheinigungen: draft.bescheinigungen.filter((x) => x.key !== b.key) })}
                  >
                    Bescheinigung entfernen
                  </button>
                </div>
              )}
            </div>
          ))}
          <div>
            <button type="button" className="btn" onClick={() => set({ bescheinigungen: [...draft.bescheinigungen, emptyBescheinigung()] })}>
              + Weitere Lohnsteuerbescheinigung
            </button>
          </div>

          <div className="subhead" aria-hidden="true">
            Werbungskosten
          </div>
          <div className="form-grid" role="group" aria-label={`Werbungskosten · ${wer}`}>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Erste Tätigkeitsstätte (PLZ, Ort, Straße)
              <input value={draft.adresse} onChange={(e) => set({ adresse: e.target.value })} maxLength={200} />
            </label>
            <label className="field">
              Tage dort
              <input inputMode="numeric" value={draft.tage} onChange={(e) => set({ tage: e.target.value })} />
            </label>
            <label className="field">
              Einfache Entfernung in km
              <input inputMode="decimal" value={draft.km} onChange={(e) => set({ km: e.target.value })} />
            </label>
            <label className="field">
              Arbeitstage je Woche
              <input inputMode="numeric" value={draft.arbeitstageJeWoche} onChange={(e) => set({ arbeitstageJeWoche: e.target.value })} />
            </label>
            <label className="field">
              Urlaubs- und Krankheitstage
              <input inputMode="numeric" value={draft.urlaubstage} onChange={(e) => set({ urlaubstage: e.target.value })} />
            </label>
            <label className="field">
              Homeoffice-Tage
              <input inputMode="numeric" value={draft.homeofficeTage} onChange={(e) => set({ homeofficeTage: e.target.value })} />
              <span className="small muted">ohne Fahrt zur Tätigkeitsstätte; 6 € je Tag, höchstens 210 Tage</span>
            </label>
            <label className="checkbox" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={draft.keinAndererArbeitsplatz} onChange={(e) => set({ keinAndererArbeitsplatz: e.target.checked })} />
              Dauerhaft kein anderer Arbeitsplatz
            </label>
            {WK_BETRAEGE.map(([k, label, hint]) => (
              <label key={k} className="field">
                {label}
                <input inputMode="decimal" value={draft[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder="0,00" />
                {hint && <span className="small muted">{hint}</span>}
              </label>
            ))}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Unter 1.230 € Werbungskosten zieht das Finanzamt ohnehin den Arbeitnehmer-Pauschbetrag ab; die Angaben schaden aber nicht.
          </p>
        </>
      )}
    </fieldset>
  );
}
