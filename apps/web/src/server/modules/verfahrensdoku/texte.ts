import { RECHTSFORMEN } from "@haben/core";
import { abschnitt, angabenAbsaetze, fehlendeAngaben, type VerfahrensdokuAbschnitt } from "@firsttris/gobd-kern/verfahrensdoku";
import { ROLLEN_LABEL, isRolle } from "../../../lib/rollen.ts";
import type { ProcedureDetails } from "./angaben.ts";
import type { InstanzStand } from "./stand.ts";

/**
 * Abschnitte der Verfahrensdokumentation, die nur Haben betreffen: allgemeine Beschreibung, Anwenderdokumentation und
 * Betriebsdokumentation (GoBD, BMF-Schreiben vom 28.11.2019, Rz. 153). Den Teil zur Unveränderbarkeit liefert der
 * GoBD-Kern (kernAbschnitt). Der Text ist Deutsch, weil er für die deutsche Finanzverwaltung ist.
 */

const zeitFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });
const tagFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" });
export const zeit = (d: Date | string) => zeitFormat.format(new Date(d));
export const tag = (d: Date | string) => tagFormat.format(new Date(d));

const VERSTEUERUNG = {
  ist: "Ist-Versteuerung: Umsatzsteuer nach vereinnahmten Entgelten (§ 20 UStG)",
  soll: "Soll-Versteuerung: Umsatzsteuer nach vereinbarten Entgelten (§ 16 Abs. 1 UStG)",
} as const;

const ZWECK: Record<string, string> = {
  geschaeft: "Geschäftskonto",
  steuer: "Steuerkonto",
  ruecklage: "Rücklage",
  privat: "privates Konto",
  zahlungsdienstleister: "Zahlungsdienstleister",
};

export function allgemein(s: InstanzStand, angaben: ProcedureDetails): VerfahrensdokuAbschnitt {
  const c = s.company;
  const anschrift = c?.strasse && c.ort ? `${c.strasse}, ${c.plz} ${c.ort}`.replace(/\s+/g, " ") : "";
  const betrieb = angabenAbsaetze(angaben, ["verantwortlich", "aufbewahrungsort"]);
  return abschnitt("1. Allgemeine Beschreibung", {
    absaetze: [
      `${c?.name || "Der Betrieb"} führt Bücher und Aufzeichnungen elektronisch mit Haben ${s.version}, einer selbst betriebenen Buchhaltung: Rechnungen und Angebote, Belege, Bankabgleich, Journal, Umsatzsteuer und Jahresabschluss. Diese Verfahrensdokumentation beschreibt das Verfahren in Haben; andere Programme des Betriebs gehören in die Ergänzungen. Haben erzeugt sie aus dem Stand dieser Instanz und den Angaben zum Betrieb; die Anwenderdokumentation steht unter https://haben.app/.`,
      c ? `Rechtsform: ${RECHTSFORMEN[c.rechtsform]}` : "",
      anschrift ? `Anschrift: ${anschrift}` : "",
      c ? `Kontenrahmen: ${c.kontenrahmen} (DATEV). ${VERSTEUERUNG[c.versteuerung]}.` : "",
      c?.kleinunternehmer ? "Der Betrieb ist Kleinunternehmer nach § 19 UStG: Rechnungen ohne Umsatzsteuer, keine Voranmeldung." : "",
      ...betrieb.absaetze,
    ],
    luecken: [...fehlendeAngaben({ firma: c?.name ?? "", anschrift }, ["firma", "anschrift"]).map((l) => `${l} (Einstellungen › Firma)`), ...betrieb.luecken],
  });
}

function nummernkreis(name: string, format: string, laufend: boolean, jeKunde: boolean): string {
  const kreis = jeKunde ? ", jeder Kunde hat einen eigenen Zähler; Storno und Korrektur zählen im Kreis, den die Einstellung beim Festschreiben ergibt" : "";
  return `${name}: Format „${format}“, ${laufend ? "der Zähler läuft über den Jahreswechsel weiter" : "der Zähler beginnt jedes Jahr bei 1"}${kreis}`;
}

function bank(s: InstanzStand): string[] {
  if (s.bankkonten.length === 0) return ["Es ist kein Bankkonto angelegt."];
  return [
    "Kontoumsätze kommen aus importierten Kontoauszugsdateien (deren SHA-256 Haben festhält) oder aus dem Kontoabruf über Enable Banking oder FinTS und sind ab dem Import unveränderlich. Jeder Umsatz wird einer Rechnung, einem Beleg oder einer Buchung ohne Beleg zugeordnet; aufgehobene Zuordnungen bleiben als Gegenzeile erhalten.",
    s.bankabruf.length || s.fintsabruf.length ? "" : "Ein Kontoabruf über Enable Banking oder FinTS ist nicht eingerichtet.",
  ];
}

function elster(s: InstanzStand): string {
  const gesendet = s.voranmeldungenGesendet ? ` Bisher sind ${s.voranmeldungenGesendet} Voranmeldungen gesendet oder als außerhalb abgegeben vermerkt.` : "";
  if (s.company?.kleinunternehmer) return `Als Kleinunternehmer gibt der Betrieb keine Voranmeldung ab.${gesendet}`;
  return s.elster
    ? `Voranmeldungen übermittelt Haben mit ERiC, der Bibliothek der Finanzverwaltung, in einem eigenen Prozess an ELSTER; Protokoll und gesendetes XML bleiben gespeichert, eine gesendete Voranmeldung ist gesperrt. Ein ELSTER-Zertifikat ist hinterlegt${s.elster.validUntil ? `, gültig bis ${tag(s.elster.validUntil)}` : ""}.${gesendet}`
    : `Es ist kein ELSTER-Zertifikat hinterlegt; Voranmeldungen gibt der Betrieb außerhalb von Haben ab und vermerkt sie mit dem Übermittlungsprotokoll.${gesendet}`;
}

export function anwender(s: InstanzStand, angaben: ProcedureDetails): VerfahrensdokuAbschnitt {
  const c = s.company;
  const papier = angabenAbsaetze(angaben, ["papierbelege"]);
  return abschnitt("2. Anwenderdokumentation: Erfassung und Verarbeitung", {
    absaetze: [
      "Rechnungen bekommen ihre Nummer beim Festschreiben aus einem fortlaufenden Nummernkreis; danach sind sie mit PDF und E-Rechnung versiegelt, eine Korrektur ist ein Storno oder eine neue Rechnung. Belege werden hochgeladen und unverändert unter ihrem SHA-256 gespeichert; beim Buchen werden sie festgeschrieben. Buchungen entstehen aus Rechnungen, Belegen, Bankumsätzen, Kasse und Anlagen nach dem gewählten Kontenrahmen; eine festgeschriebene Buchung wird nur durch eine Gegenbuchung korrigiert.",
      s.postfach
        ? `Belege kommen außerdem aus dem Postfach ${s.postfach.username} auf ${s.postfach.host} (Ordner ${s.postfach.folder}); jede abgerufene Mail wird nur einmal übernommen.`
        : "",
      s.ablage
        ? `Festgeschriebene Rechnungen schickt Haben seit ${tag(s.ablage.since)} zusätzlich als Kopie an das Dokumentenarchiv unter ${s.ablage.origin}; das Original bleibt in Haben, jede Übertragung steht mit Zeitpunkt und Ergebnis an der Rechnung.`
        : "",
      ...papier.absaetze,
      ...bank(s),
      elster(s),
      c?.datevBeraterNr && c.datevMandantNr
        ? `Für die Steuerberatung erzeugt Haben den DATEV-Buchungsstapel (Beraternummer ${c.datevBeraterNr}, Mandantennummer ${c.datevMandantNr}).`
        : "Ein DATEV-Export ist nicht eingerichtet (Berater- und Mandantennummer fehlen).",
      "Das Jahresarchiv (Einstellungen › Export) enthält alle Rechnungen, Belege, Buchungen, Bankumsätze und Voranmeldungen eines Jahres mit den Originaldateien, dazu das Änderungsprotokoll, den Prüfwert, die eingesetzten Versionen und die aktuelle Fassung dieser Verfahrensdokumentation.",
    ],
    liste: [
      ...(c
        ? [
            nummernkreis("Rechnungsnummern", c.invoiceNumberFormat, c.invoiceCounterRunning, c.invoiceCounterPerCustomer),
            nummernkreis("Angebotsnummern", c.quoteNumberFormat, c.quoteCounterRunning, c.quoteCounterPerCustomer),
            c.customerNumberFormat ? `Kundennummern: Format „${c.customerNumberFormat}“, fortlaufend ohne Jahr` : "Kundennummern: von Hand",
          ]
        : []),
      ...s.bankkonten.map((k) => `Bankkonto „${k.name}“ (${ZWECK[k.purpose] ?? k.purpose})`),
      ...s.bankabruf.map(
        (b) =>
          `Kontoabruf über Enable Banking bei ${b.aspspName}: ${b.status}${b.validUntil ? `, Zustimmung bis ${tag(b.validUntil)}` : ""}${b.lastSyncAt ? `, zuletzt abgerufen ${zeit(b.lastSyncAt)}` : ""}`,
      ),
      ...s.fintsabruf.map(
        (b) =>
          `Kontoabruf über FinTS bei ${b.bankName}: ${b.status === "tan" ? "wartet auf TAN" : b.status}${b.lastSyncAt ? `, zuletzt abgerufen ${zeit(b.lastSyncAt)}` : ""}`,
      ),
    ],
    luecken: papier.luecken,
  });
}

const rolle = (r: string | null) => (r && isRolle(r) ? ROLLEN_LABEL[r] : "ohne Rolle");

export function zugaenge(s: InstanzStand): VerfahrensdokuAbschnitt {
  return abschnitt("5. Betriebsdokumentation: Zugänge und Rechte", {
    absaetze: [
      "Haben hat genau einen Inhaber mit allen Rechten; nur er schreibt und ändert Einstellungen. Die Steuerberatung liest Auswertungen, Journal, Konten, Belege, Rechnungen und Exporte, ändern kann sie nichts. Der Server prüft das bei jeder Anfrage; jede Änderung steht mit dem Konto als Akteur im Änderungsprotokoll (GoBD Rz. 100).",
      s.sso
        ? "Die Anmeldung läuft über Single Sign-on (OIDC). Die Rolle ergibt sich aus der Gruppe beim Anbieter, wird bei der Anmeldung bestätigt und gilt nur für eine begrenzte Frist; die Liste nennt die Konten, die sich bisher angemeldet haben."
        : "Konten der Steuerberatung entstehen nur über eine Einladung des Inhabers und lassen sich sperren und entfernen.",
      s.company?.mcpEnabled
        ? "Programme und KI-Assistenten greifen mit API-Tokens zu, die der Inhaber anlegt und widerruft; jedes Token hat nur die genannten Rechte und läuft ab. Im Änderungsprotokoll steht das Token als Akteur."
        : "Der Zugang für Programme über API-Tokens (MCP, REST-API) ist ausgeschaltet.",
      "Geheimnisse wie Passwörter, Schlüssel, Zugangsdaten und das ELSTER-Zertifikat speichert Haben verschlüsselt (AES-256-GCM) und lässt sie aus dem Änderungsprotokoll aus; in diesem Dokument stehen sie nicht.",
    ],
    liste: [
      ...s.zugaenge.map((z) =>
        [
          `${z.name} (${z.email}): ${rolle(z.role)}`,
          z.createdAt ? `seit ${tag(z.createdAt)}` : "",
          z.lastLoginAt ? `zuletzt angemeldet ${zeit(z.lastLoginAt)}` : "",
          z.lockedAt ? `gesperrt seit ${tag(z.lockedAt)}` : "",
        ]
          .filter(Boolean)
          .join(", "),
      ),
      ...(s.company?.mcpEnabled ? s.tokens.map((t) => `API-Token „${t.name}“: ${t.scopes.join(", ")}, gültig bis ${tag(t.expiresAt)}`) : []),
    ],
  });
}

function sicherung(s: InstanzStand): string[] {
  const b = s.backup;
  if (b.state === "keins") return ["Haben kennt keinen Lauf des Backup-Containers; wie gesichert wird, steht in den Angaben oben."];
  return [
    `Der Backup-Container sichert Datenbank und Belege täglich, verschlüsselt mit restic${b.target ? ` nach ${b.target.repository}` : ""}, und spielt regelmäßig die letzte Sicherung probeweise in eine Wegwerf-Datenbank ein; dabei werden Hash-Kette und Siegel geprüft und einige Belege mit ihrer Prüfsumme verglichen. ${b.lastBackup ? `Letzte Sicherung: ${zeit(b.lastBackup.at)}${b.lastBackup.snapshot ? ` (Snapshot ${b.lastBackup.snapshot})` : ""}.` : "Noch keine Sicherung lief erfolgreich."}`,
    b.lastCheck
      ? `Letzter bestandener Test-Restore: ${zeit(b.lastCheck.at)}${b.lastCheck.message ? `, ${b.lastCheck.message}` : ""}.`
      : "Ein Test-Restore ist noch nicht bestanden.",
    ...b.failed.map(
      (f) => `${f.kind === "backup" ? "Die letzte Sicherung" : "Der letzte Test-Restore"} am ${zeit(f.run.at)} schlug fehl: ${f.run.message || "ohne Meldung"}`,
    ),
    b.overdue ? "Seit mehr als zwei Tagen lief keine Sicherung erfolgreich durch." : "",
  ];
}

export function betrieb(s: InstanzStand, angaben: ProcedureDetails): VerfahrensdokuAbschnitt {
  const server = angabenAbsaetze(angaben, ["serverbetrieb"]);
  const daten = angabenAbsaetze(angaben, ["datensicherung"]);
  const schluessel = angabenAbsaetze(angaben, ["schluesselablage"]);
  return abschnitt("6. Betriebsdokumentation: Betrieb und Datensicherung", {
    absaetze: [
      "Haben läuft als Server mit einer PostgreSQL-Datenbank und einem Verzeichnis für die Dateien; ERiC läuft für jeden Aufruf in einem eigenen, kurzlebigen Prozess. Bei jedem Start mit einer neuen Version hält Haben Programm- und Datenbankversion fest (Abschnitt 4).",
      ...server.absaetze,
      ...daten.absaetze,
      ...sicherung(s),
      ...schluessel.absaetze,
    ],
    luecken: [...server.luecken, ...daten.luecken, ...schluessel.luecken],
  });
}

export function ergaenzungen(angaben: ProcedureDetails): VerfahrensdokuAbschnitt | null {
  const { absaetze } = angabenAbsaetze(angaben, ["ergaenzungen"]);
  return absaetze.length ? abschnitt("7. Ergänzungen", { absaetze }) : null;
}
