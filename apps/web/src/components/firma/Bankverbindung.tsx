import type { loadCompany } from "../../server/modules/stammdaten/index.ts";
import { Field } from "../Field.tsx";

type Firma = Awaited<ReturnType<typeof loadCompany>>;

export function Bankverbindung({ company }: { company: Firma }) {
  return (
    <section className="form-section" aria-labelledby="company-bank">
      <h3 id="company-bank">Bankverbindung</h3>
      <Field label="IBAN">
        {(control) => <input {...control} name="iban" defaultValue={company.iban} placeholder="DE00 0000 0000 0000 0000 00" className="mono" />}
      </Field>
      <Field
        label="Kontoinhaber"
        hint={
          <>
            Nur nötig, wenn das Konto nicht auf den Firmennamen läuft, z. B. auf dich als Person. Steht im GiroCode und in der E-Rechnung; die Bank des Kunden
            vergleicht ihn beim Überweisen mit dem Inhaber des Kontos.
          </>
        }
      >
        {(control) => <input {...control} name="kontoinhaber" defaultValue={company.kontoinhaber} maxLength={70} placeholder={company.name} />}
      </Field>
      <div className="form-row cols-2">
        <Field label="Bank">{(control) => <input {...control} name="bank" defaultValue={company.bank} />}</Field>
        <Field label="BIC">{(control) => <input {...control} name="bic" defaultValue={company.bic} className="mono" />}</Field>
      </div>
      <Field
        label="Gläubiger-ID"
        hint={
          <>
            Nur für SEPA-Lastschriften nötig. Die Bundesbank vergibt sie auf Antrag; sie steht auf jedem Mandat und auf der Rechnung, die per Lastschrift
            eingezogen wird.
          </>
        }
      >
        {(control) => <input {...control} name="glaeubigerId" defaultValue={company.glaeubigerId} placeholder="DE98ZZZ09999999999" className="mono" />}
      </Field>
    </section>
  );
}
