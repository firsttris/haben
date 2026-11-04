import { BILANZ_POSTEN, formatEuro, GUV_POSTEN, type Abschluss, type BilanzPosten, type GuvPosten, type Posten } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

const AKTIVA: BilanzPosten[] = ["aktiva.A", "aktiva.B", "aktiva.C", "aktiva.D", "aktiva.E"];
const PASSIVA: BilanzPosten[] = ["passiva.A", "passiva.B", "passiva.C", "passiva.D", "passiva.E"];
const ERTRAEGE: GuvPosten[] = ["umsatzerloese", "sonstigeErtraege"];
const AUFWAND: GuvPosten[] = ["materialaufwand", "personalaufwand", "abschreibungen", "sonstigeAufwendungen", "steuern"];

interface Props {
  year: number;
  report: Abschluss;
  names: Record<string, string>;
  /** Konten auf ihr Kontenblatt verlinken; nur für Buchungen aus dem Journal */
  kontoLinks: boolean;
}

/** Ein Posten mit aufklappbaren Konten */
function PostenRow({ year, report, names, kontoLinks, posten, label, amount }: Props & { posten: Posten; label: string; amount: number }) {
  const konten = report.konten[posten] ?? [];
  const [open, setOpen] = useState(false);
  const sign = posten.startsWith("aktiva.") || AUFWAND.includes(posten as GuvPosten) ? 1 : -1;
  return (
    <>
      <tr>
        <th scope="row">
          {konten.length > 0 ? (
            <button type="button" className="expand-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
              <span className={`chevron${open ? " open" : ""}`} aria-hidden="true">
                ›
              </span>{" "}
              {label}
            </button>
          ) : (
            label
          )}
        </th>
        <td className="num">{formatEuro(amount)}</td>
      </tr>
      {open &&
        konten.map((k) => (
          <tr key={k.account} className="lines-row">
            <td className="small">
              {kontoLinks ? (
                <Link to="/konten/$konto" params={{ konto: k.account }} search={{ jahr: year }} className="mono">
                  {k.account}
                </Link>
              ) : (
                <span className="mono">{k.account}</span>
              )}{" "}
              {names[k.account] ?? ""}
            </td>
            <td className="num small">{formatEuro(sign * k.saldo)}</td>
          </tr>
        ))}
    </>
  );
}

/** Bilanz und GuV der Kleinstkapitalgesellschaft (§ 266, § 275 Abs. 5 HGB) mit den Konten je Posten */
export function BilanzGuv(props: Props) {
  const { year, report } = props;
  const id = useId();
  const ergebnis = report.jahresergebnis >= 0 ? "8. Jahresüberschuss" : "8. Jahresfehlbetrag";
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
        <section className="card" aria-labelledby={`${id}-aktiva`}>
          <h2 id={`${id}-aktiva`} style={{ marginTop: 0 }}>
            Aktiva zum 31.12.{year}
          </h2>
          <table className="report-table">
            <tbody>
              {AKTIVA.filter((p) => report.bilanz[p] !== 0 || p === "aktiva.A" || p === "aktiva.B").map((p) => (
                <PostenRow key={p} {...props} posten={p} label={BILANZ_POSTEN[p]} amount={report.bilanz[p]} />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Summe Aktiva</th>
                <td className="num">{formatEuro(report.aktiva)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
        <section className="card" aria-labelledby={`${id}-passiva`}>
          <h2 id={`${id}-passiva`} style={{ marginTop: 0 }}>
            Passiva zum 31.12.{year}
          </h2>
          <table className="report-table">
            <tbody>
              {PASSIVA.filter((p) => report.bilanz[p] !== 0 || p === "passiva.A" || p === "passiva.C").map((p) => (
                <PostenRow key={p} {...props} posten={p} label={BILANZ_POSTEN[p]} amount={report.bilanz[p]} />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Summe Passiva</th>
                <td className="num">{formatEuro(report.passiva)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Das Eigenkapital enthält den {report.jahresergebnis >= 0 ? "Jahresüberschuss" : "Jahresfehlbetrag"} von{" "}
            {formatEuro(Math.abs(report.jahresergebnis))}.
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby={`${id}-guv`}>
        <h2 id={`${id}-guv`} style={{ marginTop: 0 }}>
          Gewinn- und Verlustrechnung {year} (§ 275 Abs. 5 HGB)
        </h2>
        <table className="report-table">
          <tbody>
            {[...ERTRAEGE, ...AUFWAND].map((p) => (
              <PostenRow key={p} {...props} posten={p} label={GUV_POSTEN[p]} amount={AUFWAND.includes(p) ? -report.guv[p] : report.guv[p]} />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{ergebnis}</th>
              <td className="num">{formatEuro(report.jahresergebnis)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </>
  );
}
