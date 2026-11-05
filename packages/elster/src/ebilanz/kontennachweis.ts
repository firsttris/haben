import type { Cents } from "@haben/core";
import { escapeXml } from "../xml.ts";
import { type EbilanzTaxonomie, ebilanzPositionen, istRechnerischVerknuepft } from "./taxonomie.ts";

/*
 * Kontennachweis zu Bilanz und GuV (§ 5b Abs. 1 EStG i. d. F. des JStG 2024, für Wirtschaftsjahre ab 2025): je Position
 * die Salden der Sachkonten, als Tupel „Kontensalden zu einer Position“ [detailedInformation.accountBalances] mit Name der
 * Position, Kontonummer, Kontobezeichnung und Saldo. Unverdichtet, also jedes Konto mit Saldo einzeln (BMF-Schreiben vom
 * 10. Juni 2025, BStBl I S. 1450).
 *
 * Welche Positionen einen Nachweis brauchen, regelt der Technische Leitfaden 6.10, Tz. B.12.1: jede werthaltige,
 * rechnerisch verknüpfte Position von Bilanz und GuV ohne werthaltige rechnerisch verknüpfte Unterposition; zu rechnerisch
 * nicht verknüpften Positionen (etwa den Davon-Vermerken zu Restlaufzeiten) darf keiner stehen. Hat eine solche Position
 * kein Konto, wie der Jahresüberschuss, den Haben nicht auf ein Konto abschließt, steht für sie einmal der Eintrag ohne
 * Konteninformationen mit „Konto nicht vorhanden oder nicht übermittelbar“ [notPossible]; den gibt es erst ab 6.10
 * (Änderungsnachweis zur Taxonomie 6.10, Nr. 3). ERiC prüft das ab 45.1 (Fehler 170195106 bis 170195110,
 * ERiC-Releasenotes 45.1, Kap. 3.1.8.1).
 *
 * Der Saldo steht im Vorzeichen der Position (Soll-Position Soll positiv), damit die Salden einer Position ihren Wert
 * ergeben (Technischer Leitfaden 6.10, Tz. A.13 und B.12.1).
 */

/** Saldo eines Sachkontos auf seiner Position der E-Bilanz */
export interface EbilanzKontensaldo {
  account: string;
  /** Kontobezeichnung, z. B. aus dem DATEV-Kontenrahmen */
  name: string;
  position: string;
  /** Im Vorzeichen der Position */
  betrag: Cents;
}

export interface KontennachweisEintrag {
  position: string;
  betrag: Cents;
  /** Ohne Konto: Eintrag ohne Konteninformationen */
  konto?: { nummer: string; name: string };
}

const istBilanzOderGuV = (position: string) => position.startsWith("bs.") || position.startsWith("is.");

/** Positionen von Bilanz und GuV, die nach Tz. B.12.1 einen Kontennachweis brauchen */
export function nachweisPositionen(summen: ReadonlyMap<string, Cents>, version: EbilanzTaxonomie): string[] {
  const positionen = ebilanzPositionen(version);
  const mitUnterposition = new Set<string>();
  for (const name of summen.keys()) {
    const parent = positionen[name]?.[1];
    if (parent && istRechnerischVerknuepft(name, version)) mitUnterposition.add(parent);
  }
  return [...summen.keys()]
    .filter((p) => istBilanzOderGuV(p) && istRechnerischVerknuepft(p, version) && !mitUnterposition.has(p))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Einträge des Kontennachweises: je Position, die einen braucht, die Konten mit Saldo; was die Konten nicht erklären,
 * als Eintrag ohne Konto (ab 6.10). In 6.9 bleibt dieser Rest ohne Nachweis; dort verlangt die Taxonomie nur zu
 * mindestens einer Position von Bilanz und GuV einen Kontensaldo (Technischer Leitfaden 6.9, Tz. B.12).
 */
export function kontennachweis(summen: ReadonlyMap<string, Cents>, konten: readonly EbilanzKontensaldo[], version: EbilanzTaxonomie): KontennachweisEintrag[] {
  const eintraege: KontennachweisEintrag[] = [];
  for (const position of nachweisPositionen(summen, version)) {
    const zuPosition = konten.filter((k) => k.position === position && k.betrag !== 0).sort((a, b) => a.account.localeCompare(b.account));
    for (const k of zuPosition) eintraege.push({ position, betrag: k.betrag, konto: { nummer: k.account, name: k.name.trim() || `Konto ${k.account}` } });
    const rest = (summen.get(position) ?? 0) - zuPosition.reduce((sum, k) => sum + k.betrag, 0);
    // Ohne Konto auch mit 0, etwa für abgeschriebene Anlagen (xbrl.ts, anlagenOhneBuchwert): die Position braucht einen Eintrag
    if ((rest !== 0 || zuPosition.length === 0) && version !== "6.9") eintraege.push({ position, betrag: rest });
  }
  return eintraege;
}

const decimal = (cents: Cents) => `${cents < 0 ? "-" : ""}${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/** Tupel im Aufbau der Beispiele zur Datenart Bilanz (ERiC-Dokumentation, Beispiele Taxonomie_6_10) */
export function kontennachweisXml(eintraege: readonly KontennachweisEintrag[], version: EbilanzTaxonomie): string[] {
  const d = 'contextRef="D-AKTJAHR"';
  const el = (name: string, value: string | null, attrs = d) =>
    value === null
      ? `<de-gaap-ci:detailedInformation.accountbalances.${name} xsi:nil="true" ${attrs}/>`
      : `<de-gaap-ci:detailedInformation.accountbalances.${name} ${attrs}>${escapeXml(value)}</de-gaap-ci:detailedInformation.accountbalances.${name}>`;
  return eintraege.map((e) =>
    [
      "<de-gaap-ci:detailedInformation.accountBalances>",
      el("positionName", `de-gaap-ci:${e.position}`),
      el("accountNumber", e.konto?.nummer ?? null),
      el("accountDescription", e.konto?.name ?? null),
      el("amount", decimal(e.betrag), `${d} unitRef="EUR" decimals="2"`),
      // „Konto nicht vorhanden oder nicht übermittelbar“ gibt es erst ab 6.10
      ...(version === "6.9" ? [] : [el("notPossible", e.konto ? null : "true")]),
      "</de-gaap-ci:detailedInformation.accountBalances>",
    ].join(""),
  );
}
