import { BUNDESLAENDER } from "@haben/core";
import type { loadCompany } from "../../server/modules/stammdaten/index.ts";
import { Field } from "../Field.tsx";

type Firma = Awaited<ReturnType<typeof loadCompany>>;

export function Unternehmen({
  company,
  email,
  onEmail,
  error,
}: {
  company: Firma;
  email: string;
  onEmail: (email: string) => void;
  error: (name: "email") => string | undefined;
}) {
  return (
    <section className="form-section" aria-labelledby="company-basics">
      <h3 id="company-basics">Unternehmen</h3>
      <div className="form-row cols-2">
        <Field label="Name">{(control) => <input {...control} name="name" defaultValue={company.name} autoComplete="organization" />}</Field>
        <Field label="Art des Betriebs (Anlage EÜR) bzw. Gegenstand des Unternehmens">
          {(control) => <input {...control} name="taetigkeit" defaultValue={company.taetigkeit} placeholder="z. B. Softwareentwicklung" maxLength={100} />}
        </Field>
      </div>
      <div className="form-row cols-2">
        <Field label="E-Mail" error={error("email")}>
          {(control) => <input {...control} name="email" type="email" value={email} onChange={(e) => onEmail(e.target.value)} autoComplete="email" />}
        </Field>
        <Field label="Telefon (Pflicht für XRechnung)">
          {(control) => <input {...control} name="telefon" type="tel" defaultValue={company.telefon} autoComplete="tel" />}
        </Field>
      </div>
      <Field label="Gründungsdatum" hint="Datum, an dem du deine unternehmerische Tätigkeit aufgenommen hast.">
        {(control) => <input {...control} name="foundedOn" type="date" min="0001-01-01" defaultValue={company.foundedOn ?? ""} />}
      </Field>
    </section>
  );
}

export function Anschrift({ company }: { company: Firma }) {
  return (
    <section className="form-section" aria-labelledby="company-address">
      <h3 id="company-address">Anschrift</h3>
      <Field label="Straße und Hausnummer">
        {(control) => <input {...control} name="strasse" defaultValue={company.strasse} autoComplete="street-address" />}
      </Field>
      <div className="form-row cols-place">
        <Field label="PLZ">{(control) => <input {...control} name="plz" defaultValue={company.plz} inputMode="numeric" autoComplete="postal-code" />}</Field>
        <Field label="Ort">{(control) => <input {...control} name="ort" defaultValue={company.ort} autoComplete="address-level2" />}</Field>
        <Field label="Bundesland">
          {(control) => (
            <select {...control} name="bundesland" defaultValue={company.bundesland ?? ""}>
              <option value="">Bitte wählen</option>
              {Object.entries(BUNDESLAENDER).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </section>
  );
}
