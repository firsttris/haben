/** Bestellnummer des Kunden, eigene Auftragsnummer und Lieferschein (BT-13, BT-14, BT-16; #389) */
export interface OrderReferenceValues {
  buyerOrderReference: string;
  sellerOrderReference: string;
  despatchAdviceReference: string;
}

export function orderReferenceValues(initial: Partial<Record<keyof OrderReferenceValues, string | undefined>>): OrderReferenceValues {
  return {
    buyerOrderReference: initial.buyerOrderReference ?? "",
    sellerOrderReference: initial.sellerOrderReference ?? "",
    despatchAdviceReference: initial.despatchAdviceReference ?? "",
  };
}

/** Felder für die drei Referenzen im Abschnitt mit den Kopfdaten von Rechnung und Angebot; Teil eines .form-grid */
export function OrderReferenceFields({
  value,
  onChange,
  disabled = false,
}: {
  value: OrderReferenceValues;
  onChange: (value: OrderReferenceValues) => void;
  disabled?: boolean;
}) {
  const set = (key: keyof OrderReferenceValues) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  return (
    <>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        Bestellnummer (optional)
        <input
          value={value.buyerOrderReference}
          onChange={set("buyerOrderReference")}
          maxLength={100}
          disabled={disabled}
          autoComplete="off"
          aria-describedby="buyer-order-hint"
        />
        <span id="buyer-order-hint" className="small">
          Im PDF als „Ihre Bestellung“, in der E-Rechnung als BT-13. Viele große Auftraggeber weisen Rechnungen ohne Bestellnummer zurück.
        </span>
      </label>
      <label className="field">
        Eigene Auftragsnummer (optional)
        <input value={value.sellerOrderReference} onChange={set("sellerOrderReference")} maxLength={100} disabled={disabled} autoComplete="off" />
      </label>
      <label className="field">
        Lieferscheinnummer (optional)
        <input value={value.despatchAdviceReference} onChange={set("despatchAdviceReference")} maxLength={100} disabled={disabled} autoComplete="off" />
      </label>
    </>
  );
}
