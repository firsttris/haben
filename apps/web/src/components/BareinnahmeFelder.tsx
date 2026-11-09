import { bareinnahmeText, type BareinnahmeAngabe } from "@haben/core";

/** Steuer einer Bareinnahme ohne Rechnung (#276); Kleinunternehmer ohne Umsatzsteuer, sonst 19 % oder 7 % */
const OPTIONEN: { angabe: BareinnahmeAngabe; kleinunternehmer: boolean | null }[] = [
  { angabe: { behandlung: "regulaer", steuersatz: 1900 }, kleinunternehmer: false },
  { angabe: { behandlung: "regulaer", steuersatz: 700 }, kleinunternehmer: false },
  { angabe: { behandlung: "kleinunternehmer", steuersatz: 0 }, kleinunternehmer: true },
  { angabe: { behandlung: "steuerfrei", steuersatz: 0 }, kleinunternehmer: null },
];

const wert = (a: BareinnahmeAngabe) => `${a.behandlung}:${a.steuersatz}`;

/** Die erste passende Behandlung: 19 % bzw. Kleinunternehmer */
export function bareinnahmeVorgabe(kleinunternehmer: boolean): BareinnahmeAngabe {
  return OPTIONEN.find((o) => o.kleinunternehmer === kleinunternehmer)!.angabe;
}

export function BareinnahmeFelder({
  kleinunternehmer,
  value,
  onChange,
}: {
  kleinunternehmer: boolean;
  value: BareinnahmeAngabe;
  onChange: (angabe: BareinnahmeAngabe) => void;
}) {
  const optionen = OPTIONEN.filter((o) => o.kleinunternehmer === null || o.kleinunternehmer === kleinunternehmer);
  return (
    <label className="field">
      Umsatzsteuer
      <select value={wert(value)} onChange={(e) => onChange(optionen.find((o) => wert(o.angabe) === e.target.value)?.angabe ?? optionen[0]!.angabe)}>
        {optionen.map((o) => (
          <option key={wert(o.angabe)} value={wert(o.angabe)}>
            {o.angabe.behandlung === "regulaer" ? `Regulär ${bareinnahmeText(o.angabe)}` : bareinnahmeText(o.angabe)}
          </option>
        ))}
      </select>
    </label>
  );
}
