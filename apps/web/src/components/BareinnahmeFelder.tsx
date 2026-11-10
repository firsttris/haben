import { bareinnahmeText, type BareinnahmeAngabe } from "@haben/core";
import { Field } from "./Field.tsx";

/** Steuer einer Bareinnahme ohne Rechnung (#276); Kleinunternehmer ohne Umsatzsteuer, sonst 19 % oder 7 % */
const OPTIONEN: { angabe: BareinnahmeAngabe; kleinunternehmer: boolean | null }[] = [
  { angabe: { behandlung: "regulaer", steuersatz: 1900 }, kleinunternehmer: false },
  { angabe: { behandlung: "regulaer", steuersatz: 700 }, kleinunternehmer: false },
  { angabe: { behandlung: "kleinunternehmer", steuersatz: 0 }, kleinunternehmer: true },
  { angabe: { behandlung: "steuerfrei", steuersatz: 0 }, kleinunternehmer: null },
];

const wert = (a: BareinnahmeAngabe) => `${a.behandlung}:${a.steuersatz}`;

const passend = (kleinunternehmer: boolean) => OPTIONEN.filter((o) => o.kleinunternehmer === null || o.kleinunternehmer === kleinunternehmer);

/**
 * Die gewählte Behandlung, wenn sie zum Kleinunternehmer-Stand im Monat der Bareinnahme passt, sonst die erste passende
 * (19 % bzw. Kleinunternehmer): Mit dem Datum kann sich der Stand ändern
 */
export function bareinnahmeWahl(gewaehlt: BareinnahmeAngabe | null, kleinunternehmer: boolean): BareinnahmeAngabe {
  const optionen = passend(kleinunternehmer);
  return optionen.find((o) => gewaehlt !== null && wert(o.angabe) === wert(gewaehlt))?.angabe ?? optionen[0]!.angabe;
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
  const optionen = passend(kleinunternehmer);
  return (
    <Field label="Umsatzsteuer">
      {(control) => (
        <select
          {...control}
          value={wert(value)}
          onChange={(e) => onChange(optionen.find((o) => wert(o.angabe) === e.target.value)?.angabe ?? optionen[0]!.angabe)}
        >
          {optionen.map((o) => (
            <option key={wert(o.angabe)} value={wert(o.angabe)}>
              {o.angabe.behandlung === "regulaer" ? `Regulär ${bareinnahmeText(o.angabe)}` : bareinnahmeText(o.angabe)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
