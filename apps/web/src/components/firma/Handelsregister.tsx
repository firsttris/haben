import { useState } from "react";
import type { loadCompany } from "../../server/modules/stammdaten/index.ts";
import { Field } from "../Field.tsx";
import { EinklappAbschnitt } from "./EinklappAbschnitt.tsx";
import { handelsregisterKurz } from "./kurzwerte.ts";

type Firma = Awaited<ReturnType<typeof loadCompany>>;

/** Nur in einer GmbH oder UG; ohne diese Felder bleiben die gespeicherten Angaben, siehe onSubmit in FirmaForm */
export function Handelsregister({
  company,
  letterIssues,
  offen,
  onOffen,
}: {
  company: Firma;
  letterIssues: string[];
  offen: boolean;
  onOffen: (offen: boolean) => void;
}) {
  const [registernummer, setRegisternummer] = useState(company.registernummer);
  return (
    <EinklappAbschnitt
      id="company-register"
      titel="Handelsregister und Geschäftsführung"
      kurz={handelsregisterKurz(registernummer, letterIssues.length > 0)}
      offen={offen}
      onOffen={onOffen}
    >
      <p className="field-hint" style={{ marginTop: 0 }}>
        Gehören in den Jahresabschluss (§ 264 Abs. 1a HGB), etwa auf die Bilanz zur Hinterlegung beim Unternehmensregister, und auf jeden Geschäftsbrief (§ 35a
        GmbHG): Haben druckt sie in den Fuß von Rechnung, Angebot, Mahnung und Lieferschein und hängt sie an E-Mails an. Sie stehen im Registerauszug.
      </p>
      {letterIssues.length > 0 && (
        <div className="banner" id="letter-issues">
          Für Rechnungen und Geschäftsbriefe fehlt noch (§ 35a GmbHG): {letterIssues.join(", ")}.
        </div>
      )}
      <div className="form-row cols-2">
        <Field label="Sitz" hint="Laut Gesellschaftsvertrag; leer = Ort der Anschrift.">
          {(control) => <input {...control} name="sitz" defaultValue={company.sitz} maxLength={100} placeholder={company.ort} />}
        </Field>
        <Field label="Registergericht">
          {(control) => (
            <input {...control} name="registergericht" defaultValue={company.registergericht} maxLength={100} placeholder="z. B. Amtsgericht Bremen" />
          )}
        </Field>
        <Field label="Registernummer">
          {(control) => (
            <input
              {...control}
              name="registernummer"
              value={registernummer}
              onChange={(event) => setRegisternummer(event.target.value)}
              maxLength={40}
              placeholder="z. B. HRB 12345 HB"
              className="mono"
            />
          )}
        </Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Geschäftsführer" hint="Alle, einer je Zeile, mit ausgeschriebenem Vornamen.">
          {(control) => (
            <textarea
              {...control}
              name="geschaeftsfuehrer"
              defaultValue={company.geschaeftsfuehrer}
              maxLength={1000}
              rows={2}
              placeholder="z. B. Erika Mustermann"
            />
          )}
        </Field>
        <Field label="Vorsitz des Aufsichtsrats" hint="Nur, wenn die Gesellschaft einen Aufsichtsrat mit Vorsitz hat.">
          {(control) => <input {...control} name="aufsichtsratVorsitz" defaultValue={company.aufsichtsratVorsitz} maxLength={200} />}
        </Field>
      </div>
    </EinklappAbschnitt>
  );
}
