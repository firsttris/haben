---
title: "Zahlung und Mahnung bei Rechnungen"
description: >-
  Fälligkeit, Skonto, GiroCode, SEPA-Lastschrift mit Sammeldatei für die Bank und Mahnwesen
  für Rechnungen in Haben.
---

# Zahlung und Mahnung

## Fälligkeit

Fällig ist eine Rechnung am Rechnungsdatum plus Zahlungsziel. Fällt dieser Tag auf einen Samstag, Sonntag oder gesetzlichen Feiertag im Bundesland aus deinen Firmendaten, gilt der nächste Werktag (§ 193 BGB). Haben kennt nur Feiertage, die im ganzen Bundesland gelten; Feiertage einzelner Gemeinden (Fronleichnam in Teilen Sachsens und Thüringens, Mariä Himmelfahrt in Bayern, Augsburger Friedensfest) zählen nicht. Ohne Bundesland zählen nur die bundesweiten Feiertage. Bei Zahlungsziel 0 ist die Rechnung am Rechnungsdatum fällig, auch an einem Wochenende. Die Berechnung steht in `packages/core/src/holidays.ts`.

## Skonto

Skonto ist ein Abzug, den der Kunde machen darf, wenn er früh zahlt, etwa 2 % bei Zahlung innerhalb von 10 Tagen. Im Rechnungseditor stehen unter dem Zahlungsziel bis zu drei **Skontostufen**, je mit **Skonto in %** (bis zu zwei Nachkommastellen) und **Frist in Tagen**. Neben jeder Stufe zeigt der Editor das Datum, den Skontobetrag und den Zahlbetrag. Mit **+ Skontostufe hinzufügen** kommt eine weitere Stufe dazu, das Kreuz entfernt eine; ohne Stufe hat die Rechnung kein Skonto.

- **Vorgabe:** Das Skonto eines neuen Entwurfs kommt vom Kunden, wenn dort ein eigenes eingetragen ist (siehe [Kontakte](kontakte.md)), sonst aus den [Firmendaten](einrichtung.md). Stufen mit einer Frist länger als das Zahlungsziel der Rechnung lässt Haben dabei weg. Dasselbe gilt für Rechnungen aus einem Angebot, wiederkehrende Rechnungen und Entwürfe aus der [REST-API](api.md).
- **Regeln:** Die Frist zählt ab dem Rechnungsdatum und endet spätestens mit dem Zahlungsziel; eine Stufe mit längerer Frist braucht einen kleineren Satz. Skonto gilt immer für den ganzen Rechnungsbetrag. Es gibt es nur bei Rechnungen in Euro, nicht bei Storno und Rechnungskorrektur.
- **Bis zum Festschreiben änderbar:** Danach ist das Skonto wie die ganze Rechnung gesperrt.
- **Auf dem PDF** steht unter der Zahlungsaufforderung je Stufe ein Satz wie „Bei Zahlung bis zum 05.10.2026 gewähren wir 2 % Skonto (95,20 €); Sie überweisen dann 4.664,80 €.“ Die Frist ist hier ein Datum: Rechnungsdatum plus Tage, ohne Verschiebung auf den nächsten Werktag. Fällt dieses Datum auf ein Wochenende oder einen Feiertag, gilt eine Zahlung am nächsten Werktag nach § 193 BGB trotzdem noch als rechtzeitig; so wertet sie der [Bankabgleich](bank.md#skonto-auf-eigene-rechnungen). Der GiroCode bleibt beim vollen Betrag, denn welches Skonto der Kunde nutzt, steht vorher nicht fest.
- **In der E-Rechnung** beginnen die Zahlungsbedingungen (BT-20) mit einer Zeile je Stufe im Format der XRechnung, Regel BR-DE-18: `#SKONTO#TAGE=10#PROZENT=2.00#`, danach ein Zeilenumbruch und derselbe Inhalt als Satz. So lesen Buchhaltungsprogramme des Kunden das Skonto maschinell, in XRechnung (UBL und CII) wie in ZUGFeRD.
- **In der E-Mail** nennt der Platzhalter `{zahlbar}` die Skontofristen mit, etwa „zahlbar bis zum 09.10.2026 ohne Abzug oder bis zum 05.10.2026 abzüglich 2 % Skonto“.

Zahlt der Kunde in der Frist den Betrag abzüglich Skonto, erkennt der [Bankabgleich](bank.md#skonto-auf-eigene-rechnungen) die Zahlung und bucht das Skonto mit einem Klick aus; bei einer [Barzahlung](kasse.md#rechnung-bar-bezahlt) im Kassenbuch ebenso. Wie das Skonto Erlöse und Umsatzsteuer mindert, steht unter [Ausbuchen](rechnungen.md#ausbuchen). Nach der Fälligkeit gilt der volle Betrag: [Mahnungen](#mahnwesen) fordern den ganzen offenen Betrag und weisen darauf hin, dass das Skonto entfallen ist.

## GiroCode

Neben der Zahlungsaufforderung druckt Haben einen GiroCode, also einen EPC-QR-Code nach dem Standard des European Payments Council. Der Kunde scannt ihn mit der Banking-App, und die Überweisung ist ausgefüllt:

- Empfänger, IBAN und BIC aus den Firmendaten; als Empfänger steht der **Kontoinhaber**, ohne Angabe der Firmenname,
- der Rechnungsbetrag,
- der Verwendungszweck „Rechnung 2026-001“.

Läuft dein Konto nicht auf den Firmennamen, z. B. auf dich als Person, trag unter **Einstellungen › Firma** den **Kontoinhaber** ein. Die Bank deines Kunden vergleicht den Empfängernamen bei der Überweisung mit dem Inhaber des Kontos (Empfängerüberprüfung, seit Oktober 2025) und warnt sonst. Der Kontoinhaber steht auch in der Bankspalte der Fußzeile und in der E-Rechnung als Name des Zahlungskontos (BT-85).

Der Code steht nur auf Rechnungen in Euro mit Zahlbetrag und nur, wenn in den Firmendaten eine IBAN steht. Stornorechnungen und Korrekturen bekommen keinen, Rechnungen per [Lastschrift](#lastschrift) auch nicht. Mahnungen tragen den Code über den offenen Gesamtbetrag samt Gebühren und Zinsen. Im [Entwurfs-PDF](rechnungen.md#entwurf-als-pdf) steht an seiner Stelle ein Platzhalter.

## Lastschrift

Statt auf die Überweisung zu warten, ziehst du den Betrag per SEPA-Lastschrift ein. Dafür braucht es die Gläubiger-ID in den [Firmendaten](einrichtung.md#firmendaten) und ein gültiges [Mandat des Kunden](kontakte.md#sepa-lastschriftmandate).

Im Rechnungseditor stellst du die **Zahlungsart** auf **SEPA-Lastschrift**; das jüngste gültige Mandat des Kunden ist vorgewählt. Eingezogen wird am Fälligkeitstag, also Rechnungsdatum plus Zahlungsziel.

**Hinweis auf der Rechnung.** Statt der Bitte um Überweisung steht unter der Summe: „Den Betrag von … ziehen wir am … per SEPA-Lastschrift von Ihrem Konto … ein (Mandatsreferenz …, Gläubiger-ID …).“ Das ist die Vorabankündigung (Pre-notification) mit Betrag und Tag, die das Rulebook vor jedem Einzug verlangt; sie darf Teil der Rechnung sein ([SDD Core Rulebook](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2026-09/EPC016-06%202025%20SDD%20Core%20Rulebook%20version%201.2.pdf) v1.2, PT-04.02; [Clarification Paper](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2026-09/EPC132-17%20v5.1%20Clarification%20Paper%20SDD%20Core%20and%20SDD%20B2B%20scheme%20rulebooks.pdf) EPC132-17 v5.1, Kap. 2.6). Ohne andere Absprache mit dem Kunden muss sie spätestens 14 Kalendertage vor dem Einzug bei ihm sein (Kap. 4.3.4); ein kürzeres Zahlungsziel setzt eine solche Absprache voraus, etwa im Mandat. Einen GiroCode gibt es dann nicht, damit der Kunde nicht doppelt zahlt.

**In der E-Rechnung** steht die Zahlungsart 59 (SEPA-Lastschrift nach UNTDID 4461) mit Mandatsreferenz (BT-89), Gläubiger-ID (BT-90) und IBAN des Kunden (BT-91), ohne die eigene Bankverbindung, wie es XRechnung verlangt (BR-DE-25-a, BR-DE-25-b, BR-DE-30, BR-DE-31). Die Zahlungsbedingungen (BT-20) enthalten denselben Hinweis wie das PDF. Der KoSIT-Validator prüft das in der CI.

**Vor dem Festschreiben** prüft Haben: Gläubiger-ID vorhanden, Mandat des Kunden der Rechnung, Mandat am Einzugstag gültig (nicht widerrufen, nicht nach 36 Monaten ohne Einzug abgelaufen), Rechnung in Euro und ohne Skonto, denn eingezogen wird der volle Betrag. Storno und Rechnungskorrektur werden nie eingezogen; sie bekommen die Zahlungsart Überweisung.

**Wiederkehrende Rechnungen** haben dieselbe Zahlungsart. Jede Rechnung nimmt das jüngste Mandat des Kunden, das an ihrem Fälligkeitstag gilt; so geht es nach einem neuen Mandat ohne Änderung an der Vorlage weiter. Gibt es keins, entsteht für den Termin keine Rechnung; die Vorlage zeigt den Grund, und der nächste Lauf holt den Termin nach, sobald ein Mandat da ist. Liegt der Fälligkeitstag des nachgeholten Termins dann schon zurück, nimmt die Rechnung das am Tag des Laufs gültige Mandat; Rechnungsdatum und Zahlungsziel passt du vor dem Festschreiben an, denn eingezogen wird erst nach der Vorabankündigung.

### Sammeldatei für die Bank

Unter **Verkauf › Lastschriften** stehen alle festgeschriebenen, offenen Rechnungen mit Zahlungsart Lastschrift, die noch in keiner Datei waren. Du wählst das **Gläubigerkonto** und die Rechnungen und lädst mit **Lastschriftdatei erzeugen** eine SEPA-Datei im Format pain.008.001.08 herunter, die du im Online-Banking hochlädst. Das Format folgt der [Anlage 3 des DFÜ-Abkommens](https://www.ebics.de/de/datenformate/gueltige-version) der Deutschen Kreditwirtschaft (Version 3.9, Schema `pain.008.001.08_GBIC_5.xsd`; Version 26.11 behält es ab 15. November 2026 bei); ein Test prüft jede Datei gegen dieses Schema und das von ISO 20022.

- **Einzugstag** ist die Fälligkeit der Rechnung, frühestens der zweite TARGET-Geschäftstag nach heute. Die Bank muss die Lastschrift spätestens einen TARGET-Tag vor Fälligkeit an die Bank des Kunden geben ([SDD Core Rulebook](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2026-09/EPC016-06%202025%20SDD%20Core%20Rulebook%20version%201.2.pdf) v1.2, Kap. 4.3.4). TARGET-Tage sind Montag bis Freitag außer Neujahr, Karfreitag, Ostermontag, 1. Mai, 25. und 26. Dezember ([Bundesbank](https://www.bundesbank.de/resource/blob/749314/edbf269e7e236ff9dcf3e95dab122a0b/472B63F073F071307366337C94F8C870/feiertage-in-deutschland-1-data.pdf)). Hat deine Bank eine frühere Annahmeschlusszeit, lade die Datei entsprechend früher hoch.
- **Frühestens 14 Kalendertage vor Fälligkeit** lässt sich eine Lastschrift einreichen (Kap. 4.3.4); spätere Rechnungen stehen mit dem Tag in der Liste, ab dem sie gehen.
- **Erst- oder Folgelastschrift:** Die erste Lastschrift aus Haben auf ein neues Mandat ist eine Erstlastschrift (FRST), alle weiteren und die auf übernommene Mandate Folgelastschriften (RCUR). FRST ist seit 2016 optional; die Banken nehmen auch eine erste Lastschrift mit RCUR an ([Clarification Paper](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2026-09/EPC132-17%20v5.1%20Clarification%20Paper%20SDD%20Core%20and%20SDD%20B2B%20scheme%20rulebooks.pdf) EPC132-17 v5.1, Kap. 2.7; Anlage 3, Kap. 2.2.2.5).
- **Ein Sammler je Einzugstag, Verfahren und Sequenz.** Die Bank schreibt jeden Sammler als eine Summe gut (Sammelbuchung); der Bankabgleich teilt sie auf die Rechnungen auf. Im Verwendungszweck steht „Rechnung“ und die Nummer. Basis- und Firmenlastschriften (CORE und B2B) erzeugst du in getrennten Dateien; eine pain.008-Datei darf sie nicht mischen (Anlage 3, `LclInstrm`).
- **Mandat:** Es muss am Einzugstag gelten. Jede Lastschrift aus Haben zählt als Einzug, auch wenn sie später zurückkommt; ab ihrem Einzugstag laufen die 36 Monate bis zum Verfall neu.
- Lastschriften gehen nur von Konten im EWR; außerhalb verlangt die Deutsche Kreditwirtschaft die Anschrift des Zahlungspflichtigen.

Gebucht wird beim Erzeugen nichts. Die Rechnung bleibt offen, bis der Bankabgleich die Gutschrift zuordnet. Unter **Erzeugte Dateien** lädst du jede Datei erneut herunter; Datei und Lastschriften lassen sich nicht ändern oder löschen.

## Mahnwesen

Unter **Rechnungen › Mahnwesen** stehen alle überfälligen Rechnungen: festgeschrieben, nicht storniert, mit offenem Betrag und abgelaufener Fälligkeit. Ob eine Rechnung bezahlt ist, ergibt sich aus den Zuordnungen im [Bankabgleich](bank.md) und den Bareinnahmen im [Kassenbuch](kasse.md#rechnung-bar-bezahlt). Je Rechnung siehst du, wie viele Tage sie überfällig ist, den offenen Betrag und die letzte Mahnung mit ihrer Frist.

Der Knopf rechts schlägt die nächste Stufe vor:

| Stufe | Titel auf dem Schreiben |
|---|---|
| Zahlungserinnerung | Zahlungserinnerung |
| 1. Mahnung | Mahnung |
| Letzte Mahnung | Letzte Mahnung, mit Hinweis auf gerichtliche Schritte |

Läuft die Frist der letzten Mahnung noch, ist der Knopf hell. Mahnen kannst du trotzdem.

Gemahnt wird immer der volle offene Betrag. Bot die Rechnung [Skonto](#skonto) an, ist dessen Frist bei der Mahnung vorbei (sie endet spätestens mit dem Zahlungsziel); das Schreiben sagt deshalb unter der Zahlungsaufforderung, dass das Skonto entfallen ist.

Im Formular legst du fest:

| Feld | Bedeutung |
|---|---|
| Stufe | Vorschlag ist die nächste; beim Wechsel tauscht Haben Einleitung und Schluss gegen die Vorlage der Stufe |
| Neue Zahlungsfrist | Vorschlag: heute plus die Frist aus den Einstellungen (10 Tage) |
| Mahngebühr | Vorschlag je Stufe aus den Einstellungen |
| Verzugszinsen | Geschäftskunde: Basiszinssatz plus 9 Prozentpunkte, Verbraucher: plus 5 (§ 288 BGB). Taggenau ab dem Tag nach der Fälligkeit bis heute, auf 365 Tage, auf den offenen Betrag. Nur mit Basiszinssatz in den Einstellungen. |
| Verzugspauschale | 40 € nach § 288 Abs. 5 BGB, nur gegenüber Geschäftskunden |
| Einleitung und Schluss | Vorlage je Stufe, frei änderbar, auch [fett, kursiv und unterstrichen](rechnungen.md#fett-kursiv-und-unterstrichen) |

Rechts siehst du die Forderung mit Gesamtbetrag. **Entwurf als PDF** zeigt die Mahnung vorher mit dem Vermerk „ENTWURF“ und einem Platzhalter statt des GiroCodes, mit denselben Prüfungen und Beträgen wie beim Erstellen ([Entwurf als PDF](rechnungen.md#entwurf-als-pdf)); gespeichert wird dabei nichts. **… erstellen** speichert die Mahnung mit PDF und öffnet es. Das PDF hat denselben Briefbogen wie die Rechnung, in der aktuellen Gestaltung: Rechnungsnummer und -datum, Fälligkeit, offener Betrag, Gebühren und Zinsen, Gesamtbetrag und Zahlungsaufforderung mit IBAN. Mahnungen sind wie verschickte Schreiben unveränderlich (Trigger); eine falsche Mahnung ersetzt du durch eine neue. Bereits erstellte Mahnungen behalten ihr PDF; Zeichen wie `*`, die dort als Text stehen, bleiben also stehen.

Auf der Seite der Rechnung stehen alle Mahnungen mit Link zum PDF, bei überfälligen Rechnungen auch der Knopf für die nächste Stufe.

**Gebühren und Zinsen buchen:** Sie sind keine Rechnung und erhöhen nicht die Forderung. Zahlt der Kunde mehr als die Rechnung, ordnest du im Bankabgleich die Rechnung und den Rest als **Mahngebühren und Verzugszinsen** zu. Gebucht wird Bank an 2650 bzw. 7100 „Sonstige Zinsen und ähnliche Erträge“, ohne Umsatzsteuer (Schadensersatz, kein Entgelt). In der EÜR zählt das als umsatzsteuerfreie Betriebseinnahme.

Jede Mahnung lässt sich auf der Seite der Rechnung **per E-Mail** schicken, mit dem PDF der Mahnung im Anhang (siehe [Per E-Mail versenden](rechnungen.md#per-e-mail-versenden)).
