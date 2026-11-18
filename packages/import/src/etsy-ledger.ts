import { finish, indexed, type Tx } from "./common.ts";
import { StatementParseError } from "./errors.ts";
import { settlementKey, settleTax, unsettledTaxWarning } from "./etsy.ts";
import { BUCKETS, KINDS, type Kind, purposeOf, typeOf } from "./etsy-ledger-arten.ts";
import { steuerAbgleich } from "./etsy-steuerabgleich.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Zahlungsverlauf von Etsy Payments über die Open API v3
 * (GET /shops/{shop_id}/payment-account/ledger-entries, `transactions_r`). Anders als die CSV aus
 * „Finanzen › Monatliche Abrechnungen“ ist der Verlauf nicht auf einen Monat begrenzt und trägt je Zeile eine
 * eindeutige `entry_id` und einen Typ.
 *
 * Welche Ledger-Typen Haben wie bucht, steht in etsy-ledger-arten.ts.
 *
 * Gebucht wird wie beim CSV-Import (etsy.ts) und nach der Etsy-Gebührenrechnung:
 *
 * - Verkauf (PAYMENT_GROSS) und Erstattung (REFUND_GROSS) einzeln, mit der Bestellnummer im Zweck.
 * - Die Steuer des Käufers (sales_tax, etwa US Sales Tax) zieht Etsy ein und führt sie ab; sie ist weder Erlös noch
 *   Gebühr. Wie beim CSV-Import wird sie mit dem Verkauf bzw. der Erstattung derselben Bestellung am selben Tag verrechnet
 *   (settleTax), damit der Verkauf mit dem Betrag der Rechnung ankommt; im Zweck des Verkaufs steht dann, welche Steuer
 *   Etsy abgeführt hat. Ohne genau einen solchen Partner bleibt sie mit Bestellnummer einzeln stehen. Über
 *   mehrere Abrufe (schon übernommene Partner, schon verrechnete Steuer) entscheidet `steuerAbgleich` in
 *   etsy-steuerabgleich.ts.
 * - Gebühren und Werbung je Monat und Art zu je einer Zeile gebündelt, am letzten Tag des Monats: dieselben Arten wie die
 *   Positionen der Gebührenrechnung (Listing, Renew Expired, Renew Sold, Transaction, Processing, Etsy Ads, Offsite Ads),
 *   Gutschriften jeweils in ihrer Art; dazu die Umsatzsteuer, die Etsy ohne USt-IdNr. auf die Gebühren berechnet. Jede Zeile beginnt mit „Gebühr“, damit der Bankabgleich sie der Sammelrechnung
 *   zuordnen kann.
 * - Auszahlung (DISBURSE2) als eigener Umsatz: Geldtransit, kein Erlös.
 * - Karteneinzug (billing_payment) und Ausgleich (RECOUP) bleiben einzeln und werden nicht zu Gebühren gerechnet; „Ausgleich“
 *   wie in der Monatsabrechnung nach #1364, weil „Verrechnung“ in Haben den Ausgleich offener Posten meint.
 *
 * Die Bestellnummer steht im Verlauf nur bei der Steuerzeile direkt (sales_tax, reference_id ist die Bestellung).
 * Verkauf und Erstattung tragen die Zahlungs- bzw. Erstattungsnummer; die Bestellung dazu liefert
 * GET /shops/{shop_id}/payment-account/ledger-entries/payments (orderFor).
 */

/** Eine Zeile des Etsy-Zahlungsverlaufs, wie die API sie liefert (Beträge in Cent, Zeitstempel in Sekunden) */
export interface EtsyLedgerEntry {
  entry_id?: number;
  ledger_id?: number;
  sequence_number?: number;
  amount: number;
  currency: string;
  description?: string;
  balance?: number;
  /** Zeitpunkt der Buchung in Epoch-Sekunden */
  created_timestamp?: number;
  ledger_type: string;
  reference_type?: string;
  /** Objektkennung; Etsy liefert sie je Typ als Text oder als Zahl */
  reference_id?: string | number;
  parent_entry_id?: number;
}

/** Betrag in Euro für den Zweck, aus ganzen Cent ohne Gleitkomma */
function euro(cent: number): string {
  const betrag = Math.abs(cent);
  return `${Math.floor(betrag / 100)},${String(betrag % 100).padStart(2, "0")} €`;
}

/** Zweck eines Verkaufs oder einer Erstattung, mit der die Steuer des Käufers verrechnet ist */
function mitSteuer(tx: Tx, steuer: number): string {
  return `${tx.purpose} · Sales Tax ${euro(steuer)} von Etsy abgeführt`;
}

/** Kennung einer Sammelzeile (Art und Monat), wie sie hinter „etsy-“ in der Bankreferenz steht */
export function etsySammelKennung(reference: string, monat: string): string {
  return `${reference}-${monat}`;
}

export interface EtsyLedgerOptions {
  /** Bestellnummer zur Zahlungs- oder Erstattungsnummer (Payments-Abruf); fehlt sie, steht die Referenz im Zweck */
  orderFor?: (referenceId: string) => string | undefined;
  /**
   * Gebühren und Werbung je Monat und Art zu einer Zeile bündeln (Vorgabe). Aus schaltet das ab: dann bleibt jede Zeile des
   * Verlaufs ein eigener Umsatz, wie in der CSV-Datei von Etsy. Gilt nur für Arten und Monate, die noch nicht im Konto
   * stehen: schon gebündelte (`schonGebuendelt`) bleiben weg, schon einzeln übernommene (`bekannt`) bleiben einzeln.
   */
  sammelzeilen?: boolean;
  /**
   * Bündeln nur bis zu diesem Tag (JJJJ-MM-TT), in der Regel der letzte Tag des Vormonats, ab dem 5. des Folgemonats.
   * Etsy korrigiert Gebühren eines Monats noch nachträglich, deshalb entsteht die Sammelzeile erst, wenn der Monat
   * vorbei und die Korrekturzeit abgelaufen ist. Spätere Gebührenzeilen werden übersprungen und mit dem nächsten Abruf
   * gebündelt; sonst stünde derselbe Betrag zweimal im Konto (einmal einzeln, einmal in der Sammelzeile).
   */
  gebuehrenBis?: string;
  /**
   * Sammelzeilen, die schon im Konto stehen (etsySammelKennung). Ihre Zeilen bleiben weg, auch wenn das Bündeln inzwischen
   * aus ist: Ein Abruf, der wegen der Überlappung in einen schon gebündelten Monat reicht, ergäbe sonst eine zweite
   * Sammelzeile mit einer Teilsumme oder dieselben Gebühren noch einmal einzeln.
   */
  schonGebuendelt?: ReadonlySet<string>;
  /**
   * Zeilen, die ein früherer Abruf schon übernommen hat (entry_id als Text), mit der Bestellnummer aus ihrem Zweck und der
   * Steuer, die damals mit ihr verrechnet wurde (Betrag des Umsatzes minus Betrag der Zeile). Mit einer solchen Zeile
   * verrechnet dieser Abruf keine Steuer mehr, sonst ginge eine später gebuchte Steuer verloren; eine Steuerzeile, die
   * schon in einem übernommenen Verkauf oder einer Erstattung steckt, kommt nicht noch einmal einzeln.
   */
  bekannt?: ReadonlyMap<string, { order?: string; verrechnet: number }>;
}

/** Buchungstag aus dem Zeitstempel, in UTC wie im Backoffice; Etsy liefert Epoch-Sekunden */
function tag(entry: EtsyLedgerEntry, where: string): string {
  if (!entry.created_timestamp) throw new StatementParseError(`Zeile ohne Zeitstempel (${where}).`);
  return new Date(entry.created_timestamp * 1000).toISOString().slice(0, 10);
}

/** Letzter Tag des Monats „JJJJ-MM“ */
function monatsende(monat: string): string {
  const [jahr, monatsteil] = monat.split("-").map(Number);
  if (!jahr || !monatsteil) throw new StatementParseError(`Monat nicht lesbar: ${monat}.`);
  const letzter = new Date(Date.UTC(jahr, monatsteil, 0));
  return letzter.toISOString().slice(0, 10);
}

function unbekanntWarning(typen: string[]): string[] {
  if (typen.length === 0) return [];
  const namen = [...new Set(typen)].map((t) => t || "ohne Typ").join(", ");
  return [`${typen.length} ${typen.length === 1 ? "Zeile" : "Zeilen"} mit unbekanntem Typ (${namen}) einzeln übernommen.`];
}

type Zeile = { entry: EtsyLedgerEntry; tag: string };
type Bekannt = (entry: EtsyLedgerEntry) => { order?: string; verrechnet: number } | undefined;
type Sammelzeile = { amount: number; purpose: string; type: string; monat: string; reference: string };

/** Was der Abruf neben den Umsätzen zählt, für die Hinweise */
interface Zaehler {
  unbekannt: string[];
  fremdwaehrung: number;
  spaeter: number;
  schonDa: number;
}

/** Sales Tax über überlappende Abrufe: was schon im Konto steckt und was dieser Abruf verrechnen darf */
function abgleich(sortiert: Zeile[], options: EtsyLedgerOptions, bekannt: Bekannt) {
  return steuerAbgleich(
    sortiert
      .filter(({ entry }) => entry.amount !== 0 && (!entry.currency || entry.currency.toUpperCase() === "EUR"))
      .map(({ entry, tag: buchungstag }) => {
        const art = KINDS[entry.ledger_type];
        const frueher = bekannt(entry);
        const order =
          art === "verkauf" || art === "erstattung"
            ? (frueher?.order ?? options.orderFor?.(entry.reference_id === undefined ? "" : String(entry.reference_id)))
            : entry.reference_id === undefined
              ? undefined
              : String(entry.reference_id);
        return {
          entry,
          tag: buchungstag,
          art: art === "verkauf" || art === "erstattung" || art === "steuer" ? art : undefined,
          amount: entry.amount,
          order,
          frueher,
        };
      }),
  );
}

/** Art und Monat (etsySammelKennung), von denen ein früherer Abruf schon Gebühren einzeln übernommen hat */
function einzelnImKonto(sortiert: Zeile[], bekannt: Bekannt): Set<string> {
  const einzeln = new Set<string>();
  for (const { entry, tag: buchungstag } of sortiert) {
    const bucket = BUCKETS[KINDS[entry.ledger_type] as Kind];
    if (bucket && bekannt(entry)) einzeln.add(etsySammelKennung(bucket.reference, buchungstag.slice(0, 7)));
  }
  return einzeln;
}

/**
 * Gebühr oder Werbung in ihre Sammelzeile, sofern gebündelt wird; true, wenn die Zeile damit erledigt ist (gebündelt,
 * schon gebündelt im Konto oder aus einem noch laufenden Monat).
 */
function buendeln(
  { entry, tag: buchungstag }: Zeile,
  options: EtsyLedgerOptions,
  einzeln: ReadonlySet<string>,
  gebuendelt: Map<string, Sammelzeile>,
  zaehler: Zaehler,
): boolean {
  const kind = KINDS[entry.ledger_type];
  const bucket = kind ? BUCKETS[kind] : undefined;
  if (!bucket) return false;
  const monat = buchungstag.slice(0, 7);
  const schluessel = etsySammelKennung(bucket.reference, monat);
  // Steht die Sammelzeile schon im Konto, bleiben die Zeilen weg, auch wenn das Bündeln inzwischen aus ist
  if (options.schonGebuendelt?.has(schluessel)) {
    zaehler.schonDa++;
    return true;
  }
  // Monate und Arten, die schon einzeln im Konto stehen, bleiben einzeln, auch wenn das Bündeln inzwischen an ist
  if (!(options.sammelzeilen ?? true) || einzeln.has(schluessel)) return false;
  // Gebühren eines noch laufenden Monats bleiben liegen: die Sammelzeile entsteht erst, wenn er vorbei ist
  if (options.gebuehrenBis !== undefined && monatsende(monat) > options.gebuehrenBis) {
    zaehler.spaeter++;
    return true;
  }
  const vorhanden = gebuendelt.get(schluessel);
  if (vorhanden) vorhanden.amount += entry.amount;
  else
    gebuendelt.set(schluessel, {
      amount: entry.amount,
      purpose: `${bucket.prefix} · ${bucket.purpose} ${monat}`,
      type: bucket.type,
      monat,
      reference: schluessel,
    });
  return true;
}

/** Bestellnummer einer Zeile für Zweck und settleTax: bei Verkauf und Erstattung aus dem Payments-Abruf, bei der Steuer direkt */
function bestellungVon(kind: Kind | undefined, entry: EtsyLedgerEntry, options: EtsyLedgerOptions): string | undefined {
  if (kind === "verkauf" || kind === "erstattung") {
    // Etsy liefert die Kennung je Typ als Text oder als Zahl; der Abruf liefert Texte, deshalb angleichen
    return options.orderFor?.(entry.reference_id === undefined ? "" : String(entry.reference_id));
  }
  return kind === "steuer" && entry.reference_id !== undefined ? String(entry.reference_id) : undefined;
}

/** Umsatz aus einer einzelnen Zeile */
function einzelUmsatz(entry: EtsyLedgerEntry, kind: Kind | undefined, buchungstag: string, order: string | undefined): Tx {
  return {
    bookingDate: buchungstag,
    amount: entry.amount,
    currency: "EUR",
    counterpartyName: "Etsy",
    purpose: kind ? purposeOf(kind, entry, buchungstag, order) : `Etsy ${entry.ledger_type} · ${buchungstag}`,
    type: kind ? typeOf(kind) : entry.ledger_type,
    // Die entry_id ist im Verlauf eindeutig und bleibt es auch beim zweiten Abruf
    bankReference: entry.entry_id ? `etsy-${entry.entry_id}` : undefined,
  };
}

/** Umsatz einer Sammelzeile, am letzten Tag des Monats */
function sammelUmsatz(b: Sammelzeile): Tx {
  return {
    bookingDate: monatsende(b.monat),
    amount: b.amount,
    currency: "EUR",
    counterpartyName: "Etsy",
    purpose: b.purpose,
    type: b.type,
    bankReference: `etsy-${b.reference}`,
  };
}

function hinweise(zaehler: Zaehler, unsettled: number): string[] {
  const { fremdwaehrung, spaeter, schonDa } = zaehler;
  const warnings = [...unbekanntWarning(zaehler.unbekannt), ...unsettledTaxWarning(unsettled)];
  if (fremdwaehrung > 0) warnings.push(`${fremdwaehrung} ${fremdwaehrung === 1 ? "Zeile" : "Zeilen"} nicht in Euro übersprungen.`);
  if (spaeter > 0) warnings.push(`${spaeter} Gebühren- und Werbezeile(n) aus einem noch laufenden Monat kommen mit dem nächsten Abruf als Sammelzeile.`);
  if (schonDa > 0) {
    warnings.push(`${schonDa} Gebühren- und Werbezeile(n) aus einem schon gebündelten Monat übersprungen; die Sammelzeile steht bereits im Konto.`);
  }
  return warnings;
}

/** Zahlungsverlauf von Etsy Payments als Kontoauszug. Zeilen ohne Euro werden übersprungen und gemeldet. */
export function parseEtsyLedger(entries: EtsyLedgerEntry[], options: EtsyLedgerOptions = {}): ParsedStatement {
  const list: Tx[] = [];
  // Verkäufe, Erstattungen und Steuerzeilen merken sich Bestellung und Tag für settleTax
  const orders = new Map<Tx, string>();
  const gebuendelt = new Map<string, Sammelzeile>();
  const zaehler: Zaehler = { unbekannt: [], fremdwaehrung: 0, spaeter: 0, schonDa: 0 };
  const bekannt: Bekannt = (entry) => (entry.entry_id === undefined ? undefined : options.bekannt?.get(String(entry.entry_id)));

  const sortiert = entries
    .map((entry, position) => ({ entry, tag: tag(entry, `Zeile ${position + 1}`) }))
    .sort((a, b) => (a.entry.created_timestamp ?? 0) - (b.entry.created_timestamp ?? 0));
  const { drin, verrechenbar } = abgleich(sortiert, options, bekannt);
  const einzeln = einzelnImKonto(sortiert, bekannt);

  for (const zeile of sortiert) {
    const { entry, tag: buchungstag } = zeile;
    if (entry.currency && entry.currency.toUpperCase() !== "EUR") {
      zaehler.fremdwaehrung++;
      continue;
    }
    if (entry.amount === 0 || buendeln(zeile, options, einzeln, gebuendelt, zaehler) || drin.has(entry)) continue;
    const kind = KINDS[entry.ledger_type];
    if (!kind) zaehler.unbekannt.push(entry.ledger_type);
    const order = bestellungVon(kind, entry, options);
    const tx = einzelUmsatz(entry, kind, buchungstag, order);
    list.push(tx);
    // Mit schon übernommenen Zeilen verrechnet dieser Abruf nichts: Ihr Umsatz steht schon im Konto und bliebe unverändert
    const verrechnen = kind === "steuer" ? verrechenbar.has(entry) : kind === "verkauf" || kind === "erstattung";
    if (!bekannt(entry) && order !== undefined && verrechnen) orders.set(tx, settlementKey(order, buchungstag));
  }

  const settled = settleTax(list, orders, mitSteuer);
  settled.list.push(...[...gebuendelt.values()].map(sammelUmsatz));
  settled.list.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  return finish({
    format: "etsy-ledger",
    currency: "EUR",
    transactions: indexed(settled.list),
    warnings: hinweise(zaehler, settled.unsettled),
  });
}
