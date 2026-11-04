import { formatEuro, type KapgSteuern } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import type { getDatevBookings } from "../../server/functions/archive.ts";
import { BilanzGuv } from "../BilanzGuv.tsx";
import { Icon } from "../Icon.tsx";

type Data = NonNullable<Awaited<ReturnType<typeof getDatevBookings>>["abschluss"]>;

const VORTRAG: Record<Data["vortrag"], string> = {
  stapel: "Die Bestände zum Jahresbeginn kommen aus den Eröffnungsbuchungen im Stapel (9000 bis 9009).",
  vorjahre:
    "Die Bestände zum Jahresbeginn sind aus den Stapeln der Vorjahre vorgetragen, das Ergebnis der Vorjahre steht als Gewinn- oder Verlustvortrag im Eigenkapital.",
  keiner: "Ohne Eröffnungsbuchungen und ohne Stapel aus den Vorjahren fehlen die Bestände zum Jahresbeginn.",
};

function Steuern({ year, steuern }: { year: number; steuern: KapgSteuern }) {
  const id = useId();
  const rows: [string, number, boolean?][] = [
    ["Jahresergebnis", steuern.jahresergebnis],
    ["Hinzurechnungen", steuern.einkommen - steuern.jahresergebnis],
    ["Einkommen", steuern.einkommen],
    ["Zu versteuerndes Einkommen", steuern.zvE],
    ["Körperschaftsteuer", steuern.kst, true],
    ["Solidaritätszuschlag", steuern.soli, true],
    ["Gewerbeertrag", steuern.gewerbeertrag],
    ["Gewerbesteuer", steuern.gewst, true],
  ];
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id} style={{ marginTop: 0 }}>
        Körperschaft- und Gewerbesteuer {year}
      </h2>
      <table className="report-table">
        <tbody>
          {rows.map(([label, betrag, strong]) => (
            <tr key={label}>
              <th scope="row" style={strong ? { fontWeight: 600 } : undefined}>
                {label}
              </th>
              <td className="num" style={strong ? { fontWeight: 600 } : undefined}>
                {formatEuro(betrag)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Mit Hebesatz und Verlustvorträgen aus{" "}
        <Link to="/abschluss/$jahr" params={{ jahr: String(year) }}>
          Jahresabschluss {year}
        </Link>
        .
      </p>
    </section>
  );
}

/** Bilanz, GuV und Steuern eines Jahres aus dem DATEV-Stapel, zum Vergleich mit dem Abschluss der Steuerberatung */
export function DatevAbschluss({ data }: { data: Data }) {
  const id = useId();
  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="card stack" aria-labelledby={id}>
        <h2 id={id} style={{ margin: 0 }}>
          Abschluss aus dem DATEV-Stapel {data.year}
        </h2>
        <div className="banner banner-info" role="note">
          <Icon name="info" />
          <span>
            Bilanz, GuV und Steuern aus den archivierten Buchungen, gerechnet wie der Jahresabschluss in Haben. Zum Vergleich mit dem Abschluss der
            Steuerberatung; gebucht wird nichts. {VORTRAG[data.vortrag]}
          </span>
        </div>
        {data.issues.length > 0 && (
          <ul className="stack" style={{ margin: 0, gap: 4 }}>
            {data.issues.map((i) => (
              <li key={i.text}>{i.text}</li>
            ))}
          </ul>
        )}
      </section>
      <BilanzGuv year={data.year} report={data.report} names={data.names} kontoLinks={false} />
      {data.steuern && <Steuern year={data.year} steuern={data.steuern} />}
    </div>
  );
}
