import type { ReactNode } from "react";
import { Field } from "./Field.tsx";

/* Anteilseigner in den Angaben zur Körperschaft- und Gewerbesteuererklärung (KapgAngaben.tsx) */

export type Person = {
  name: string;
  strasse: string;
  plzOrt: string;
  nummer: string;
  beteiligung: string;
  anteil: string;
  geaendert: boolean;
  /** Kirchensteuerabzugsmerkmal für Ausschüttungen: Satz und Religionsschlüssel */
  kirchensteuer: 0 | 8 | 9;
  religionsschluessel: string;
  /** Für die Steuerbescheinigung (Muster II): Name der kirchensteuererhebenden Religionsgemeinschaft */
  religionsgemeinschaft: string;
};

const leererAnteilseigner: Person = {
  name: "",
  strasse: "",
  plzOrt: "",
  nummer: "",
  beteiligung: "",
  anteil: "",
  geaendert: true,
  kirchensteuer: 0,
  religionsschluessel: "",
  religionsgemeinschaft: "",
};

type Zeile = { p: Person; i: number; set: (patch: Partial<Person>) => void };

/** Beschriftung mit der Nummer des Anteilseigners für Screenreader */
const Label = ({ text, i }: { text: ReactNode; i: number }) => (
  <>
    {text}
    <span className="visually-hidden"> Anteilseigner {i + 1}</span>
  </>
);

function Anschrift({ p, i, set }: Zeile) {
  return (
    <div className="form-row cols-3 align-end">
      <Field label={<Label text="Name" i={i} />}>
        {(control) => <input {...control} value={p.name} onChange={(e) => set({ name: e.target.value })} required />}
      </Field>
      <Field label={<Label text="Straße und Hausnummer" i={i} />}>
        {(control) => <input {...control} value={p.strasse} onChange={(e) => set({ strasse: e.target.value })} required />}
      </Field>
      <Field label={<Label text="PLZ und Ort" i={i} />}>
        {(control) => <input {...control} value={p.plzOrt} onChange={(e) => set({ plzOrt: e.target.value })} required />}
      </Field>
    </div>
  );
}

function Beteiligung({ p, i, set }: Zeile) {
  return (
    <div className="form-row cols-3 align-end">
      <Field label={<Label text="Identifikationsnummer oder Steuernummer (13 Ziffern)" i={i} />}>
        {(control) => <input {...control} inputMode="numeric" value={p.nummer} onChange={(e) => set({ nummer: e.target.value })} required />}
      </Field>
      <Field label={<Label text="Beteiligung in Euro" i={i} />}>
        {(control) => <input {...control} inputMode="decimal" value={p.beteiligung} onChange={(e) => set({ beteiligung: e.target.value })} required />}
      </Field>
      <Field label={<Label text="Anteil in Prozent" i={i} />}>
        {(control) => <input {...control} inputMode="decimal" value={p.anteil} onChange={(e) => set({ anteil: e.target.value })} required />}
      </Field>
    </div>
  );
}

function Kirchensteuer({ p, i, set }: Zeile) {
  return (
    <div className="form-row cols-3 align-end">
      <Field label={<Label text="Kirchensteuer bei Ausschüttungen" i={i} />}>
        {(control) => (
          <select {...control} value={p.kirchensteuer} onChange={(e) => set({ kirchensteuer: Number(e.target.value) as Person["kirchensteuer"] })}>
            <option value={0}>keine</option>
            <option value={8}>8 % (Bayern, Baden-Württemberg)</option>
            <option value={9}>9 %</option>
          </select>
        )}
      </Field>
      {p.kirchensteuer > 0 && (
        <Field label={<Label text="Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal" i={i} />}>
          {(control) => (
            <input
              {...control}
              inputMode="numeric"
              value={p.religionsschluessel}
              onChange={(e) => set({ religionsschluessel: e.target.value })}
              placeholder="z. B. 010100"
              required
            />
          )}
        </Field>
      )}
      {p.kirchensteuer > 0 && (
        <Field label={<Label text="Kirchensteuererhebende Religionsgemeinschaft" i={i} />}>
          {(control) => (
            <input
              {...control}
              value={p.religionsgemeinschaft}
              onChange={(e) => set({ religionsgemeinschaft: e.target.value })}
              placeholder="z. B. römisch-katholisch"
            />
          )}
        </Field>
      )}
    </div>
  );
}

function Anteilseigner({ p, i, set, remove }: Zeile & { remove: () => void }) {
  return (
    <div className="stack sub-group" style={{ gap: 12 }} role="group" aria-label={`Anteilseigner ${i + 1}`}>
      <div className="sub-group-title" aria-hidden="true">
        Anteilseigner {i + 1}
      </div>
      <Anschrift p={p} i={i} set={set} />
      <Beteiligung p={p} i={i} set={set} />
      <Kirchensteuer p={p} i={i} set={set} />
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <label className="checkbox">
          <input type="checkbox" checked={p.geaendert} onChange={(e) => set({ geaendert: e.target.checked })} />
          Angaben gegenüber dem Vorjahr geändert
        </label>
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          Anteilseigner {i + 1} entfernen
        </button>
      </div>
    </div>
  );
}

export function KapgAnteilseigner({ personen, setPersonen }: { personen: Person[]; setPersonen: (p: Person[]) => void }) {
  const setPerson = (i: number, patch: Partial<Person>) => setPersonen(personen.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <fieldset className="stack fieldset-plain" style={{ gap: 16 }}>
      <legend>Anteilseigner</legend>
      {personen.map((p, i) => (
        <Anteilseigner key={i} p={p} i={i} set={(patch) => setPerson(i, patch)} remove={() => setPersonen(personen.filter((_, j) => j !== i))} />
      ))}
      <div>
        <button type="button" className="btn" onClick={() => setPersonen([...personen, { ...leererAnteilseigner }])}>
          Anteilseigner hinzufügen
        </button>
      </div>
    </fieldset>
  );
}
