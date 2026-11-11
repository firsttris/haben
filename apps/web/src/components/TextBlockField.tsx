import { FormattedTextarea } from "./FormattedTextarea.tsx";
import { Field } from "./Field.tsx";

/** Textbaustein zum Einfügen: Kopftext (Einleitung) oder Fußtext (Hinweis) */
export interface TextBlockOption {
  id: string;
  name: string;
  kind: "kopf" | "fuss";
  text: string;
  /** Kunde, zu dem der Baustein gehört; null = für alle */
  contactId: string | null;
}

/** Bausteine einer Art; die des gewählten Kunden zuerst, dann die allgemeinen, dann die anderer Kunden */
export function blocksFor(blocks: TextBlockOption[], kind: TextBlockOption["kind"], contactId: string | null) {
  const ofKind = blocks.filter((b) => b.kind === kind);
  return {
    customer: contactId ? ofKind.filter((b) => b.contactId === contactId) : [],
    general: ofKind.filter((b) => b.contactId === null),
    other: ofKind.filter((b) => b.contactId !== null && b.contactId !== contactId),
  };
}

/** Text eines Bausteins einfügen: in ein leeres Feld direkt, sonst als neuer Absatz dahinter */
export function insertBlock(current: string, text: string): string {
  return current.trim() === "" ? text : `${current.replace(/\s+$/, "")}\n\n${text}`;
}

/**
 * Textfeld mit Auswahl „Textbaustein einfügen“. Eingefügt wird eine Kopie des Textes; sie bleibt frei
 * änderbar, und spätere Änderungen am Baustein wirken nicht auf den Beleg.
 */
export function TextBlockField({
  label,
  kind,
  value,
  onChange,
  blocks,
  contactId,
  placeholder,
}: {
  label: string;
  kind: TextBlockOption["kind"];
  value: string;
  onChange: (value: string) => void;
  blocks: TextBlockOption[];
  contactId: string | null;
  placeholder?: string;
}) {
  const { customer, general, other } = blocksFor(blocks, kind, contactId);
  const any = customer.length + general.length + other.length > 0;
  const options = (list: TextBlockOption[]) =>
    list.map((b) => (
      <option key={b.id} value={b.id}>
        {b.name}
      </option>
    ));
  return (
    <div className="field-group">
      <Field label={label}>
        {(control) => <FormattedTextarea {...control} value={value} onChange={(e) => onChange(e.target.value)} maxLength={2000} placeholder={placeholder} />}
      </Field>
      {any && (
        <Field
          label={`${kind === "kopf" ? "Kopftext" : "Fußtext"} aus den Textbausteinen einfügen`}
          hideLabel
          style={{ alignSelf: "flex-start", maxWidth: "100%" }}
        >
          {(control) => (
            <select
              {...control}
              value=""
              onChange={(e) => {
                const block = blocks.find((b) => b.id === e.target.value);
                if (block) onChange(insertBlock(value, block.text));
                e.target.value = "";
              }}
            >
              <option value="">Textbaustein einfügen …</option>
              {customer.length > 0 && <optgroup label="Für diesen Kunden">{options(customer)}</optgroup>}
              {general.length > 0 && <optgroup label="Für alle Kunden">{options(general)}</optgroup>}
              {other.length > 0 && <optgroup label="Andere Kunden">{options(other)}</optgroup>}
            </select>
          )}
        </Field>
      )}
    </div>
  );
}
