/**
 * Zeile einer Betragstabelle; kz = Feldkennung, extra = Zusatzspalte (Bemessungsgrundlage),
 * text = Wert ist Text statt Betrag. Die data-label beschriften die Werte, wenn die Tabelle auf dem Handy gestapelt ist.
 */
export function Row({ label, kz, value, extra, total, text }: { label: string; kz?: string; value: string; extra?: string; total?: boolean; text?: boolean }) {
  return (
    <tr style={total ? { fontWeight: 600 } : undefined}>
      <th scope="row" style={total ? { fontWeight: 600 } : undefined}>
        {label}
        {kz && <span className="small muted mono"> {kz}</span>}
      </th>
      {extra !== undefined && (
        <td className="num" data-label="Bemessung">
          {extra}
        </td>
      )}
      <td
        className={text ? undefined : "num"}
        style={text ? { textAlign: "right" } : undefined}
        data-label={extra !== undefined ? "Steuer" : text ? undefined : "Betrag"}
      >
        {value}
      </td>
    </tr>
  );
}
