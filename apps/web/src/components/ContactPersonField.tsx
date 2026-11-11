import { Field } from "./Field.tsx";

export interface ContactPersonChoice {
  id: string;
  name: string;
  deactivated: boolean;
}

/**
 * Auswahl des Ansprechpartners im Entwurf von Rechnung und Angebot (#424); steht nur da, wenn der Kunde Personen hat.
 * Eine schon gewählte, inzwischen deaktivierte Person bleibt in der Liste, neu wählbar sind nur aktive.
 */
export function ContactPersonField({
  choices,
  value,
  disabled,
  onChange,
}: {
  choices: ContactPersonChoice[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <Field
      label="Ansprechpartner"
      hint="Steht im PDF als „z. Hd.“ unter dem Firmennamen und in der E-Rechnung als Ansprechpartner des Käufers. Die Personen pflegst du am Kontakt."
      style={{ gridColumn: "1 / -1" }}
    >
      {(control) => (
        <select {...control} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Keiner</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.deactivated ? " (deaktiviert)" : ""}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
