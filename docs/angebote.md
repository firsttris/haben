# Angebote

Unter **Angebote** schreibst du Angebote mit demselben Editor wie Rechnungen. Nimmt der Kunde an, machst du daraus mit einem Klick eine Rechnung.

## Angebot schreiben

**Neues Angebot** öffnet den Editor:

- Kunde
- Angebotsdatum
- **Gültig bis**, vorbelegt mit 30 Tagen
- optional der geplante Leistungszeitraum
- Umsatzsteuer: regulär, Kleinunternehmer, Reverse Charge, steuerfrei
- Positionen und ein Hinweis

Rechts siehst du die Vorschau. Der Entwurf lässt sich beliebig speichern, ändern und löschen.

**Festschreiben** vergibt die Nummer und erzeugt das PDF:

- Angebote haben einen eigenen Nummernkreis: `AN-2026-001`, `AN-2026-002` und so weiter, je Jahr neu.
- Die Rechnungsnummern bleiben davon unberührt.
- Das PDF hat dasselbe Layout wie die Rechnung, mit Angebotsnummer, Gültigkeit und dem Satz „Dieses Angebot gilt bis zum …“.
- Ein E-Rechnungs-XML gibt es für Angebote nicht.

Gebucht wird nichts: Ein Angebot ist kein Geschäftsvorfall.

Ein festgeschriebenes Angebot ändert sich nicht mehr, so wie eine Rechnung. Für eine geänderte Fassung legt **Kopieren** einen neuen Entwurf an, mit Kunde, Positionen und Hinweis. Datum und Gültigkeit sind dabei neu, die Dauer der Gültigkeit bleibt gleich.

## Per E-Mail senden

**Angebot senden** schickt das PDF über deinen [E-Mail-Zugang](einrichtung.md):

- Empfänger, Betreff und Text sind vorbelegt und lassen sich ändern.
- Auf Wunsch geht eine Blindkopie an dich.
- Jeder Versand steht beim Angebot und in der Liste (✉).

## Antwort und Rechnung

Auf der Seite des Angebots hältst du die Antwort des Kunden fest:

| Status | Bedeutung |
| --- | --- |
| Entwurf | noch nicht festgeschrieben |
| Offen | festgeschrieben, Gültigkeit läuft |
| Abgelaufen | keine Antwort und „Gültig bis“ ist vorbei |
| Angenommen | als angenommen markiert |
| Abgelehnt | als abgelehnt markiert |
| Abgerechnet | aus dem Angebot ist eine Rechnung entstanden |

**Rechnung erstellen** legt einen Rechnungsentwurf an und markiert das Angebot als angenommen. Der Entwurf übernimmt:

- Kunde, Positionen, Leistungszeitraum und Umsatzsteuer aus dem Angebot,
- Datum heute,
- Zahlungsziel aus den Firmendaten,
- E-Rechnungsformat des Kunden bzw. das Standardformat,
- den Hinweis „Gemäß unserem Angebot AN-2026-001 vom …“.

Vor dem Festschreiben passt du den Entwurf an, etwa die tatsächlich geleisteten Stunden. Die Rechnung zeigt das Angebot, aus dem sie stammt.

Jedes Angebot lässt sich nur einmal abrechnen. Löschst du den Rechnungsentwurf, kannst du das Angebot wieder abrechnen. Ein abgelehntes Angebot rechnet Haben nicht ab; mit **Antwort zurücknehmen** setzt du es wieder auf offen.

## Aufbewahrung

Angebote sind Handelsbriefe (§ 257 HGB, § 147 AO) und werden sechs Jahre aufbewahrt.

- In der Datenbank sind sie nach dem Festschreiben gesperrt. Ein Trigger lässt nur noch die Antwort des Kunden und den Verweis auf die Rechnung zu.
- Im [Jahresarchiv](auswertungen.md#jahresexport) liegen sie unter `angebote/`: die PDFs plus `angebote.csv` mit Beträgen, Antwort, Rechnungsnummer und SHA-256.
