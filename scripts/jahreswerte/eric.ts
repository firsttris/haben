/*
 * Neuere ERiC-Version. Die Infoseite https://www.elster.de/elsterweb/entwickler/infoseite/eric leitet ohne Anmeldung
 * auf /elsterweb/entwickler/login um, und download.elster.de hat kein Verzeichnis (404 auf /download/eric/). Die Pakete
 * selbst sind aber ohne Anmeldung abrufbar, unter derselben Adresse, die `ericDownloadUrl` in
 * packages/elster/src/install.ts baut: …/eric_<Haupt>/ERiC-<Version>-Linux-x86_64.jar. Die Prüfung fragt deshalb
 * Kandidaten oberhalb von DEFAULT_ERIC_VERSION mit `Range: bytes=0-0` ab (206 = vorhanden, 404 = nicht) und meldet die
 * höchste gefundene. Am 05.11.2026 gab es so 43.5.4.0, 44.1.6.0, 44.2.4.0, 44.3.6.0 und 45.1.5.0. ELSTER nimmt alte
 * Fassungen vom Server (42.3.6.0 antwortet 404); fehlt die eingestellte Version selbst, ist das ein eigener Befund.
 */
import { type Abruf, abrufen, begrenzt, befund, DOKU_JAHRESWERTE, type Ergebnis, type Holen, LEER, warnung, zusammen } from "./abruf.ts";

export const ERIC_BASIS = "https://download.elster.de/download/eric";

export const ericUrl = (version: string) => `${ERIC_BASIS}/eric_${version.split(".")[0]}/ERiC-${version}-Linux-x86_64.jar`;

/** Suchraum: die nächsten zwei Hauptversionen, je Haupt- Neben- 0 bis 9 und Patch 0 bis 12; vierte Stelle bleibt 0 */
const HAUPT_VORAUS = 2;
const NEBEN_BIS = 9;
const PATCH_BIS = 12;
const PARALLEL = 6;

type Version = readonly [number, number, number, number];

export const versionAus = (v: string): Version => {
  const teile = v.split(".").map(Number);
  if (teile.length !== 4 || teile.some((t) => !Number.isInteger(t))) throw new Error(`Keine ERiC-Version: ${v}`);
  return teile as unknown as Version;
};

const vergleiche = (a: Version, b: Version) => a.reduce((d, x, i) => d || x - b[i]!, 0);

/** Kandidaten oberhalb von `aktuell`, aufsteigend */
export function kandidaten(aktuell: string): string[] {
  const a = versionAus(aktuell);
  const liste: string[] = [];
  for (let haupt = a[0]; haupt <= a[0] + HAUPT_VORAUS; haupt++)
    for (let neben = 0; neben <= NEBEN_BIS; neben++)
      for (let patch = 0; patch <= PATCH_BIS; patch++) if (vergleiche([haupt, neben, patch, 0], a) > 0) liste.push(`${haupt}.${neben}.${patch}.0`);
  return liste;
}

type Vorhanden = "ja" | "nein" | "unklar";

/** 206 auf `Range` ist das Paket; 200 nur ohne HTML, sonst kann es eine Wartungs- oder Fehlerseite sein */
const vorhanden = (a: Abruf): Vorhanden => {
  if (a.art === "fehler") return "unklar";
  if (a.status === 206 || (a.status === 200 && !/html/i.test(a.typ))) return "ja";
  return a.status === 404 ? "nein" : "unklar";
};

/** Nur das erste Byte: das Paket hat rund 500 MB */
const pruefeVersion = async (holen: Holen, version: string) => vorhanden(await abrufen(holen, ericUrl(version), { headers: { Range: "bytes=0-0" } }, false));

export async function pruefeEric(aktuell: string, holen: Holen): Promise<Ergebnis> {
  const liste = kandidaten(aktuell);
  const [eigene, ...antworten] = await begrenzt([aktuell, ...liste], PARALLEL, (v) => pruefeVersion(holen, v));
  const gefunden = liste.filter((_, i) => antworten[i] === "ja");
  const unklar = antworten.filter((x) => x === "unklar").length;
  return zusammen([
    eigene === "nein" ? befund(nichtMehrDa(aktuell)) : eigene === "unklar" ? warnung(`ERiC: ${ericUrl(aktuell)} nicht erreichbar`) : LEER,
    gefunden.length > 0 ? befund(neuere(aktuell, gefunden)) : LEER,
    unklar > 0 ? warnung(`ERiC: ${unklar} von ${liste.length} Kandidaten bei ${ERIC_BASIS} nicht erreichbar`) : LEER,
  ]);
}

const ZU_TUN = [
  "Zu tun: die neue Version installieren (`bun packages/elster/src/install-cli.ts --lizenz-akzeptiert <Version>`), die Tests mit echtem ERiC laufen lassen (docs/entwicklung.md, „Tests mit echtem ERiC“) und eine Testübermittlung machen; danach `DEFAULT_ERIC_VERSION` in `packages/elster/src/install.ts` anheben.",
  "",
  "Dabei prüfen, was die Version mitbringt (`common/Plugins` und Jahresdokumentation im Paket): Datenarten des nächsten Jahres (z. B. `checkUStVA_<Jahr>`, `USt_<Jahr>`, `EUER_<Jahr>`, ESt, KSt, GewSt) und eine neue Taxonomie der E-Bilanz (`EBILANZ_TAXONOMIEN` in `packages/elster/src/xml.ts`). Die Prüfung im Workflow sieht nur, dass es das Paket gibt.",
];

const neuere = (aktuell: string, gefunden: readonly string[]) => {
  const neueste = gefunden.at(-1)!;
  return {
    schluessel: "eric",
    titel: `ERiC ${neueste} ist verfügbar (Haben: ${aktuell})`,
    text: [
      `Bei download.elster.de liegen neuere ERiC-Versionen als \`DEFAULT_ERIC_VERSION\` (${aktuell}): ${gefunden.map((v) => `[${v}](${ericUrl(v)})`).join(", ")}.`,
      "",
      ...ZU_TUN,
      "",
      `Wie die Prüfung sucht: [docs/entwicklung.md](${DOKU_JAHRESWERTE}).`,
    ].join("\n"),
  };
};

const nichtMehrDa = (aktuell: string) => ({
  schluessel: `eric-${aktuell}-entfernt`,
  titel: `ERiC ${aktuell} ist nicht mehr herunterladbar`,
  text: [
    `${ericUrl(aktuell)} antwortet mit 404. ELSTER nimmt alte Versionen vom Server; \`bun packages/elster/src/install-cli.ts\` ohne Version und der Knopf in den Einstellungen schlagen damit fehl.`,
    "",
    ...ZU_TUN,
  ].join("\n"),
});
