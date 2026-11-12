---
title: Open-Source-Buchhaltung für Freiberufler, selbst gehostet
description: >-
  Haben ist Open-Source-Buchhaltung für Freiberufler und kleine GmbHs: E-Rechnung, Belege,
  Bankabgleich, EÜR oder Bilanz und ELSTER, auf deinem eigenen Server.
image: social-preview.png
hide:
  - navigation
  - toc
---

<!-- Die Seite für Erstbesucher: wenig Text, große Bilder. Jede Kachel und jede Funktion verlinkt die Seite mit
     den Details; die Bilder entstehen mit bun run docs:screenshots (entwicklung.md). -->

<div class="showcase-hero" markdown>

# Buchhaltung für Freiberufler, auf deinem eigenen Server

<p class="showcase-claim">Rechnungen mit E-Rechnung, Belege, Bankabgleich, EÜR oder Bilanz und die Steuern direkt
an ELSTER. Für Freiberufler, Selbstständige und kleine GmbHs, ohne Abo.</p>

[Installieren](installation.md){ .md-button .md-button--primary } [Rundgang ansehen](#rundgang){ .md-button }

</div>

<div class="showcase-shot showcase-shot--hero" markdown>
![Übersicht in Haben: offene Forderungen, Umsatz, Umsatzsteuer-Zahllast, Kontostand und die nächsten Aufgaben](screenshot-uebersicht.png#only-light){ width="1440" height="900" }
![Übersicht in Haben: offene Forderungen, Umsatz, Umsatzsteuer-Zahllast, Kontostand und die nächsten Aufgaben](screenshot-uebersicht-dunkel.png#only-dark){ width="1440" height="900" }
</div>

<div class="showcase-cards" markdown>
<div markdown>
### [Kein Abo](installation.md)

Open Source unter AGPL-3.0. Du zahlst nur den Server, etwa einen VPS ab rund 5 € im Monat.
</div>
<div markdown>
### [Mit Docker installiert](installation.md#docker-compose)

Zwei Dateien laden, Domain und Schlüssel eintragen, mit `docker compose up -d` starten.
</div>
<div markdown>
### [Deine Daten bei dir](architektur.md#sicherheit)

Alles liegt auf deinem Server, Zugänge verschlüsselt. Kein fremder Dienst sieht deine Rechnungen.
</div>
<div markdown>
### [Für die GoBD gebaut](buchhaltung.md)

Festschreibung in der Datenbank, Änderungsprotokoll, Korrekturen nur per Storno.
</div>
<div markdown>
### [Direkt ans Finanzamt](elster-abgabe.md)

Voranmeldung, Zusammenfassende Meldung und Jahreserklärungen über ELSTER.
</div>
<div markdown>
### [Umzug aus Lexware Office](lexoffice.md)

Rechnungen, Belege, Buchungen und Kontakte kommen mit, aus [sevDesk](sevdesk.md) ebenso.
</div>
<div markdown>
### [Auch für GmbH und UG](gmbh.md)

Bilanz und GuV, E-Bilanz, Körperschaft- und Gewerbesteuer, Gewinnausschüttung.
</div>
<div markdown>
### [Lohn inklusive](lohn.md)

Abrechnung nach dem Programmablaufplan des BMF, Lohnsteuer-Anmeldung über ELSTER.
</div>
</div>

<div class="showcase-feature showcase-feature--breit" id="rundgang" markdown>
<div markdown>

## Das PDF entsteht, während du tippst

Links die Positionen, rechts die fertige Rechnung. Beim Festschreiben wird sie zur E-Rechnung nach ZUGFeRD oder
XRechnung.

[Rechnungen und E-Rechnung](rechnungen.md)

</div>
<div class="showcase-shot" markdown>
![Rechnungseditor mit Positionen links und Live-Vorschau des PDFs rechts](screenshot-rechnung.png#only-light){ width="1440" height="900" loading="lazy" }
![Rechnungseditor mit Positionen links und Live-Vorschau des PDFs rechts](screenshot-rechnung-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Belege per Drag-and-drop, Kamera oder E-Mail

E-Rechnungen liest Haben direkt, andere Belege auf Wunsch per KI. Du prüfst, wählst die Kategorie und buchst.

[Belege](belege.md)

</div>
<div class="showcase-shot" markdown>
![Gebuchte Mobilfunkrechnung der Funknetz Mobil GmbH: links das Original, rechts Lieferant, Kategorie und Beträge je Steuersatz](screenshot-belege.png#only-light){ width="1440" height="900" loading="lazy" }
![Gebuchte Mobilfunkrechnung der Funknetz Mobil GmbH: links das Original, rechts Lieferant, Kategorie und Beträge je Steuersatz](screenshot-belege-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Enter, und die Zahlung ist zugeordnet

Die Umsätze kommen per PSD2 oder als Datei deiner Bank. Haben schlägt die passende Rechnung oder den Beleg vor
und sagt, warum.

[Bankimport und Abgleich](bank.md)

</div>
<div class="showcase-shot" markdown>
![Bankabgleich: Umsatz von Rheinpixel GmbH mit dem besten Treffer Rechnung 2026-033 und den Gründen](screenshot-bank.png#only-light){ width="1440" height="900" loading="lazy" }
![Bankabgleich: Umsatz von Rheinpixel GmbH mit dem besten Treffer Rechnung 2026-033 und den Gründen](screenshot-bank-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Die Voranmeldung rechnet sich selbst

Jede Kennzahl kommt aus den Buchungen. Gesendet wird per ERiC an ELSTER oder, ohne Hersteller-ID, über Mein
ELSTER.

[Umsatzsteuer-Voranmeldung](umsatzsteuer.md)

</div>
<div class="showcase-shot" markdown>
![Voranmeldung September mit Kennzahlen 81, 86, 66 und 83 und dem Bereich zum Übermitteln an ELSTER](screenshot-umsatzsteuer.png#only-light){ width="1440" height="900" loading="lazy" }
![Voranmeldung September mit Kennzahlen 81, 86, 66 und 83 und dem Bereich zum Übermitteln an ELSTER](screenshot-umsatzsteuer-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Umzug ohne Datenverlust

Rechnungen, Belege, Buchungen und Kontakte kommen aus Lexware Office oder sevDesk mit. Ein Abgleich je Jahr
zeigt, dass alles da ist, bevor du kündigst.

[Umzug aus Lexoffice](lexoffice.md), [Umzug aus sevDesk](sevdesk.md)

</div>
<div class="showcase-shot showcase-shot--crop" markdown>
![Archiv mit Umzug aus Lexoffice und Abgleich je Jahr](screenshot-archiv.png#only-light){ width="1440" height="2918" loading="lazy" }
![Archiv mit Umzug aus Lexoffice und Abgleich je Jahr](screenshot-archiv-dunkel.png#only-dark){ width="1440" height="2918" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Wie läuft das Jahr?

Einnahmen, Ausgaben und Gewinn nach Monaten, dazu die Anlage EÜR. Zum Jahresende das ganze Jahr als ZIP mit
Prüfsummen.

[Auswertungen und Jahresexport](auswertungen.md)

</div>
<div class="showcase-shot" markdown>
![Auswertungen 2026 mit Einnahmen, Ausgaben, Gewinn und Monatsdiagramm](screenshot-auswertungen.png#only-light){ width="1440" height="900" loading="lazy" }
![Auswertungen 2026 mit Einnahmen, Ausgaben, Gewinn und Monatsdiagramm](screenshot-auswertungen-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Hell, dunkel oder wie dein System

Sechs Themes, zwei davon dunkel. Zieh am H, um beide zu vergleichen.

[Theme wählen](einrichtung.md#einstellungen-und-darstellung)

</div>
<div class="showcase-shot" markdown>
<div class="theme-vergleich">
  <img src="screenshot-uebersicht.png" alt="Übersicht im hellen Theme Wald" width="1440" height="900" loading="lazy">
  <img class="theme-vergleich-dunkel" src="screenshot-uebersicht-dunkel.png" alt="Übersicht im dunklen Theme Nacht" width="1440" height="900" loading="lazy">
  <div class="theme-vergleich-linie" aria-hidden="true"></div>
  <div class="theme-vergleich-griff" role="slider" tabindex="0" aria-label="Helles und dunkles Theme vergleichen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="50 % hell">H</div>
</div>
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Am Handy wie eine App

Haben lässt sich aus dem Browser als App installieren, ohne App Store. Belege fotografierst oder teilst du direkt
hinein.

[Als App installieren](einrichtung.md#als-app-installieren)

</div>
<div class="showcase-phone" markdown>
![Übersicht auf dem Smartphone](screenshot-mobil.png#only-light){ width="390" height="844" loading="lazy" }
![Übersicht auf dem Smartphone](screenshot-mobil-dunkel.png#only-dark){ width="390" height="844" loading="lazy" }
</div>
</div>

<div class="showcase-hero" markdown>

## Selbst ausprobieren

<p class="showcase-claim">Haben läuft mit Docker oder Podman auf deinem Linux-Server. Es ist noch in der Beta,
mach vor jedem Update ein Backup.</p>

[Installieren](installation.md){ .md-button .md-button--primary } [Alle Funktionen](ueberblick.md){ .md-button }

</div>
