import { addDays, datumText, monatsname } from "@haben/core";
import {
  alleMeldungen,
  beitragsnachweiseImMonat,
  beitragsnachweisTitel,
  type ListenDaten,
  listenDaten,
  ohneSozialversicherung,
  startMonat,
  werteVon,
} from "./liste.ts";
import { listVermerke, type Vermerk, vermerkStand } from "./vermerke.ts";

/*
 * Seite Personal › SV-Meldeportal und die Fristen dazu. Ein Beitragsnachweis oder eine Meldung ist erledigt, sobald ein
 * gültiger Vermerk „im Portal abgegeben“ vorliegt; ob die Werte seitdem anders sind, steht daneben.
 */

const schluessel = (jahr: number, monat: number) => `${jahr}-${String(monat).padStart(2, "0")}`;

/** Ausfüllliste eines Monats mit dem Stand der Vermerke */
export async function ausfuellliste(jahr: number, monat: number, heute: string) {
  const [d, vermerke] = await Promise.all([listenDaten(), listVermerke()]);
  const monatKey = schluessel(jahr, monat);
  const beitragsnachweise = beitragsnachweiseImMonat(d, jahr, monat).map((b) => ({
    ...b,
    titel: beitragsnachweisTitel(b),
    stand: vermerkStand(vermerke, b.gegenstand, werteVon(b)),
  }));
  const alle = alleMeldungen(d, Math.max(jahr, Number(heute.slice(0, 4)))).map((m) => ({ ...m, stand: vermerkStand(vermerke, m.gegenstand, werteVon(m)) }));
  const start = startMonat(d, heute);
  const offenAnderswo = alle
    .filter((m) => m.frist && !m.stand.abgegeben && m.anlass.slice(0, 7) !== monatKey && m.anlass.slice(0, 7) >= start && m.anlass <= heute)
    .map((m) => ({ gegenstand: m.gegenstand, titel: m.titel, frist: m.frist!, jahr: Number(m.anlass.slice(0, 4)), monat: Number(m.anlass.slice(5, 7)) }));
  return {
    jahr,
    monat,
    name: monatsname(jahr, monat),
    beitragsnachweise,
    meldungen: alle.filter((m) => m.anlass.slice(0, 7) === monatKey),
    offenAnderswo,
    ohneSv: ohneSozialversicherung(d),
    start,
  };
}

export interface SvFrist {
  id: string;
  datum: string;
  titel: string;
  detail: string;
  erledigt: boolean;
  link: string;
}

const link = (jahr: number, monat: number) => `/sv-meldeportal?jahr=${jahr}&monat=${monat}`;

function beitragsnachweisFristen(d: ListenDaten, vermerke: Vermerk[], start: string, bis: string): SvFrist[] {
  const fristen: SvFrist[] = [];
  for (let [j, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))]; schluessel(j, m) <= bis.slice(0, 7); [j, m] = m === 12 ? [j + 1, 1] : [j, m + 1]) {
    for (const b of beitragsnachweiseImMonat(d, j, m)) {
      fristen.push({
        id: `svbn-${schluessel(j, m)}-${b.einzugsstelle.betriebsnummer}`,
        datum: b.termine.nachweisBis,
        titel: beitragsnachweisTitel(b),
        detail: `Im SV-Meldeportal abgeben; muss am ${datumText(b.termine.nachweisVorliegen)} um 0 Uhr vorliegen, Beiträge fällig am ${datumText(b.termine.faelligkeit)}`,
        erledigt: vermerkStand(vermerke, b.gegenstand, werteVon(b)).abgegeben,
        link: link(j, m),
      });
    }
  }
  return fristen;
}

/**
 * Fristen für Beitragsnachweise und DEÜV-Meldungen ab dem ersten Lohnlauf in Haben (sonst ab dem laufenden Monat) bis
 * `bis`. Die Sofortmeldung fehlt: Ob sie nötig ist, hängt am Wirtschaftszweig, den Haben nicht kennt.
 */
export async function svFristen(heute: string, bis = addDays(heute, 365)): Promise<SvFrist[]> {
  const [d, vermerke] = await Promise.all([listenDaten(), listVermerke()]);
  if (d.mitarbeiter.length === 0) return [];
  const start = startMonat(d, heute);
  const meldungen = alleMeldungen(d, Number(bis.slice(0, 4)))
    .filter((m) => m.frist && m.anlass.slice(0, 7) >= start)
    .map((m) => ({
      id: `sv-${m.gegenstand}`,
      datum: m.frist!,
      titel: m.titel,
      detail: `${m.formular.replace("SV-Meldungen › ", "")}; im SV-Meldeportal abgeben`,
      erledigt: vermerkStand(vermerke, m.gegenstand, werteVon(m)).abgegeben,
      link: link(Number(m.anlass.slice(0, 4)), Number(m.anlass.slice(5, 7))),
    }));
  return [...beitragsnachweisFristen(d, vermerke, start, bis), ...meldungen];
}
