/*
 * Neuere ERiC-Version. Die Infoseite https://www.elster.de/elsterweb/entwickler/infoseite/eric leitet ohne Anmeldung
 * auf /elsterweb/entwickler/login um, und download.elster.de hat kein Verzeichnis (404 auf /download/eric/). Die Pakete
 * selbst sind aber ohne Anmeldung abrufbar, unter derselben Adresse, die `ericDownloadUrl` in
 * packages/elster/src/install.ts baut: …/eric_<Haupt>/ERiC-<Version>-Linux-x86_64.jar. Die Prüfung fragt deshalb
 * Kandidaten oberhalb von DEFAULT_ERIC_VERSION mit `Range: bytes=0-0` ab (206 = vorhanden, 404 = nicht) und meldet die
 * höchste gefundene. Am 05.11.2026 gab es so 43.5.4.0, 44.1.6.0, 44.2.4.0, 44.3.6.0 und 45.1.5.0. ELSTER nimmt alte
 * Fassungen vom Server (42.3.6.0 antwortet 404); fehlt die eingestellte Version selbst, ist das ein eigener Befund.
 *
 * BETA: Pro Jahr gibt es ein technisches Release im Mai und das Hauptrelease im November (ERiC-Entwicklerhandbuch
 * Kap. 2.3); eine BETA sendet nur mit Testmerker (Kap. 5.4.3). Welche Versionen BETA waren, sagen nur die Releasenotes
 * (ERiC-Releasenotes.pdf in ERiC-45.1.5.0- und ERiC-43.4.6.0-Dokumentation.zip): „41.1 (BETA)“, „43.1 (BETA)“ („BETA-
 * Version des November-Releases vom 20. Oktober“), „45.1 (BETA)“, danach `<Haupt>.2` als Hauptrelease; die Mai-Releases
 * 42.1 und 44.1 sind keine BETA. Paketname und Dokumentationspaket tragen kein Kennzeichen, das sich mit einem kleinen
 * Abruf lesen ließe (Liesmich.txt und MANIFEST.MF sind für BETA und Hauptrelease gleich, der Status steht nur im PDF).
 * Die Prüfung leitet die Regel deshalb aus den Releasenotes ab: `<Haupt>.0` und `<Haupt>.1` einer ungeraden
 * (November-)Hauptversion oberhalb der eingestellten gelten als BETA und sind kein Befund (also kein Issue); solange
 * nichts Freigegebenes darüber liegt, nennt eine Warnung die neueste BETA. Wartungsreleases der eingestellten
 * Hauptversion, Mai-Releases und ab `<Haupt>.2` sind Befunde.
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

/** Erste Nebenversion des Hauptreleases im November (Releasenotes: 43.1 BETA, 43.2 Hauptrelease) */
const HAUPTRELEASE_NEBEN = 2;

/** November-Releases haben in den Releasenotes ungerade Hauptversionen (41, 43, 45), Mai-Releases gerade (42, 44) */
const istNovemberRelease = (haupt: number) => haupt % 2 === 1;

/** `<Haupt>.0`/`<Haupt>.1` einer neueren November-Hauptversion als `aktuell` ist eine BETA, auch nach dem Hauptrelease */
export function istBeta(version: string, aktuell: string): boolean {
  const [haupt, neben] = versionAus(version);
  return haupt > versionAus(aktuell)[0] && istNovemberRelease(haupt) && neben < HAUPTRELEASE_NEBEN;
}

/** Warnung nur, solange die neueste BETA über allem Freigegebenen liegt; danach ist sie überholt */
const betaHinweis = (betas: readonly string[], gefunden: readonly string[]) => {
  const beta = betas.at(-1);
  const freigegeben = gefunden.at(-1);
  if (beta === undefined || (freigegeben !== undefined && vergleiche(versionAus(freigegeben), versionAus(beta)) > 0)) return LEER;
  return warnung(`ERiC: ${beta} ist eine BETA (nur Testfälle mit Testmerker), noch nicht anheben`);
};

export async function pruefeEric(aktuell: string, holen: Holen): Promise<Ergebnis> {
  const liste = kandidaten(aktuell);
  const [eigene, ...antworten] = await begrenzt([aktuell, ...liste], PARALLEL, (v) => pruefeVersion(holen, v));
  const vorhandene = liste.filter((_, i) => antworten[i] === "ja");
  const betas = vorhandene.filter((v) => istBeta(v, aktuell));
  const gefunden = vorhandene.filter((v) => !betas.includes(v));
  const unklar = antworten.filter((x) => x === "unklar").length;
  return zusammen([
    eigene === "nein" ? befund(nichtMehrDa(aktuell)) : eigene === "unklar" ? warnung(`ERiC: ${ericUrl(aktuell)} nicht erreichbar`) : LEER,
    gefunden.length > 0 ? befund(neuere(aktuell, gefunden)) : LEER,
    betaHinweis(betas, gefunden),
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
