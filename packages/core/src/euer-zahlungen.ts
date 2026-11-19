import { paidTaxShares, type ExpenseCategory } from "./posting.ts";
import type { Cents } from "./money.ts";
import { addDocumentEffects, documentEuer } from "./euer-beleg.ts";
import { steuerEuerWirkung } from "./steuerzahlung.ts";
import { darlehenEuerZeile } from "./darlehen.ts";
import { kategorieAnteil, kategorieArt, type DirektKategorie } from "./direkt-kategorie.ts";
import { euerErgebnis, type EuerDepreciation, type EuerLineKey, type EuerPayment, type EuerResult, type EuerWithdrawals } from "./euer.ts";

/* Die EÜR aus normalisierten Zahlungen (computeEuer); Typen, Ergebnis und CSV in euer.ts */

const yearOf = (date: string) => Number(date.slice(0, 4));
const monthIndex = (date: string) => Number(date.slice(5, 7)) - 1;

type Netted = EuerPayment & { sum: Cents };

/** Gruppe zum Verrechnen: Zahlung und Gegenzeile derselben Art, bei Steuerzahlungen auch derselben Steuerart und desselben Teils */
const groupKey = (p: EuerPayment) =>
  p.kind === "steuer"
    ? `steuer|${p.art}|${p.posten}`
    : p.kind === "darlehen"
      ? `darlehen|${p.zweck}|${p.teil}`
      : p.kind === "kategorie"
        ? `kategorie|${p.kategorie}|${p.steuersatz}`
        : p.kind;

/** Addiert Zahlungen derselben Gruppe; ohne Gruppe bleibt jede Zahlung für sich. */
function netGroups(payments: EuerPayment[]): Netted[] {
  const groups = new Map<string, Netted>();
  const result: Netted[] = [];
  payments.forEach((p, i) => {
    const amount = p.kind === "invoice" || p.kind === "document" ? p.paid : p.amount;
    const key = p.group === undefined ? `#${i}` : `${groupKey(p)}|${p.group}|${p.date}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sum += amount;
      // Gespeicherte Anteile nur, wenn alle Zahlungen der Gruppe welche haben; sonst aus der Summe gerechnet
      if (existing.kind === "invoice" && p.kind === "invoice") existing.shares = existing.shares && p.shares ? [...existing.shares, ...p.shares] : undefined;
      if (existing.kind === "document" && p.kind === "document")
        existing.effect = existing.effect && p.effect ? addDocumentEffects(existing.effect, p.effect) : undefined;
    } else {
      const entry = { ...p, sum: amount };
      groups.set(key, entry);
      result.push(entry);
    }
  });
  return result.filter((p) => p.sum !== 0);
}

/**
 * Zeile einer direkt gebuchten Einnahme (Netto): nicht steuerbare Einnahme (#1131) ohne Umsatzsteuer in der Zeile der
 * steuerfreien Einnahmen des Monats (16, als Kleinunternehmer 12) wie im Journal (journal-euer.ts), Erlöse mit 0 % als
 * Kleinunternehmer, sonst umsatzsteuerpflichtig
 */
const direktEinnahmeZeile = (kategorie: DirektKategorie, steuersatz: number, steuerfrei: EuerLineKey): EuerLineKey =>
  kategorie === "nichtSteuerbar" ? steuerfrei : steuersatz === 0 ? "einnahmenKleinunternehmer" : "einnahmenSteuerpflichtig";

/** Summen je Zeile, Einnahmen und Ausgaben je Monat und die nicht abziehbaren Beträge, die computeEuer sammelt */
interface Sammlung {
  sums: Map<EuerLineKey, Cents>;
  monthlyIn: Cents[];
  monthlyOut: Cents[];
  bewirtungNichtAbziehbar: Cents;
  gewerbesteuerNichtAbziehbar: Cents;
  add: (key: EuerLineKey, amount: Cents) => void;
}

function sammlung(): Sammlung {
  const sums = new Map<EuerLineKey, Cents>();
  return {
    sums,
    monthlyIn: Array.from({ length: 12 }, () => 0),
    monthlyOut: Array.from({ length: 12 }, () => 0),
    bewirtungNichtAbziehbar: 0,
    gewerbesteuerNichtAbziehbar: 0,
    add: (key, amount) => sums.set(key, (sums.get(key) ?? 0) + amount),
  };
}

/** Bezahlter Beleg: Ausgaben je Kategorie, Vorsteuer und Umsatzsteuer auf Privatanteile */
function belegZahlung(s: Sammlung, p: Netted & { kind: "document" }, month: number): void {
  const beleg = documentEuer(p, p.sum);
  for (const { category, amount } of beleg.expenses) {
    s.add(`ausgabe:${category}`, amount);
    s.monthlyOut[month]! += amount;
  }
  s.add("vorsteuer", beleg.vorsteuer);
  s.add("vereinnahmteUst", beleg.privateUst);
  s.bewirtungNichtAbziehbar += beleg.bewirtungNichtAbziehbar;
}

/** Steuerzahlung oder -erstattung nach ihrer Wirkung in der EÜR */
function steuerZahlung(s: Sammlung, p: Netted & { kind: "steuer" }, month: number, steuerfrei: EuerLineKey): void {
  const erstattung = p.steuerErstattung ?? p.sum > 0;
  switch (steuerEuerWirkung(p.art, p.posten, erstattung ? 1 : -1)) {
    case "umsatzsteuer":
      // Umsatzsteuer früherer Jahre: im Jahr der Zahlung gezahlte bzw. erstattete Umsatzsteuer (§ 11 EStG)
      if (erstattung) s.add("erstatteteUst", p.sum);
      else s.add("gezahlteUst", -p.sum);
      break;
    case "einnahme":
      // Zeile 18 der EÜR-Anleitung: erstattete Nebenleistungen bei KU in Zeile 12; die USt-Erstattung selbst bleibt oben getrennt.
      s.add(steuerfrei, p.sum);
      s.monthlyIn[month]! += p.sum;
      break;
    case "nebenleistung":
      s.add("steuerNebenleistungen", -p.sum);
      s.monthlyOut[month]! -= p.sum;
      break;
    case "nichtAbziehbar":
      s.gewerbesteuerNichtAbziehbar -= p.sum;
      break;
    // Private Steuern sind Entnahmen bzw. Einlagen; die zählt die Anlage EÜR aus den Privatkonten
    case "privat":
      break;
  }
}

/** Direkt gebuchte Einnahme oder Ausgabe einer Kategorie */
function kategorieZahlung(s: Sammlung, p: Netted & { kind: "kategorie" }, month: number, steuerfrei: EuerLineKey): void {
  // Zufluss bzw. Abfluss am Tag der Zahlung (§ 11 EStG); die Gegenrichtung (Erstattung) mindert die Zeile
  const { base, tax } = kategorieAnteil({ kategorie: p.kategorie, steuersatz: p.steuersatz }, p.sum);
  if (kategorieArt(p.kategorie) === "einnahme") {
    s.add(direktEinnahmeZeile(p.kategorie, p.steuersatz, steuerfrei), base);
    s.add("vereinnahmteUst", tax);
    s.monthlyIn[month]! += base;
  } else if (kategorieArt(p.kategorie) === "ausgabe") {
    s.add(`ausgabe:${p.kategorie as ExpenseCategory}`, -p.sum);
    s.monthlyOut[month]! -= p.sum;
  }
}

export function computeEuer(
  year: number,
  payments: EuerPayment[],
  depreciation?: EuerDepreciation,
  withdrawals?: EuerWithdrawals,
  /** KU-Status je Zahlungsmonat (Index 0 = Januar), unabhängig von der eigenen Befreiung der Rechnung. */
  kleinunternehmerMonate: readonly boolean[] = [],
): EuerResult {
  const s = sammlung();

  for (const p of netGroups(payments.filter((p) => yearOf(p.date) === year))) {
    const month = monthIndex(p.date);
    const steuerfrei = kleinunternehmerMonate[month] ? "einnahmenKleinunternehmer" : "einnahmenSteuerfrei";
    switch (p.kind) {
      case "invoice":
        for (const { rate, base, tax } of p.shares ?? paidTaxShares(p.totals, p.sum)) {
          // Anleitung EÜR 2025, Zeile 12: vollständige KU-Einnahmen, auch bei eigener Befreiung oder ausländischem Leistungsort.
          // Vor dem KU-Wechsel regelbesteuerte Leistungen behalten dagegen Zeilen 15/17.
          // https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
          s.add(p.treatment === "kleinunternehmer" ? "einnahmenKleinunternehmer" : rate === 0 ? steuerfrei : "einnahmenSteuerpflichtig", base);
          s.add("vereinnahmteUst", tax);
          s.monthlyIn[month]! += base;
        }
        break;
      case "document":
        belegZahlung(s, p, month);
        break;
      case "ustVorauszahlung":
      // Die Sondervorauszahlung ist Umsatzsteuer an das Finanzamt wie jede Vorauszahlung, abziehbar, wenn sie gezahlt ist
      case "sondervorauszahlung":
        // Eine Rücknahme mindert dieselbe Zeile, statt eine echte Erstattung bzw. Zahlung vorzutäuschen (#651).
        // EÜR-Anleitung 2025, Zeilen 18 und 58: https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
        if (p.ustAbfluss ?? p.sum < 0) s.add("gezahlteUst", -p.sum);
        else s.add("erstatteteUst", p.sum);
        break;
      case "mahnerloes":
      // Zinsen sind umsatzsteuerfrei (§ 4 Nr. 8 Buchst. a UStG), Verzugszinsen und Mahngebühren nicht steuerbar
      case "zinsertrag":
        // EÜR-Anleitung 2025, Zeilen 12/16: auch Guthabenzinsen und nicht steuerbare Mahnerlöse sind vollständige KU-Einnahmen.
        // https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
        s.add(steuerfrei, p.sum);
        s.monthlyIn[month]! += p.sum;
        break;
      case "steuer":
        steuerZahlung(s, p, month, steuerfrei);
        break;
      case "kursdifferenz":
        // Fremdwährung: Unterschied zwischen umgerechnetem Rechnungsbetrag und Zahlung, ohne Umsatzsteuer
        if (p.sum > 0) {
          s.add("kursgewinne", p.sum);
          s.monthlyIn[month]! += p.sum;
        } else {
          s.add("kursverluste", -p.sum);
          s.monthlyOut[month]! -= p.sum;
        }
        break;
      case "darlehen": {
        // Auszahlung und Tilgung sind erfolgsneutral; Zinsen und Gebühren Schuldzinsen, wenn sie abfließen (§ 11 Abs. 2 EStG)
        const zeile = darlehenEuerZeile(p.zweck, p.teil);
        if (zeile) {
          s.add(zeile, -p.sum);
          s.monthlyOut[month]! -= p.sum;
        }
        break;
      }
      case "kategorie":
        kategorieZahlung(s, p, month, steuerfrei);
        break;
      case "lohn":
        // Ausgaben für eigenes Personal (Anlage EÜR, Personal): Lohn, einbehaltene Lohnsteuer und alle Beiträge
        s.add("personal", -p.sum);
        s.monthlyOut[month]! -= p.sum;
        break;
      case "gebuehren":
        s.add("ausgabe:geldverkehr", -p.sum);
        s.monthlyOut[month]! -= p.sum;
        break;
      case "pauschale":
        s.add(`pauschale:${p.art}`, p.sum);
        s.monthlyOut[month]! += p.sum;
        break;
    }
  }

  return euerErgebnis(
    year,
    s.sums,
    { einnahmen: s.monthlyIn, ausgaben: s.monthlyOut },
    s.bewirtungNichtAbziehbar,
    s.gewerbesteuerNichtAbziehbar,
    depreciation,
    withdrawals,
  );
}
