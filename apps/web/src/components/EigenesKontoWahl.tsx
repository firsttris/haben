import { Field } from "./Field.tsx";

/** Ein eigenes Sachkonto zur Auswahl (#270): Nummer, Name und die Kategorie, die es erbt */
export interface OwnAccountChoice {
  id: string;
  account: string;
  name: string;
  parentCategory: string;
  archived: boolean;
}

/**
 * Auswahl eines eigenen Kontos zu einer Kategorie: nur Konten, deren Elternkategorie die gewählte ist. Ein archiviertes
 * steht nur zur Wahl, wenn der Beleg es schon hat. Ohne passendes Konto erscheint nichts. Leer heißt: das Konto der Kategorie.
 */
export function EigenesKontoWahl({
  accounts,
  category,
  value,
  onChange,
  style,
}: {
  accounts: OwnAccountChoice[];
  category: string;
  value: string;
  onChange: (id: string) => void;
  style?: React.CSSProperties;
}) {
  const options = accounts.filter((a) => a.parentCategory === category && (!a.archived || a.id === value));
  if (category === "" || options.length === 0) return null;
  return (
    <Field label="Eigenes Konto" hint="Leer: das Konto der Kategorie. Umsatzsteuer und EÜR ändern sich dadurch nicht." style={style}>
      {(control) => (
        <select {...control} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Konto der Kategorie</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.account} {a.name}
              {a.archived ? " (archiviert)" : ""}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Das Konto bleibt nur gewählt, wenn es zur (neuen) Kategorie passt */
export const passendesKonto = (accounts: OwnAccountChoice[], category: string, id: string): string =>
  accounts.some((a) => a.id === id && a.parentCategory === category) ? id : "";
