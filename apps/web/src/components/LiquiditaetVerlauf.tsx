import {
  HORIZONTE,
  LIQUIDITAET_QUELLEN,
  MONTHS,
  SICHERHEITEN,
  formatEuro,
  wirkung,
  type LiquiditaetsPosten,
  type Vorschau,
  type ZeitraumStand,
} from "@haben/core";
import { Link } from "@tanstack/react-router";
import { formatDate } from "../lib/format.ts";
import { siehtSeite } from "../lib/rollen.ts";
import { Icon } from "./Icon.tsx";
import { ScrollTable } from "./ScrollTable.tsx";
import { Tag } from "./Status.tsx";

/*
 * Tabelle der Liquiditätsvorschau (#1381): je Woche bzw. Monat Anfang, Eingänge, Ausgänge, Ende und tiefster Stand; der
 * Zeitraum mit dem Tiefpunkt ist hervorgehoben. Ein Zeitraum klappt seine Posten auf, mit Sicherheit und Link zur Quelle.
 * Die Tabelle trägt alles, was die Kurve zeigt, damit die Seite ohne Diagramm bedienbar ist.
 */

const kurz = (datum: string) => formatDate(datum).slice(0, 6);

/** „20.11.–22.11.“ je Woche, „Dezember 2026“ für einen ganzen Monat, angeschnitten „20.11.–30.11.2026“ */
export function zeitraumText({ von, bis }: Pick<ZeitraumStand, "von" | "bis">, raster: "woche" | "monat"): string {
  const monatsende = new Date(Date.UTC(Number(bis.slice(0, 4)), Number(bis.slice(5, 7)), 0)).getUTCDate() === Number(bis.slice(8));
  if (raster === "monat" && von.endsWith("-01") && monatsende) return `${MONTHS[Number(von.slice(5, 7)) - 1]} ${von.slice(0, 4)}`;
  return raster === "woche" ? `${kurz(von)}–${kurz(bis)}` : `${kurz(von)}–${formatDate(bis)}`;
}

/** Betrag, negativ in der Farbe für Gefahr */
function Betrag({ cent }: { cent: number }) {
  return <span className={cent < 0 ? "betrag-negativ" : undefined}>{formatEuro(cent)}</span>;
}

/** Link auf die Quelle eines Postens; was die Rolle nicht öffnen kann, steht als Text */
function QuelleLink({ posten, rolle }: { posten: LiquiditaetsPosten; rolle: string }) {
  const { art, id } = posten.quelle;
  const text = posten.text;
  const ziel = (pfad: string) => siehtSeite(rolle, pfad);
  switch (art) {
    case "rechnung":
      return ziel(`/rechnungen/${id}`) ? (
        <Link to="/rechnungen/$id" params={{ id }}>
          {text}
        </Link>
      ) : (
        text
      );
    case "beleg":
      return ziel(`/belege/${id}`) ? (
        <Link to="/belege/$id" params={{ id }}>
          {text}
        </Link>
      ) : (
        text
      );
    case "dauerbeleg":
      return ziel(`/dauerbelege/${id}`) ? (
        <Link to="/dauerbelege/$id" params={{ id }}>
          {text}
        </Link>
      ) : (
        text
      );
    case "wiederkehrend":
      return ziel(`/rechnungen/wiederkehrend/${id}`) ? (
        <Link to="/rechnungen/wiederkehrend/$id" params={{ id }}>
          {text}
        </Link>
      ) : (
        text
      );
    case "voranmeldung":
    case "umsatzsteuer":
      return ziel(`/umsatzsteuer/${id}`) ? (
        <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: id }}>
          {text}
        </Link>
      ) : (
        text
      );
    case "sondervorauszahlung":
      return ziel("/umsatzsteuer") ? <Link to="/umsatzsteuer">{text}</Link> : text;
    case "vorauszahlung":
      // Fortgeschrieben: die letzte Zahlung im Bankabgleich; geschätzt: die Prognose beim Finanzamt
      if (/^\d{4}$/.test(id)) return ziel("/finanzamt") ? <Link to="/finanzamt">{text}</Link> : text;
      return ziel("/bank") ? (
        <Link to="/bank" search={{ umsatz: id, konto: "alle", filter: "alle" }}>
          {text}
        </Link>
      ) : (
        text
      );
  }
}

function PostenListe({ zeitraum, raster, rolle }: { zeitraum: ZeitraumStand; raster: "woche" | "monat"; rolle: string }) {
  return (
    <table className="report-table liq-posten">
      <caption className="visually-hidden">Posten {zeitraumText(zeitraum, raster)}</caption>
      <thead>
        <tr>
          <th scope="col">Datum</th>
          <th scope="col">Posten</th>
          <th scope="col">Sicherheit</th>
          <th scope="col" className="num">
            Betrag
          </th>
        </tr>
      </thead>
      <tbody>
        {zeitraum.posten.map((p, i) => (
          <tr key={`${p.quelle.art}-${p.quelle.id}-${p.datum}-${i}`}>
            <td>{formatDate(p.datum)}</td>
            <td>
              <span className="small muted">{LIQUIDITAET_QUELLEN[p.quelle.art]}</span> <QuelleLink posten={p} rolle={rolle} />
            </td>
            <td>
              <Tag>{SICHERHEITEN[p.sicherheit]}</Tag>
              {p.privat && (
                <>
                  {" "}
                  <Tag>privat</Tag>
                </>
              )}
              {p.ueberfaellig && (
                <>
                  {" "}
                  <Tag>überfällig</Tag>
                </>
              )}
            </td>
            <td className="num">
              <Betrag cent={wirkung(p)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ZeitraumZeile({ z, raster, offen, tiefpunkt }: { z: ZeitraumStand; raster: "woche" | "monat"; offen: boolean; tiefpunkt: boolean }) {
  const text = zeitraumText(z, raster);
  return (
    <tr className={tiefpunkt ? "liq-tief" : undefined}>
      <th scope="row">
        {z.posten.length > 0 ? (
          <Link
            from="/auswertungen/liquiditaet"
            search={(s) => ({ ...s, zeitraum: offen ? undefined : z.von })}
            hash={offen ? undefined : `posten-${z.von}`}
            aria-expanded={offen}
            className="liq-umschalter"
          >
            <Icon name={offen ? "chevron-down" : "chevron-right"} size={16} />
            {text}
            <span className="small muted">{z.posten.length} Posten</span>
          </Link>
        ) : (
          <span className="liq-ohne">{text}</span>
        )}
      </th>
      <td className="num">
        <Betrag cent={z.anfang} />
      </td>
      <td className="num">{z.eingaenge === 0 ? "–" : formatEuro(z.eingaenge)}</td>
      <td className="num">{z.ausgaenge === 0 ? "–" : formatEuro(-z.ausgaenge)}</td>
      <td className="num">
        <Betrag cent={z.ende} />
      </td>
      <td className="num">
        {tiefpunkt && <Tag>Tiefpunkt</Tag>} <Betrag cent={z.tiefpunkt.stand} />
        <div className="small muted">am {kurz(z.tiefpunkt.datum)}</div>
      </td>
    </tr>
  );
}

/** Verlauf je Woche bzw. Monat; `offen` ist der Beginn des aufgeklappten Zeitraums */
export function LiquiditaetVerlauf({ vorschau, offen, rolle }: { vorschau: Vorschau; offen: string | undefined; rolle: string }) {
  const raster = HORIZONTE[vorschau.horizont].raster;
  const tief = vorschau.zeitraeume.find((z) => z.von <= vorschau.tiefpunkt.datum && vorschau.tiefpunkt.datum <= z.bis);
  return (
    <ScrollTable className="report-table liq-table">
      <caption className="visually-hidden">Liquiditätsvorschau {HORIZONTE[vorschau.horizont].label}</caption>
      <thead>
        <tr>
          <th scope="col">{raster === "woche" ? "Woche" : "Monat"}</th>
          <th scope="col" className="num">
            Anfang
          </th>
          <th scope="col" className="num">
            Eingänge
          </th>
          <th scope="col" className="num">
            Ausgänge
          </th>
          <th scope="col" className="num">
            Ende
          </th>
          <th scope="col" className="num">
            Tiefster Stand
          </th>
        </tr>
      </thead>
      <tbody>
        {vorschau.zeitraeume.map((z) => (
          <ZeitraumBlock key={z.von} z={z} raster={raster} offen={offen === z.von} tiefpunkt={z === tief} rolle={rolle} />
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Gesamt</th>
          <td className="num">
            <Betrag cent={vorschau.start} />
          </td>
          <td className="num">{formatEuro(vorschau.eingaenge)}</td>
          <td className="num">{formatEuro(-vorschau.ausgaenge)}</td>
          <td className="num">
            <Betrag cent={vorschau.ende} />
          </td>
          <td className="num">
            <Betrag cent={vorschau.tiefpunkt.stand} />
          </td>
        </tr>
      </tfoot>
    </ScrollTable>
  );
}

function ZeitraumBlock({
  z,
  raster,
  offen,
  tiefpunkt,
  rolle,
}: {
  z: ZeitraumStand;
  raster: "woche" | "monat";
  offen: boolean;
  tiefpunkt: boolean;
  rolle: string;
}) {
  return (
    <>
      <ZeitraumZeile z={z} raster={raster} offen={offen} tiefpunkt={tiefpunkt} />
      {offen && (
        <tr className="liq-aufgeklappt">
          <td colSpan={6} id={`posten-${z.von}`}>
            <PostenListe zeitraum={z} raster={raster} rolle={rolle} />
          </td>
        </tr>
      )}
    </>
  );
}
