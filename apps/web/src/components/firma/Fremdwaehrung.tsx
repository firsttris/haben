import { useState } from "react";
import { EinklappAbschnitt } from "./EinklappAbschnitt.tsx";
import { fremdwaehrungKurz } from "./kurzwerte.ts";

export function Fremdwaehrung({ tageskurs, offen, onOffen }: { tageskurs: boolean; offen: boolean; onOffen: (offen: boolean) => void }) {
  const [gewaehlt, setGewaehlt] = useState(tageskurs);
  return (
    <EinklappAbschnitt id="company-currency" titel="Fremdwährung" kurz={fremdwaehrungKurz(gewaehlt)} offen={offen} onOffen={onOffen}>
      <div className="checkbox-hinted">
        <label className="checkbox">
          <input
            type="checkbox"
            name="tageskurs"
            checked={gewaehlt}
            onChange={(event) => setGewaehlt(event.target.checked)}
            aria-describedby="tageskurs-hint"
          />
          <span>Tageskurs statt USt-Umrechnungskurs (vom Finanzamt gestattet)</span>
        </label>
        <span id="tageskurs-hint" className="field-hint">
          Ohne Gestattung rechnet Haben Fremdwährung mit den monatlichen Umsatzsteuer-Umrechnungskursen des BMF um (§ 16 Abs. 6 UStG). Hat das Finanzamt den
          Tageskurs gestattet, trägst du an Beleg und Rechnung den Kurs mit Kursdatum ein, etwa aus der Bankabrechnung.
        </span>
      </div>
    </EinklappAbschnitt>
  );
}
