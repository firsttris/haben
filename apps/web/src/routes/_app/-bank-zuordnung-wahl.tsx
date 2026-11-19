import { formatEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { Field } from "../../components/Field.tsx";
import { AUFLADUNG_OPTION } from "../../components/KategorieFelder.tsx";
import { DARLEHEN_OPTION, DIRECT_HINT, type Data, type Detail, type DirectChoice, KATEGORIE_OPTION, STEUER_OPTION, itemLabel } from "./-bank-daten.ts";

type Candidate = Detail["candidates"][number];

/** Auswahl einer anderen Rechnung, eines Belegs oder einer Voranmeldung für die Zuordnung */
export function KandidatWahl({
  candidates,
  value,
  error,
  onChange,
}: {
  candidates: Candidate[];
  value: string;
  error: string | undefined;
  onChange: (value: string, candidate: Candidate | undefined) => void;
}) {
  return (
    <Field
      label="Rechnung, Beleg oder Voranmeldung"
      hint={candidates.length === 0 && "Keine offenen Rechnungen, gebuchten Belege oder Voranmeldungen in dieser Richtung."}
      error={error}
    >
      {(control) => (
        <select
          {...control}
          value={value}
          onChange={(e) =>
            onChange(
              e.target.value,
              candidates.find((x) => `${x.type}:${x.id}` === e.target.value),
            )
          }
        >
          <option value="">Bitte wählen</option>
          {candidates.map((c) => (
            <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
              {itemLabel(c)} · {c.partyName} · offen {formatEuro(Math.abs(c.open))}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Buchungsart für die Direktbuchung eines Umsatzes ohne Rechnung */
export function BuchungsartWahl({
  directKinds,
  gesellschaft,
  ausgabe,
  value,
  onChange,
}: {
  directKinds: Data["directKinds"];
  gesellschaft: boolean;
  ausgabe: boolean;
  value: DirectChoice;
  onChange: (value: DirectChoice) => void;
}) {
  return (
    <Field
      label="Buchen als"
      hint={
        <>
          {DIRECT_HINT}
          {ausgabe && value !== "kategorie" && value !== "aufladung" && (
            <>
              <br />
              Für Ausgaben mit Rechnung den Beleg erst unter <Link to="/belege">Belege</Link> hochladen und buchen.
            </>
          )}
        </>
      }
    >
      {(control) => (
        <select {...control} value={value} onChange={(e) => onChange(e.target.value as DirectChoice)}>
          {/* Eine Aufladung gibt es nur im Einzelunternehmen (#1356): In GmbH und UG ist die Zahlung eine Forderung */}
          {[...directKinds, KATEGORIE_OPTION, ...(gesellschaft ? [] : [AUFLADUNG_OPTION]), STEUER_OPTION, DARLEHEN_OPTION].map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
