import { abziehbarerAnteil, abziehbareSteuer, formatDecimal, formatEuro, gespeicherterAnteil, parseEuro, splitPrivateShare } from "@haben/core";
import { Field } from "./Field.tsx";

/** Prozenttext direkt in Basispunkte lesen, ohne Zwischenwert als Dezimalzahl. Leer übernimmt die Vorgabe. */
export function parseVorsteuerAnteil(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,3}(,\d{1,2})?$/.test(text)) return null;
  const points = parseEuro(text);
  return points !== null && points <= 10_000 ? points : null;
}

export const formatVorsteuerAnteil = (value: number | null | undefined): string =>
  value == null
    ? ""
    : formatDecimal(value)
        .replace(/,00$/, "")
        .replace(/(,\d)0$/, "$1");

interface VorsteuerRow {
  key: number;
  taxRate: number;
  vorsteuerAnteil: string;
  net: number | null;
  tax: number | null;
}

interface Props {
  value: string;
  rows: VorsteuerRow[];
  company: { kleinunternehmer: boolean; ohneVorsteuerabzug: boolean };
  booked: boolean;
  storedDeduction: boolean;
  privateShare: number;
  asset: boolean;
  importVat?: boolean;
  onChange: (value: string) => void;
  onRateChange: (key: number, value: string) => void;
}

function AnteilField({
  label,
  value,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const invalid = value.trim() !== "" && parseVorsteuerAnteil(value) === null;
  return (
    <Field label={label} hint={hint} error={invalid ? "0 bis 100 % mit höchstens zwei Nachkommastellen eingeben." : undefined}>
      {(control) => (
        <input {...control} inputMode="decimal" value={value} placeholder="Vorgabe" disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}

export function VorsteuerAnteil(props: Props) {
  const { value, rows, company, booked, storedDeduction, privateShare, asset, onChange, onRateChange, importVat = false } = props;
  const blocked = !booked && company.kleinunternehmer;
  const selected = parseVorsteuerAnteil(value);
  const defaultShare = booked ? gespeicherterAnteil({ vorsteuerAnteil: selected, vorsteuerAbzug: storedDeduction }) : abziehbarerAnteil(company, selected);
  const valid = [value, ...rows.map((row) => row.vorsteuerAnteil)].every((text) => text.trim() === "" || parseVorsteuerAnteil(text) !== null);
  const preview =
    valid && rows.every((row) => row.net !== null && row.tax !== null) && Number.isInteger(privateShare) && privateShare >= 0 && privateShare <= 100;
  const importVatReady =
    !blocked &&
    privateShare === 0 &&
    rows.length > 0 &&
    rows.every((row) => row.taxRate === 0 && row.tax === 0 && (parseVorsteuerAnteil(row.vorsteuerAnteil) ?? defaultShare) === 10_000);
  // Der Zollbetrag selbst ist Vorsteuer ohne Aufwand (§ 15 Abs. 1 Satz 1 Nr. 2 UStG), nicht die Steuer auf diesen Betrag.
  // Quelle: https://www.gesetze-im-internet.de/ustg_1980/__15.html. Die bestehende EUSt-Grenze erlaubt hier keinen Teilabzug.
  const totals = importVat
    ? { deductible: rows.reduce((sum, row) => sum + (row.net ?? 0) + (row.tax ?? 0), 0), excluded: 0, cost: 0 }
    : rows.reduce(
        (sum, row) => {
          const tax = splitPrivateShare(row.tax ?? 0, privateShare).business;
          const share = blocked ? 0 : (parseVorsteuerAnteil(row.vorsteuerAnteil) ?? defaultShare);
          const deductible = abziehbareSteuer(tax, share);
          return {
            deductible: sum.deductible + deductible,
            excluded: sum.excluded + tax - deductible,
            cost: sum.cost + splitPrivateShare(row.net ?? 0, privateShare).business + tax - deductible,
          };
        },
        { deductible: 0, excluded: 0, cost: 0 },
      );
  return (
    <div className="stack" style={{ gap: 12 }}>
      <AnteilField
        label="Abziehbare Vorsteuer in %"
        value={blocked ? "0" : value}
        disabled={blocked || booked}
        onChange={onChange}
        hint={
          blocked
            ? "Als Kleinunternehmer ist kein Vorsteuerabzug möglich."
            : booked
              ? `Gespeicherter Beleganteil: ${formatVorsteuerAnteil(defaultShare)} %.`
              : `Leer = Firmenvorgabe (${company.ohneVorsteuerabzug ? "0" : "100"} %). Wirtschaftlich zugeordneter Anteil, unabhängig vom Privatanteil.`
        }
      />
      {!blocked && (
        <details open={rows.some((row) => row.vorsteuerAnteil !== "") || undefined}>
          <summary className="small">Abweichend je Steuersatz</summary>
          <div className="form-grid" style={{ marginTop: 12 }}>
            {rows.map((row) => (
              <AnteilField
                key={row.key}
                label={`Vorsteueranteil bei ${row.taxRate / 100} % in %`}
                value={row.vorsteuerAnteil}
                disabled={booked}
                onChange={(text) => onRateChange(row.key, text)}
                hint={`Leer = Beleganteil (${formatVorsteuerAnteil(defaultShare)} %).`}
              />
            ))}
          </div>
        </details>
      )}
      <p className="small" role="status" aria-label="Vorsteuervorschau" style={{ margin: 0 }}>
        {preview && (!importVat || importVatReady) ? (
          <>
            Abziehbare Vorsteuer <strong className="amount">{formatEuro(totals.deductible)}</strong>
            {" · "}
            Nicht abziehbare Steuer <span className="amount">{formatEuro(totals.excluded)}</span>
            {" · "}
            {asset ? "Anschaffungskosten" : "Aufwand"} <span className="amount">{formatEuro(totals.cost)}</span>
            {privateShare > 0 && " (nach Privatanteil)"}.
          </>
        ) : importVat && preview ? (
          "Einfuhrumsatzsteuer wird nur als reiner Steuerbetrag zu 0 % mit vollständigem Vorsteuerabzug und ohne Privatanteil unterstützt."
        ) : (
          "Vorschau nach gültiger Eingabe der Beträge und Anteile."
        )}
      </p>
    </div>
  );
}
