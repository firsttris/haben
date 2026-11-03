import { BILANZ_POSTEN, formatEuro, GUV_POSTEN, type BilanzPosten, type GuvPosten, type Posten } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import { Ebilanz } from "../../../components/Ebilanz.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { closeYearFn, getJahresabschluss } from "../../../server/functions/abschluss.ts";
import styles from "../../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/abschluss/$jahr")({
  loader: ({ params }) => {
    const year = Number(params.jahr);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw notFound();
    return getJahresabschluss({ data: year });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Jahresabschluss ${loaderData?.year ?? ""} · Haben` }], links: [{ rel: "stylesheet", href: styles }] }),
  component: AbschlussPage,
});

type Data = Awaited<ReturnType<typeof getJahresabschluss>>;
type Kapitalgesellschaft = Extract<Data, { kapitalgesellschaft: true }>;

const AKTIVA: BilanzPosten[] = ["aktiva.A", "aktiva.B", "aktiva.C", "aktiva.D", "aktiva.E"];
const PASSIVA: BilanzPosten[] = ["passiva.A", "passiva.B", "passiva.C", "passiva.D", "passiva.E"];
const ERTRAEGE: GuvPosten[] = ["umsatzerloese", "sonstigeErtraege"];
const AUFWAND: GuvPosten[] = ["materialaufwand", "personalaufwand", "abschreibungen", "sonstigeAufwendungen", "steuern"];

function AbschlussPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const selectId = useId();
  const thisYear = new Date().getFullYear();
  const years = [...new Set([data.year, thisYear, thisYear - 1, thisYear - 2])].sort((a, b) => b - a);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jahresabschluss</div>
          <h1>Geschäftsjahr {data.year}</h1>
        </div>
        <label className="field" htmlFor={selectId}>
          Jahr
          <select id={selectId} value={data.year} onChange={(e) => navigate({ to: "/abschluss/$jahr", params: { jahr: e.target.value } })}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data.kapitalgesellschaft ? (
        <Report data={data} />
      ) : (
        <p className="muted" style={{ maxWidth: 760 }}>
          Einen Jahresabschluss mit Bilanz gibt es für GmbH und UG. Im Einzelunternehmen ermittelt Haben den Gewinn mit der Anlage EÜR unter{" "}
          <Link to="/jahreserklaerung">Jahreserklärung</Link>.
        </p>
      )}
    </>
  );
}

/** Ein Posten mit aufklappbaren Konten */
function PostenRow({ data, posten, label, amount }: { data: Kapitalgesellschaft; posten: Posten; label: string; amount: number }) {
  const konten = data.report.konten[posten] ?? [];
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
              <Link to="/konten/$konto" params={{ konto: k.account }} search={{ jahr: data.year }} className="mono">
                {k.account}
              </Link>{" "}
              {data.names[k.account] ?? ""}
            </td>
            <td className="num small">{formatEuro(sign * k.saldo)}</td>
          </tr>
        ))}
    </>
  );
}

function Report({ data }: { data: Kapitalgesellschaft }) {
  const { report } = data;
  const router = useRouter();
  const close = useServerFn(closeYearFn);
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const blocking = data.issues.filter((i) => i.tone === "fehler");
  const ergebnis = report.jahresergebnis >= 0 ? "8. Jahresüberschuss" : "8. Jahresfehlbetrag";

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="banner banner-info" role="note">
        <Icon name="info" />
        <span>
          Entwurf für die Steuerberatung: Bilanz und GuV einer Kleinstkapitalgesellschaft (§ 267a HGB) aus den Buchungen, die Posten nach dem
          DATEV-Kontenrahmen. Rückstellungen, Abgrenzungen und Steuern bucht ihr vorher als manuelle Buchung; die Bewertung bleibt Sache der Steuerberatung.
        </span>
      </div>

      {data.issues.length > 0 && (
        <section className="card" aria-labelledby="issues-heading">
          <h2 id="issues-heading" style={{ marginTop: 0 }}>
            Offene Punkte
          </h2>
          <ul className="stack" style={{ margin: 0, gap: 4 }}>
            {data.issues.map((i) => (
              <li key={i.text}>
                {i.tone === "fehler" ? "Vor dem Abschluss: " : ""}
                {i.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
        <section className="card" aria-labelledby="aktiva-heading">
          <h2 id="aktiva-heading" style={{ marginTop: 0 }}>
            Aktiva zum 31.12.{data.year}
          </h2>
          <table className="report-table">
            <tbody>
              {AKTIVA.filter((p) => report.bilanz[p] !== 0 || p === "aktiva.A" || p === "aktiva.B").map((p) => (
                <PostenRow key={p} data={data} posten={p} label={BILANZ_POSTEN[p]} amount={report.bilanz[p]} />
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
        <section className="card" aria-labelledby="passiva-heading">
          <h2 id="passiva-heading" style={{ marginTop: 0 }}>
            Passiva zum 31.12.{data.year}
          </h2>
          <table className="report-table">
            <tbody>
              {PASSIVA.filter((p) => report.bilanz[p] !== 0 || p === "passiva.A" || p === "passiva.C").map((p) => (
                <PostenRow key={p} data={data} posten={p} label={BILANZ_POSTEN[p]} amount={report.bilanz[p]} />
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

      <section className="card" aria-labelledby="guv-heading">
        <h2 id="guv-heading" style={{ marginTop: 0 }}>
          Gewinn- und Verlustrechnung {data.year} (§ 275 Abs. 5 HGB)
        </h2>
        <table className="report-table">
          <tbody>
            {[...ERTRAEGE, ...AUFWAND].map((p) => (
              <PostenRow key={p} data={data} posten={p} label={GUV_POSTEN[p]} amount={AUFWAND.includes(p) ? -report.guv[p] : report.guv[p]} />
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

      <section className="card" aria-labelledby="close-heading">
        <h2 id="close-heading" style={{ marginTop: 0 }}>
          Jahr abschließen
        </h2>
        {data.status ? (
          <p style={{ margin: 0 }}>
            Abgeschlossen am {formatDateTime(data.status.closedAt)} mit {data.status.entries} Buchungen.{" "}
            {data.status.intact ? (
              "Die Buchungen sind seitdem unverändert."
            ) : (
              <strong>Die Buchungen des Jahres wurden seitdem an Haben vorbei geändert.</strong>
            )}
          </p>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: 0, maxWidth: 760 }}>
              Danach nimmt das Jahr keine Buchung mehr an, auch keine Korrektur; das lässt sich nicht rückgängig machen. Haben hält Zahl und Prüfwert der
              Buchungen fest und zeigt hier, ob sie unverändert sind. Schließe erst ab, wenn die Steuerberatung den Abschluss freigegeben hat.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || blocking.length > 0}
              onClick={() =>
                confirming
                  ? void run(async () => {
                      await close({ data: { year: data.year } });
                      await router.invalidate();
                    }, `Das Jahr ${data.year} ist abgeschlossen.`)
                  : setConfirming(true)
              }
            >
              {confirming ? `Jetzt ${data.year} endgültig abschließen` : `${data.year} abschließen`}
            </button>
          </>
        )}
        <NoticeBanner notice={notice} />
      </section>

      {data.ebilanz && <Ebilanz year={data.year} ebilanz={data.ebilanz} setup={data.elster} closed={Boolean(data.status)} />}
    </div>
  );
}
