---
title: Open-Source-Buchhaltung für Freiberufler, selbst gehostet
description: >-
  Haben: Rechnungen mit E-Rechnung, Belege, Bankabgleich, EÜR oder Bilanz und die Steuern direkt an
  ELSTER – auf deinem eigenen Server, ohne Abo. Ein Rundgang in Bildern.
image: social-preview.png
hide:
  - navigation
  - toc
---

<!-- Die Seite zum Weitergeben: was Haben kann, in Bildern. Betrieb und Details stehen auf den
     verlinkten Seiten; die Bilder entstehen mit bun run docs:screenshots (entwicklung.md). -->

<div class="showcase-hero" markdown>

<p class="showcase-kicker">Open-Source-Buchhaltung, selbst gehostet</p>

# Haben ist, was dir gehört.

<p class="showcase-claim">Rechnungen mit E-Rechnung, Belege, Bankabgleich, EÜR oder Bilanz und die
Steuern direkt an ELSTER – für Freiberufler, Selbstständige und kleine GmbHs. Auf deinem Server,
ohne Abo und ohne fremden Dienst, der jede Rechnung sieht.</p>

[Rundgang starten](#rundgang){ .md-button .md-button--primary } [Installieren](installation.md){ .md-button } [Alle Funktionen im Detail](ueberblick.md){ .md-button }

<p class="showcase-hinweis">Haben ist noch in der Beta: vor jedem Update ein Backup.</p>

</div>

<div class="showcase-shot showcase-shot--hero" markdown>
![Übersicht in Haben: offene Forderungen, Umsatz, Umsatzsteuer-Zahllast, Kontostand und die nächsten Aufgaben](screenshot-uebersicht.png#only-light){ width="1504" height="972" }
![Übersicht in Haben: offene Forderungen, Umsatz, Umsatzsteuer-Zahllast, Kontostand und die nächsten Aufgaben](screenshot-uebersicht-dunkel.png#only-dark){ width="1504" height="972" }
</div>

<div class="showcase-feature" id="rundgang" markdown>
<div markdown>
<span class="showcase-kicker">Rechnungen</span>

## Das PDF entsteht, während du tippst

Positionen links, die fertige Rechnung rechts. Beim Festschreiben wird sie zur E-Rechnung nach
ZUGFeRD oder XRechnung, geprüft mit dem Validator der KoSIT. Abschlags- und wiederkehrende
Rechnungen, Mahnungen und Versand per E-Mail gehören dazu.

[Rechnungen und E-Rechnung](rechnungen.md)
</div>
<div class="showcase-shot" markdown>
![Rechnungseditor mit Positionen links und Live-Vorschau des PDFs rechts](screenshot-rechnung.png#only-light){ width="1504" height="972" loading="lazy" }
![Rechnungseditor mit Positionen links und Live-Vorschau des PDFs rechts](screenshot-rechnung-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature showcase-feature--flip" markdown>
<div markdown>
<span class="showcase-kicker">Belege</span>

## Der Beleg kommt, wie er gerade da ist

Per Drag-and-drop, mit der Kamera am Handy oder als Anhang an eine E-Mail. E-Rechnungen liest
Haben direkt, alles andere auf Wunsch per KI – auch mit einem eigenen Modell auf deinem Server.
Du prüfst, wählst die Kategorie und buchst.

[Belege](belege.md)
</div>
<div class="showcase-shot" markdown>
![Gebuchte Mobilfunkrechnung der Funknetz Mobil GmbH: links das Original, rechts Lieferant, Kategorie und Beträge je Steuersatz](screenshot-belege.png#only-light){ width="1504" height="972" loading="lazy" }
![Gebuchte Mobilfunkrechnung der Funknetz Mobil GmbH: links das Original, rechts Lieferant, Kategorie und Beträge je Steuersatz](screenshot-belege-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>
<span class="showcase-kicker">Bankabgleich</span>

## Enter, und die Zahlung ist zugeordnet

Die Umsätze kommen per PSD2 von selbst oder als Datei von DKB, Commerzbank, C24, N26, Swan, PayPal, Stripe und anderen.
Zu jedem Umsatz schlägt Haben die passende Rechnung oder den Beleg vor und sagt, warum: Betrag,
Rechnungsnummer, IBAN, Name.

[Bankimport und Abgleich](bank.md)
</div>
<div class="showcase-shot" markdown>
![Bankabgleich: Umsatz von Rheinpixel GmbH mit dem besten Treffer Rechnung 2026-033 und den Gründen](screenshot-bank.png#only-light){ width="1504" height="972" loading="lazy" }
![Bankabgleich: Umsatz von Rheinpixel GmbH mit dem besten Treffer Rechnung 2026-033 und den Gründen](screenshot-bank-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature showcase-feature--flip" markdown>
<div markdown>
<span class="showcase-kicker">Umsatzsteuer</span>

## Die Voranmeldung rechnet sich selbst

Jede Kennzahl kommt aus den Buchungen, nach Ist oder Soll, und du siehst, woher jede Zahl stammt.
Gesendet wird direkt per ERiC an ELSTER oder, ganz ohne Hersteller-ID, über Mein ELSTER.

[Umsatzsteuer-Voranmeldung](umsatzsteuer.md)
</div>
<div class="showcase-shot" markdown>
![Voranmeldung September mit Kennzahlen 81, 86, 66 und 83 und dem Bereich zum Übermitteln an ELSTER](screenshot-umsatzsteuer.png#only-light){ width="1504" height="972" loading="lazy" }
![Voranmeldung September mit Kennzahlen 81, 86, 66 und 83 und dem Bereich zum Übermitteln an ELSTER](screenshot-umsatzsteuer-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>
<span class="showcase-kicker">Auswertungen</span>

## Wie läuft das Jahr?

Einnahmen, Ausgaben und Gewinn nach Monaten, die Anlage EÜR, offene Posten. Zum Jahresende das
ganze Jahr als ZIP mit Prüfsummen – für die Aufbewahrung und für die Steuerberatung.

[Auswertungen und Jahresexport](auswertungen.md)
</div>
<div class="showcase-shot" markdown>
![Auswertungen 2026 mit Einnahmen, Ausgaben, Gewinn und Monatsdiagramm](screenshot-auswertungen.png#only-light){ width="1504" height="972" loading="lazy" }
![Auswertungen 2026 mit Einnahmen, Ausgaben, Gewinn und Monatsdiagramm](screenshot-auswertungen-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature showcase-feature--flip" markdown>
<div markdown>
<span class="showcase-kicker">Umzug</span>

## Umziehen, ohne etwas zu verlieren

Aus Lexware Office und sevDesk kommen Rechnungen, Belege, Buchungen und Kontakte mit, aus
BuchhaltungsButler und Accountable Buchungen und Belege; die Originale bleiben im Archiv. Ein
Abgleich je Jahr zeigt, dass alles da ist, bevor du kündigst. Kontakte, Artikel und Anlagen gehen
auch per CSV.

[Lexoffice](lexoffice.md) · [sevDesk](sevdesk.md) · [BuchhaltungsButler](buchhaltungsbutler.md) · [Accountable](accountable.md) · [CSV-Import](csv-import.md)
</div>
<div class="showcase-shot" markdown>
![Archiv mit Umzug aus Lexware Office](screenshot-archiv-oben.png#only-light){ width="1504" height="972" loading="lazy" }
![Archiv mit Umzug aus Lexware Office](screenshot-archiv-oben-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>
<span class="showcase-kicker">Am Handy</span>

## Wie eine App. Ohne App Store.

Haben lässt sich auf dem Handy und am Desktop als App installieren. Den Beleg fotografierst oder
teilst du direkt hinein, die Übersicht hast du unterwegs dabei.

[Als App installieren](einrichtung.md#als-app-installieren)
</div>
<div class="showcase-phone" markdown>
![Übersicht auf dem Smartphone](screenshot-mobil.png#only-light){ width="454" height="916" loading="lazy" }
![Übersicht auf dem Smartphone](screenshot-mobil-dunkel.png#only-dark){ width="454" height="916" loading="lazy" }
</div>
</div>

<div class="showcase-center" markdown>

## Und warum Haben?

<p class="showcase-claim">Digitale Souveränität fängt mit deinen eigenen Büchern an. 🇩🇪 🇪🇺</p>

</div>

<div class="showcase-cards" markdown>
<div markdown>
**🏠 Deine Daten bleiben bei dir**

Auf deinem Server, Schlüssel verschlüsselt. Kein Dienst liest deine Rechnungen mit.
</div>
<div markdown>
**💶 Kein Abo**

Haben ist Open Source unter AGPL-3.0. Bezahlt wird nur der Server.
</div>
<div markdown>
**🔒 GoBD von Anfang an**

Festschreibung in der Datenbank, Audit-Log, Korrekturen nur per Storno.
</div>
<div markdown>
**📮 Direkt ans Finanzamt**

Voranmeldung, Zusammenfassende Meldung und Jahreserklärungen über ELSTER.
</div>
<div markdown>
**🧮 Zahlen zum Nachrechnen**

Unter jeder Kennzahl die Belege dahinter, Voranmeldung und EÜR
[doppelt gerechnet](buchhaltung.md#abgleich-von-journal-umsatzsteuer-und-eür), vor dem Umzug
[deine alten Jahre zum Vergleich](lexoffice.md#schritt-5-abgleich-je-jahr).
</div>
<div markdown>
**🤝 Mit deiner Steuerberatung**

[Eigener Zugang](steuerberatung.md), der nur lesen kann, oder
[DATEV-Export](auswertungen.md#datev-export-für-die-steuerberatung) in SKR03 oder SKR04.
</div>
<div markdown>
**🏢 Auch für GmbH und UG**

Bilanz und GuV, E-Bilanz, Körperschaft- und Gewerbesteuer, Gewinnausschüttung.
</div>
<div markdown>
**👥 Lohn inklusive**

Abrechnung nach dem Programmablaufplan des BMF, Lohnsteuer-Anmeldung über ELSTER.
</div>
<div markdown>
**🤖 KI, wenn du willst**

Belege auslesen lassen oder Claude fragen, welche Rechnungen offen sind – nur lesend.
</div>
<div markdown>
**♿ Für alle bedienbar**

Vollständig per Tastatur, jede Seite in der CI gegen WCAG 2.2 AA geprüft.
</div>
<div markdown>
**🔓 Offen gebaut**

Code, Roadmap und jedes Review öffentlich. [Mitmachen](mitwirken.md) kannst du auch ohne zu programmieren.
</div>
<div markdown>
**🛠️ Gebaut mit Agenten**

Geprüft von Menschen: rote Tests zuerst, frische Agenten im Review, ein Mensch beim Merge.
[Agentic Engineering bei Haben](agentic-engineering.md)
</div>
</div>

<div class="showcase-center" markdown>

## Was du brauchst

</div>

<div class="showcase-cards" markdown>
<div markdown>
**🖥️ Einen Server**

Linux mit Docker oder Podman, etwa ein VPS ab rund 5 € im Monat, und eine Domain für HTTPS.
[Installation](installation.md)
</div>
<div markdown>
**📦 Oder dein NAS**

Vorlagen für [Synology](synology.md) und [TrueNAS](truenas.md) ohne Kommandozeile, dazu
[Unraid](unraid.md) und [Coolify](coolify.md).
</div>
<div markdown>
**🤖 Einrichten lassen**

Wer nicht selbst installieren will, gibt Claude Code oder einem anderen Agenten SSH-Zugang zum Server
und die [Installationsanleitung](installation.md).
</div>
</div>

<div class="showcase-hero" markdown>

## Deine Bücher. <span class="showcase-akzent">Dein Server.</span>

<p class="showcase-claim">Gemacht für Freiberufler, Selbstständige, Kleinunternehmer und kleine GmbHs
und UGs – für alle, die lieber arbeiten als buchen.</p>

[Installieren](installation.md){ .md-button .md-button--primary } [Mitwirken](mitwirken.md){ .md-button } [Quellcode auf GitHub](https://github.com/firsttris/haben){ .md-button }

</div>
