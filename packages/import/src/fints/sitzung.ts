import { type BankAccount, type BankAnswer, type BankingInformation, type ClientResponse, FinTSClient, FinTSConfig, type Statement } from "lib-fints";
import { bankdatenNichtLoggen } from "./log.ts";
import { lesefehler, lesefehlerMerken, type UmsatzFormat, umsatzFormat } from "./lesefehler.ts";
import { bestaetigtesSparkassenMediumMerken, synchronisierenMitSparkassenMedium } from "./sparkasse-medium.ts";
import { mitEingetippterTan } from "./tan-eintippen.ts";
import { umsatzabrufMitTanSchritt } from "./tan-schritt.ts";

/**
 * Dünne Schicht über lib-fints (FinTS 3.0 mit PIN/TAN): baut den Client, übersetzt Antworten der Bank in
 * „fertig / TAN nötig / abgelehnt“ und hält die Texte der Bank fest. Was gespeichert wird und wann wer gefragt wird,
 * entscheidet die App. Das Debug-Log von lib-fints bleibt aus: Es schriebe jede Nachricht samt PIN auf die Konsole.
 * Was lib-fints auch ohne Debug-Log über Antworten der Bank schreibt, filtert log.ts.
 */

/** Produktregistrierung bei der Deutschen Kreditwirtschaft: Nummer an..25 und Version an..5 (HKVVB, FinTS 3.0 Formals) */
export interface FintsProdukt {
  id: string;
  version: string;
}

/** Zugang zum Online-Banking: Bankleitzahl, FinTS-Adresse, Anmeldename (Benutzerkennung), Kunden-ID falls abweichend, PIN */
export interface FintsZugang {
  url: string;
  blz: string;
  benutzer: string;
  kundenId?: string | null;
  pin: string;
}

/** Was aus einer früheren Sitzung bleibt: BPD, UPD und Kundensystem-ID sowie das gewählte TAN-Verfahren */
export interface FintsGespeichert {
  bankingInformation: BankingInformation;
  tanVerfahren?: number | null;
  tanMedium?: string | null;
}

export interface FintsTanAnfrage {
  /** Auftragsreferenz der Bank für die Fortsetzung */
  referenz: string;
  /** Text der Bank, ohne HTML */
  text: string;
  /** Freigabe in der App der Bank statt TAN-Eingabe */
  entkoppelt: boolean;
  /** photoTAN: Bild als data-URL */
  bild?: string;
}

/** abgelehnt: Text der Bank und alle Rückmeldungscodes, damit die App bekannte Fälle erklären kann */
export type FintsAntwort<T> = { art: "ok"; wert: T } | { art: "tan"; anfrage: FintsTanAnfrage } | { art: "abgelehnt"; meldung: string; codes: number[] };

/** Fortsetzung nach einer TAN-Anfrage; ohne tan bei Freigabe in der App */
export interface FintsWeiter {
  referenz: string;
  tan?: string;
}

export interface FintsVerfahren {
  id: number;
  name: string;
  entkoppelt: boolean;
  /** Die Bank verlangt die Wahl eines TAN-Mediums (etwa eines von mehreren Handys) */
  mediumNoetig: boolean;
  medien: string[];
}

export function fintsClient(produkt: FintsProdukt, zugang: FintsZugang, gespeichert?: FintsGespeichert): FinTSClient {
  const kundenId = zugang.kundenId || undefined;
  const config = gespeichert
    ? FinTSConfig.fromBankingInformation(
        produkt.id,
        produkt.version,
        gespeichert.bankingInformation,
        zugang.benutzer,
        zugang.pin,
        gespeichert.tanVerfahren ?? undefined,
        gespeichert.tanMedium ?? undefined,
        kundenId,
      )
    : FinTSConfig.forFirstTimeUse(produkt.id, produkt.version, zugang.url, zugang.blz, zugang.benutzer, zugang.pin, kundenId);
  config.debugEnabled = false;
  bankdatenNichtLoggen();
  const client = new FinTSClient(config);
  lesefehlerMerken(client);
  return client;
}

/** Sammelmeldungen zur ganzen Nachricht (HIRMG), die neben dem eigentlichen Grund nichts sagen */
const ALLGEMEIN = new Set([9050, 9800]);

/**
 * Text einer Antwort der Bank: die Fehler (ab 9000), sonst die Warnungen (ab 3000). „Teilweise fehlerhaft“ und
 * „Dialog abgebrochen“ fallen weg, wenn die Bank daneben einen genaueren Grund nennt.
 */
export function fintsBankMeldung(answers: BankAnswer[]): string {
  const auswahl = (min: number) => {
    const treffer = answers.filter((a) => a.code >= min);
    const genau = treffer.filter((a) => !ALLGEMEIN.has(a.code));
    return (genau.length > 0 ? genau : treffer).map((a) => `${a.text} (${a.code})`);
  };
  const fehler = auswahl(9000);
  const meldung = (fehler.length > 0 ? fehler : auswahl(3000)).join(" ");
  return meldung || "Die Bank hat den Auftrag abgelehnt.";
}

/** Challenge ohne HTML: FinTS erlaubt in der Challenge einige Tags (br, p, b, ul, li) */
export function fintsChallengeText(challenge: string | undefined): string {
  return (challenge ?? "")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((zeile) => zeile.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** HITANS: Bezeichnung des TAN-Mediums 2 = zwingend (lib-fints exportiert die Aufzählung nicht) */
const MEDIUM_ZWINGEND = 2;

function bild(photo: ClientResponse["tanPhoto"]): string | undefined {
  if (!photo || photo.image.length === 0 || !/^image\/[a-z.+-]+$/i.test(photo.mimeType)) return undefined;
  return `data:${photo.mimeType};base64,${Buffer.from(photo.image).toString("base64")}`;
}

/**
 * Freigabe in der App nur, wenn die Bank sie so meldet: 3955 „Sicherheitsfreigabe erfolgt über anderen Kanal“, solange sie
 * aussteht 3956 (FinTS 3.0 Sicherheitsverfahren PIN/TAN, Rel. 2020, Kap. B „Abläufe beim Zwei-Schritt-Verfahren“,
 * Decoupled, Schritte 1b und 2b; Rückmeldungscodes der DK). Verlangt sie bei einem entkoppelten Verfahren nur 0030, will sie eine TAN zum
 * Eintippen, so die Consorsbank bei der Anmeldung mit ihrer App (Speicherstadt/haben#654). python-fints entscheidet ebenso
 * nach dem Code: bei der Dialoginitialisierung wertet es 3955 neben 0030 schon aus (fints/dialog.py), bei Aufträgen
 * (fints/client.py) bringt das erst der offene python-fints#218.
 */
const FREIGABE_IN_DER_APP = new Set([3955, 3956]);

function antwort<T>(client: FinTSClient, response: ClientResponse, wert: () => T): FintsAntwort<T> {
  if (response.requiresTan) {
    const entkoppelt = (client.config.selectedTanMethod?.isDecoupled ?? false) && response.bankAnswers.some((a) => FREIGABE_IN_DER_APP.has(a.code));
    return {
      art: "tan",
      anfrage: {
        referenz: response.tanReference ?? "",
        text: fintsChallengeText(response.tanChallenge) || "Bitte den Auftrag mit TAN freigeben.",
        entkoppelt,
        bild: bild(response.tanPhoto),
      },
    };
  }
  if (!response.success) return { art: "abgelehnt", meldung: fintsBankMeldung(response.bankAnswers), codes: response.bankAnswers.map((a) => a.code) };
  return { art: "ok", wert: wert() };
}

/**
 * Synchronisiert BPD, UPD und Kundensystem-ID (HKIDN, HKVVB, HKSYN). Die erste Synchronisierung ohne TAN-Verfahren
 * liefert die erlaubten Verfahren, erst die zweite mit gewähltem Verfahren die Konten.
 */
export async function fintsSynchronisieren(client: FinTSClient, weiter?: FintsWeiter): Promise<FintsAntwort<BankingInformation>> {
  const response = weiter
    ? await mitEingetippterTan(client, weiter.tan, () => client.synchronizeWithTan(weiter.referenz, weiter.tan))
    : await synchronisierenMitSparkassenMedium(client);
  bestaetigtesSparkassenMediumMerken(client, response);
  return antwort(client, response, () => client.config.bankingInformation);
}

/** Auszug aus lib-fints mit dem Format, in dem die Bank ihn geschickt hat */
export type FintsAuszug = Statement & { format?: UmsatzFormat };

/** Tag als lokales Datum, wie lib-fints es in HKKAZ und HKCAZ schreibt */
function datum(tag: string): Date {
  const [jahr, monat, t] = tag.split("-").map(Number);
  return new Date(jahr!, monat! - 1, t);
}

/**
 * Gebuchte Umsätze eines Kontos von bis einschließlich (CAMT, wenn die Bank es für das Konto anbietet, sonst MT940).
 * Wirft, wenn lib-fints die Umsätze nicht lesen kann (lesefehler.ts), statt sie als leer zu melden. Verlangt die Bank
 * entgegen HIPINS einen TAN-Schritt (9075), fragt sie Haben einmal mit TAN-Schritt neu (tan-schritt.ts), auch nach einer
 * Fortsetzung: Brauchte schon die Anmeldung des Abrufs eine TAN, geht HKKAZ im selben Dialog danach ohne HKTAN hinaus.
 */
export async function fintsUmsaetze(
  client: FinTSClient,
  konto: BankAccount,
  von: string,
  bis: string,
  weiter?: FintsWeiter,
): Promise<FintsAntwort<FintsAuszug[]>> {
  const abrufen = () => client.getAccountStatements(konto, datum(von), datum(bis));
  let response = weiter ? await mitEingetippterTan(client, weiter.tan, () => client.getAccountStatementsWithTan(weiter.referenz, weiter.tan)) : await abrufen();
  if (umsatzabrufMitTanSchritt(client, response)) response = await abrufen();
  const fehler = lesefehler(response);
  if (fehler) {
    throw new Error(
      `Die Bank hat die Umsätze von Konto …${(konto.iban ?? "").slice(-4)} als ${fehler.format} geschickt, Haben kann sie nicht lesen (lib-fints: ${fehler.grund}). Bleibt der Fehler, die fehlenden Umsätze als Datei aus dem Online-Banking importieren.`,
    );
  }
  const format = umsatzFormat(response);
  return antwort(client, response, () => ("statements" in response ? (response.statements as Statement[]) : []).map((s) => ({ ...s, format })));
}

/** Die TAN-Verfahren, die die Bank diesem Zugang erlaubt (Rückmeldung 3920); das Einschrittverfahren 999 nie */
export function fintsTanVerfahren(info: BankingInformation): FintsVerfahren[] {
  const erlaubt = info.bpd?.availableTanMethodIds ?? [];
  return (info.bpd?.supportedTanMethods ?? [])
    .filter((m) => erlaubt.includes(m.id) && m.id !== 999)
    .map((m) => ({
      id: m.id,
      name: m.name,
      entkoppelt: m.isDecoupled,
      mediumNoetig: m.tanMediaRequirement === MEDIUM_ZWINGEND,
      medien: m.activeTanMedia ?? [],
    }));
}

/** Konten in Euro mit IBAN, für die die Bank Umsätze herausgibt; Kreditkarten und Depots ohne IBAN fallen heraus */
export function fintsKonten(client: FinTSClient): { abrufbar: BankAccount[]; fremdwaehrung: string[]; ohneIban: number } {
  const alle = client.config.bankingInformation.upd?.bankAccounts ?? [];
  const mitIban = alle.filter((k) => k.iban && client.canGetAccountStatements(k));
  const euro = (k: BankAccount) => !k.currency || k.currency.toUpperCase() === "EUR";
  return {
    abrufbar: mitIban.filter(euro),
    fremdwaehrung: mitIban.filter((k) => !euro(k)).map((k) => k.currency.toUpperCase()),
    ohneIban: alle.length - mitIban.length,
  };
}
