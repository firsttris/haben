# Abgabe an ELSTER: alle Wege

Haben rechnet Voranmeldung, Umsatzsteuererklärung, Anlage EÜR und Einkommensteuererklärung aus deinen Buchungen. Ans Finanzamt kommen sie auf zwei Arten: **direkt aus Haben** über ERiC, wofür du eine eigene Hersteller-ID brauchst, oder **über das Portal Mein ELSTER**, wo du selbst absendest. Für Mein ELSTER gibt es vier Wege, die Werte aus Haben hineinzubringen.

| Weg | Voranmeldung | USt-Erklärung | Anlage EÜR | Einkommensteuer | Was du brauchst |
| --- | :---: | :---: | :---: | :---: | --- |
| [Direkt aus Haben (ERiC)](#direkt-aus-haben) | ✓ | ✓ | ✓ mit AVEÜR | ✓ | ERiC, eigene Hersteller-ID, Zertifikatsdatei und PIN |
| [XML-Import in Mein ELSTER](#xml-import-in-mein-elster) | ✓ | – | – | – | Anmeldung bei Mein ELSTER |
| [Erweiterung „Haben für Mein ELSTER“](#erweiterung-haben-für-mein-elster) | ✓ | ✓ | ✓ | ✓ | Chrome, Edge oder Brave, die Erweiterung |
| [KI-Assistent](#ki-assistent) | ✓ | ohne Ausfüllliste | ohne Ausfüllliste | ohne Ausfüllliste | Haben-MCP, ein Assistent, der deinen Browser steuert |
| [Von Hand](#von-hand) | ✓ | ✓ | ✓ | ✓ | nichts weiter |

## Welcher Weg passt?

- **Du hast eine eigene Hersteller-ID:** direkt aus Haben senden. Nur so weiß Haben von der Abgabe: Die Voranmeldung wird festgeschrieben, die Frist erledigt, und Bescheide, Postfach und Belege von ELSTER gibt es dazu.
- **Du hast keine Hersteller-ID** (die Beantragung dauert oft Wochen, siehe [Hersteller-ID](einrichtung.md#hersteller-id-wer-ist-hersteller)):
  - **Voranmeldung:** XML-Import. Eine Datei hochladen, Mein ELSTER füllt das Formular.
  - **Jahreserklärungen:** die Erweiterung. Sie trägt Seite für Seite ein, was Haben gerechnet hat.
  - Der **KI-Assistent** ist für das, was beide nicht abdecken, oder wenn du die Erweiterung nicht installieren willst.

## Direkt aus Haben

Haben sendet über ERiC, die Bibliothek der Finanzverwaltung, mit deinem Zertifikat. Einrichten: [Erste Schritte › ELSTER einrichten](einrichtung.md#elster-einrichten).

| Du brauchst | Woher |
| --- | --- |
| ERiC | lädt Haben unter **Einstellungen › ELSTER › ERiC** selbst von der Finanzverwaltung |
| eigene Hersteller-ID (`ELSTER_HERSTELLER_ID`) | ELSTER-Entwicklerbereich, Prüfung durch das Bayerische Landesamt für Steuern |
| Zertifikatsdatei (`.pfx`) und PIN | ELSTER-Benutzerkonto mit Anmeldeart „Zertifikatsdatei“; ELSTER Secure geht hier nicht |
| bestätigte Datenschutzhinweise | **Einstellungen › ELSTER › ERiC** |

Auf der Seite der Voranmeldung bzw. Jahreserklärung: **Nur prüfen**, dann **Prüfen und testweise senden**, dann echt senden nach der Rückfrage im Dialog, der nennt, was gesendet wird (Steuerart, Zeitraum und, wo es sie gibt, die Zahllast). Danach:

- Die Voranmeldung bzw. Erklärung ist festgeschrieben, mit Transfer-Ticket und Übermittlungsprotokoll (PDF) im Verlauf.
- Die [Frist](fristen.md) ist erledigt.
- Eine Korrektur der Voranmeldung ist eine [berichtigte Anmeldung](umsatzsteuer.md#berichtigte-anmeldung) aus Haben; eine berichtigte Jahreserklärung gibst du in Mein ELSTER ab.

Nur dieser Weg kann außerdem Bescheide aus dem [ELSTER-Postfach](finanzamt.md#bescheide-aus-dem-elster-postfach) holen, dem Finanzamt [Nachrichten](finanzamt.md#freie-nachricht) schicken, die [Vorauszahlungen herabsetzen](finanzamt.md#vorauszahlungen-herabsetzen), die [Bankverbindung ändern](finanzamt.md#bankverbindung-ändern) und die [Belege von ELSTER](jahreserklaerung.md#belege-von-elster) abrufen.

Einzelheiten: [Umsatzsteuer › Übermitteln an ELSTER](umsatzsteuer.md#übermitteln-an-elster), [Jahreserklärungen](jahreserklaerung.md#ablauf).

## Über Mein ELSTER

Ohne Hersteller-ID gibst du im Portal **Mein ELSTER** ab. Für alle Wege dort gilt:

- **Du meldest dich selbst an**, mit jeder Anmeldeart, die Mein ELSTER anbietet: Zertifikatsdatei, ELSTER Secure oder Ausweis. Haben verbindet sich nicht mit ELSTER und kennt weder Passwort noch Zertifikat.
- **Die Werte sind dieselben**, die Haben über ERiC senden würde: ein von Hand überschriebener Entwurf der Voranmeldung, sonst die aus den Buchungen gerechneten Kennzahlen. Arbeite vorher die Hinweise der [Vorprüfung](umsatzsteuer.md#vorprüfung) bzw. der Jahreserklärung ab.
- **Prüfen und Absenden machst du** in Mein ELSTER. Lade danach das Übermittlungsprotokoll herunter und leg es bei deinen Unterlagen ab.
- **Die Abgabe vermerkst du in Haben.** Bei der Voranmeldung trägst du unter **Außerhalb von Haben abgegeben** Tag, Transferticket, Kz 83 und das Übermittlungsprotokoll ein; danach ist sie festgeschrieben, die [Frist](fristen.md) erledigt und die Zahllast ein offener Posten im Bankabgleich ([Abgabe vermerken](umsatzsteuer.md#abgabe-außerhalb-von-haben-vermerken)). Für die Jahreserklärungen gibt es den Vermerk noch nicht: Sie bleiben in Haben ein Entwurf, ihre Frist bleibt offen.

### XML-Import in Mein ELSTER

Nur für die **Voranmeldung**. Auf der Seite des Monats den Entwurf speichern und **XML für Mein ELSTER** herunterladen (`UStVA_<Jahr>-<Monat>.xml`). In Mein ELSTER das Formular Umsatzsteuer-Voranmeldung öffnen, unter **Datenübernahme › XML-Import** die Datei hochladen, prüfen und absenden.

Mein ELSTER bietet den Import für das laufende und die drei vorherigen Jahre an. Für die Jahreserklärungen gibt es keinen XML-Import. Schritt für Schritt: [Umsatzsteuer › XML-Import in Mein ELSTER](umsatzsteuer.md#ohne-hersteller-id-xml-import-in-mein-elster).

### Erweiterung „Haben für Mein ELSTER“

Für **alle vier Formulare**. In Haben auf **Werte für Mein ELSTER kopieren** klicken, die Werte in die Erweiterung einfügen, dann in Mein ELSTER Seite für Seite durchgehen. Die Erweiterung findet jedes Feld über seine amtliche Kennung, trägt den Wert ein und rahmt ihn grün. Sie klickt nie: „Eintrag übernehmen“, Seitenwechsel, Prüfen und Absenden machst du. Was schon anders im Formular stand, etwa aus dem Vorjahr, überschreibt sie nur auf deinen Klick.

Die Erweiterung läuft in Chrome, Edge, Brave und anderen Chromium-Browsern. Du lädst sie als ZIP vom [Release](https://github.com/firsttris/haben/releases/latest) und bindest sie als entpackte Erweiterung ein. Sie schickt nichts an Haben oder sonst wohin. Einrichten und Ablauf: [Mein ELSTER mit Erweiterung](elster-mit-erweiterung.md).

### KI-Assistent

Ein Assistent wie Claude Code holt die Werte über das [Haben-MCP](ki-assistenten.md) und trägt sie in deinem Browser in Mein ELSTER ein, etwa mit Claude in Chrome oder Playwright MCP. Für die **Voranmeldung** liefert das Werkzeug `ustva_ausfuellliste` die Werte in der Reihenfolge des Formulars. Für die Jahreserklärungen gibt es noch keine Ausfüllliste; `jahreserklaerung` liefert nur Summen, Hinweise und die Steuerprognose, die einzelnen Zeilen mit Feldkennung stehen auf der Seite der Jahreserklärung in Haben.

Was der Assistent liest, auch in Mein ELSTER, geht an den Anbieter des Modells. Lass ihn nie selbst absenden. Einrichten, Erlaubnisse und ein Beispiel-Prompt: [Mein ELSTER mit KI-Assistent](elster-mit-assistent.md).

### Von Hand

Geht immer: Haben zeigt auf der Seite der Voranmeldung jede Kennzahl und bei den Jahreserklärungen jede Zeile mit ihrer Feldkennung. Die Steuer zu Kz 81 und 86 und die Zahllast Kz 83 rechnet Mein ELSTER selbst; vergleiche sie mit Haben.

## Offen

Ob Mein ELSTER das Ausfüllen durch eine Erweiterung oder einen gesteuerten Browser nach seinen Nutzungsbedingungen zulässt, ist nicht geklärt ([#124](https://github.com/firsttris/haben/issues/124)). Die Verantwortung für die Abgabe liegt bei dir, wie beim Abtippen. Der XML-Import ist ein Angebot von Mein ELSTER selbst.
