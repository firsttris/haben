/*
 * Lohnsteuer-PAP und Einkommensteuertarif. Quelle ist das amtliche PAP-XML des BMF-Steuerrechners
 * (https://www.bmf-steuerrechner.de/javax.faces.resource/daten/xmls/Lohnsteuer<Jahr>.xml.xhtml). Gibt es das Jahr,
 * antwortet der Server mit 200 und `<PAP name="Lohnsteuer<Jahr>" …>`; gibt es es nicht, mit 303 auf
 * /error_path/404.html (2027 am 05.11.2026) oder 302 auf eine Fehlerseite mit „notfound“ (2024). Der PAP enthält den
 * Tarif des § 32a EStG (UPTAB), deshalb hängt der Befund zum Einkommensteuertarif an ihm.
 */
import { type Abruf, abrufen, befund, beschreibe, DOKU, type Ergebnis, type Holen, LEER, sha256, text, warnung, zusammen } from "./abruf.ts";

export const papUrl = (jahr: number) => `https://www.bmf-steuerrechner.de/javax.faces.resource/daten/xmls/Lohnsteuer${jahr}.xml.xhtml`;

const DOKU_PAP = `${DOKU}#${encodeURIComponent("lohnsteuer-pap-jährlich-aktualisieren")}`;

export interface LohnsteuerStand {
  heute: Date;
  /** SHA-256 des hinterlegten PAP-XML je Jahr (`lohnsteuerPapQuelle`), null für ein Jahr ohne PAP */
  papSha256: (jahr: number) => string | null;
  /** Jahre mit Tarif in `TARIFE` (packages/core/src/income-tax.ts) */
  tarifJahre: readonly number[];
}

type PapAntwort = { art: "vorhanden"; sha256: string; stand: string | null } | { art: "fehlt" } | { art: "unklar"; grund: string };

/** Wertet die Antwort des BMF-Steuerrechners für ein Jahr aus */
export async function papAntwort(jahr: number, a: Abruf): Promise<PapAntwort> {
  if (a.art === "fehler") return { art: "unklar", grund: a.meldung };
  if (a.status === 404 || (a.status >= 300 && a.status < 400 && /404|notfound/i.test(a.ort ?? ""))) return { art: "fehlt" };
  if (a.status !== 200) return { art: "unklar", grund: beschreibe(a) };
  const xml = text(a);
  if (!new RegExp(`<PAP\\s+name="Lohnsteuer${jahr}"`).test(xml)) return { art: "unklar", grund: "Antwort ist kein PAP-XML" };
  return { art: "vorhanden", sha256: await sha256(a.inhalt), stand: /<!--\s*Stand:\s*(.+?)\s*-->/.exec(xml)?.[1] ?? null };
}

/** Laufendes und nächstes Jahr: neuer PAP, geänderter PAP, fehlender Einkommensteuertarif */
export async function pruefeLohnsteuer(stand: LohnsteuerStand, holen: Holen): Promise<Ergebnis> {
  const jahr = stand.heute.getFullYear();
  return zusammen(await Promise.all([jahr, jahr + 1].map(async (j) => bewerte(j, stand, await papAntwort(j, await abrufen(holen, papUrl(j)))))));
}

function bewerte(jahr: number, stand: LohnsteuerStand, antwort: PapAntwort): Ergebnis {
  if (antwort.art === "unklar") return warnung(`PAP ${jahr}: ${papUrl(jahr)} nicht auswertbar (${antwort.grund})`);
  if (antwort.art === "fehlt") return LEER;
  const hinterlegt = stand.papSha256(jahr);
  return zusammen([
    hinterlegt === null ? neuerPap(jahr, antwort) : hinterlegt === antwort.sha256 ? LEER : geaenderterPap(jahr, hinterlegt, antwort),
    stand.tarifJahre.includes(jahr) ? LEER : fehlenderTarif(jahr),
  ]);
}

const standZeile = (a: { sha256: string; stand: string | null }) => `Stand laut XML: ${a.stand ?? "nicht angegeben"}, SHA-256 \`${a.sha256}\`.`;

const neuerPap = (jahr: number, a: { sha256: string; stand: string | null }) =>
  befund({
    schluessel: `pap-${jahr}`,
    titel: `Lohnsteuer-PAP ${jahr} ist erschienen`,
    text: [
      `Der BMF-Steuerrechner hat den Programmablaufplan für die maschinelle Berechnung der Lohnsteuer ${jahr} veröffentlicht: ${papUrl(jahr)}`,
      "",
      standZeile(a),
      "",
      `Haben hat für ${jahr} noch keinen PAP (\`PAP_JAHRE\` in \`packages/core/src/lohnsteuer/index.ts\`) und rechnet die Lohnsteuer ${jahr} deshalb nicht.`,
      "",
      `Zu tun: das XML als \`Lohnsteuer${jahr}.xml\` ablegen, \`pap-${jahr}.ts\` mit Test anlegen, Prüffälle des BMF abrufen – Schritte in [docs/entwicklung.md, „Lohnsteuer: PAP jährlich aktualisieren“](${DOKU_PAP}).`,
    ].join("\n"),
  });

const geaenderterPap = (jahr: number, hinterlegt: string, a: { sha256: string; stand: string | null }) =>
  befund({
    schluessel: `pap-${jahr}-geaendert`,
    titel: `Lohnsteuer-PAP ${jahr} wurde geändert`,
    text: [
      `Das PAP-XML ${jahr} beim BMF-Steuerrechner weicht von dem in Haben hinterlegten ab: ${papUrl(jahr)}`,
      "",
      `${standZeile(a)} In \`packages/core/src/lohnsteuer/pap-${jahr}.ts\` steht SHA-256 \`${hinterlegt}\`.`,
      "",
      `Zu tun: das neue XML neben das alte legen und vergleichen (\`diff\`), Werte und Ablauf in \`pap-${jahr}.ts\` bzw. \`pap.ts\` nachziehen, Quelle und SHA-256 aktualisieren, Prüffälle neu abrufen – siehe [docs/entwicklung.md](${DOKU_PAP}). Gilt die Änderung erst ab einem Monat, braucht Haben beide Fassungen.`,
    ].join("\n"),
  });

const fehlenderTarif = (jahr: number) =>
  befund({
    schluessel: `est-tarif-${jahr}`,
    titel: `Einkommensteuertarif ${jahr} fehlt`,
    text: [
      `Der PAP ${jahr} des BMF enthält den Tarif des § 32a EStG für ${jahr} (Methode UPTAB): ${papUrl(jahr)}`,
      "",
      `In \`TARIFE\` in \`packages/core/src/income-tax.ts\` fehlt ${jahr}; die Steuerprognose rechnet ${jahr} deshalb mit dem Tarif des letzten bekannten Jahres.`,
      "",
      `Zu tun: Grundfreibetrag, Zonen und Abzugsbeträge aus UPTAB übernehmen, dazu Freigrenze des Solidaritätszuschlags, Kinderfreibetrag und Kindergeld; die Gegenprobe in \`pap.test.ts\` vergleicht den Tarif mit dem PAP – siehe [docs/entwicklung.md](${DOKU_PAP}), Schritt 5.`,
    ].join("\n"),
  });
