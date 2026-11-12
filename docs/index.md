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

<!-- Die Seite für Erstbesucher, etwa aus Lexware Office oder sevDesk: oben was Haben ist und für wen,
     gleich darunter Kosten, Installation, Daten, GoBD, Umzug und Stand, dann der Rundgang in Bildern.
     Betrieb und Details stehen auf den verlinkten Seiten; die Bilder entstehen mit
     bun run docs:screenshots (entwicklung.md). -->

<div class="showcase-hero" markdown>
<div class="showcase-hero-text" markdown>

# Buchhaltung für Freiberufler, auf deinem eigenen Server

<p class="showcase-claim">Mit Haben schreibst du E-Rechnungen, buchst Belege, gleichst dein Bankkonto ab und
schickst die Umsatzsteuer an ELSTER. Haben ist für Freiberufler und Selbstständige mit EÜR gemacht, auch als
Kleinunternehmer, und für kleine GmbHs und UGs mit Bilanz.</p>

[Installieren](installation.md){ .md-button .md-button--primary } [Rundgang ansehen](#rundgang){ .md-button }

</div>
<div class="showcase-shot" markdown>
![Übersicht in Haben: offene Forderungen, Umsatz, Umsatzsteuer-Zahllast, Kontostand und die nächsten Aufgaben](screenshot-uebersicht.png#only-light){ width="1440" height="900" }
![Übersicht in Haben: offene Forderungen, Umsatz, Umsatzsteuer-Zahllast, Kontostand und die nächsten Aufgaben](screenshot-uebersicht-dunkel.png#only-dark){ width="1440" height="900" }
</div>
</div>

<div class="showcase-fragen" markdown>

## Häufige Fragen vor dem Umstieg

<div class="showcase-zeilen" markdown>
<div markdown>

### Was kostet Haben?

<div markdown>
Die Software kostet nichts, sie ist Open Source unter der AGPL-3.0. Du bezahlst nur den Server, etwa einen
VPS ab rund 5 € im Monat.
</div>
</div>
<div markdown>

### Wie aufwendig ist die Installation?

<div markdown>
Du brauchst einen Linux-Server mit Docker oder Podman und eine Domain, die auf ihn zeigt. Dort lädst du zwei
Dateien, trägst Domain, Datenbank-Passwort und drei Schlüssel ein und startest Haben mit `docker compose up -d`. Das Zertifikat
für HTTPS holt Caddy selbst, und ein eigener Container sichert jeden Tag Datenbank und Belege. Die Befehle
stehen [unten auf dieser Seite](#installation).
</div>
</div>
<div markdown>

### Wo liegen meine Daten?

<div markdown>
Auf deinem Server, kein fremder Dienst sieht deine Rechnungen. Zugänge wie die ELSTER-Zertifikatsdatei, den
Kontoabruf oder das E-Mail-Passwort speichert Haben verschlüsselt. Belege per KI auslesen lässt du nur, wenn du
willst, auch mit einem eigenen Modell auf deinem Server.
</div>
</div>
<div markdown>

### Ist Haben GoBD-konform?

<div markdown>
Haben setzt die technischen Anforderungen der GoBD um. Festgeschriebene Rechnungen, Belege und Buchungen sperrt
die Datenbank selbst, Korrekturen gehen nur über Storno, jede Änderung steht im Änderungsprotokoll, und das
Jahresarchiv trägt Prüfsummen. Ein Testat für die Software gibt es nicht; Backups und Verfahrensdokumentation
gehören zu deinem Betrieb. Mehr dazu in [Buchhaltung in Haben](buchhaltung.md).
</div>
</div>
<div markdown>

### Kann ich aus Lexware Office oder sevDesk umziehen?

<div markdown>
Ja. Rechnungen, Belege, Buchungen und Kontakte holt Haben per API, die Originale bleiben im Archiv, und ein
Abgleich je Jahr zeigt vor der Kündigung, dass alles angekommen ist. Bestände aus BuchhaltungsButler und
Accountable übernimmt Haben ins Archiv. Die Anleitungen: [Umzug aus Lexoffice](lexoffice.md) und
[Umzug aus sevDesk](sevdesk.md).
</div>
</div>
<div markdown>

### Wie weit ist Haben?

<div markdown>
Haben ist in der Beta und wird noch stark weiterentwickelt. Mach vor jedem Update ein Backup und prüf
Auswertungen und Meldungen an das Finanzamt, bevor du sie absendest.
</div>
</div>
</div>

</div>

<div class="showcase-feature showcase-feature--breit" id="rundgang" markdown>
<div markdown>

## Rechnungen und E-Rechnung

Links trägst du die Positionen ein, rechts siehst du das PDF, wie es der Kunde bekommt. Beim Festschreiben
entsteht daraus eine E-Rechnung nach ZUGFeRD oder XRechnung; das Format prüft die CI bei jeder Änderung mit dem
Validator der KoSIT. Abschlags- und wiederkehrende Rechnungen, Mahnungen und den Versand per E-Mail gibt es auch.

[Rechnungen und E-Rechnung](rechnungen.md)

</div>
<div class="showcase-shot" markdown>
![Rechnungseditor mit Positionen links und Live-Vorschau des PDFs rechts](screenshot-rechnung.png#only-light){ width="1440" height="900" loading="lazy" }
![Rechnungseditor mit Positionen links und Live-Vorschau des PDFs rechts](screenshot-rechnung-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Belege

Einen Beleg ziehst du ins Fenster, fotografierst ihn mit dem Handy oder schickst ihn als Anhang an ein eigenes
Postfach. E-Rechnungen liest Haben direkt, andere Belege auf Wunsch per KI. Danach prüfst du die Beträge, wählst
die Kategorie und buchst.

[Belege](belege.md)

</div>
<div class="showcase-shot" markdown>
![Gebuchte Mobilfunkrechnung der Funknetz Mobil GmbH: links das Original, rechts Lieferant, Kategorie und Beträge je Steuersatz](screenshot-belege.png#only-light){ width="1440" height="900" loading="lazy" }
![Gebuchte Mobilfunkrechnung der Funknetz Mobil GmbH: links das Original, rechts Lieferant, Kategorie und Beträge je Steuersatz](screenshot-belege-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Bankabgleich

Die Umsätze holt Haben einmal am Tag per PSD2 ab, oder du lädst einen Kontoauszug von DKB, Commerzbank, C24,
N26, Swan, PayPal, Stripe und anderen hoch. Zu jedem Umsatz schlägt Haben die passende Rechnung oder den Beleg vor und nennt den Grund,
etwa Betrag, Rechnungsnummer, IBAN oder Name. Mit Enter übernimmst du den Vorschlag.

[Bankimport und Abgleich](bank.md)

</div>
<div class="showcase-shot" markdown>
![Bankabgleich: Umsatz von Rheinpixel GmbH mit dem besten Treffer Rechnung 2026-033 und den Gründen](screenshot-bank.png#only-light){ width="1440" height="900" loading="lazy" }
![Bankabgleich: Umsatz von Rheinpixel GmbH mit dem besten Treffer Rechnung 2026-033 und den Gründen](screenshot-bank-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Umsatzsteuer und ELSTER

Jede Kennzahl der Voranmeldung rechnet Haben aus den Buchungen, nach Ist oder Soll, und zeigt, woher sie kommt.
Mit eigener Hersteller-ID sendest du direkt per ERiC an ELSTER. Ohne sie lädst du die Voranmeldung als Datei in
Mein ELSTER hoch, oder die Browser-Erweiterung trägt die Formulare dort für dich ein.

[Umsatzsteuer-Voranmeldung](umsatzsteuer.md)

</div>
<div class="showcase-shot" markdown>
![Voranmeldung September mit Kennzahlen 81, 86, 66 und 83 und dem Bereich zum Übermitteln an ELSTER](screenshot-umsatzsteuer.png#only-light){ width="1440" height="900" loading="lazy" }
![Voranmeldung September mit Kennzahlen 81, 86, 66 und 83 und dem Bereich zum Übermitteln an ELSTER](screenshot-umsatzsteuer-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Umzug aus Lexware Office oder sevDesk

Rechnungen, Belege, Buchungen und Kontakte kommen mit, die Originalexporte liegen danach im Archiv. Für jedes
Jahr zeigt ein Abgleich, ob alles da ist, bevor du das alte Abo kündigst.

[Umzug aus Lexoffice](lexoffice.md), [Umzug aus sevDesk](sevdesk.md)

</div>
<div class="showcase-shot showcase-shot--crop" markdown>
![Archiv mit Umzug aus Lexoffice und Abgleich je Jahr](screenshot-archiv.png#only-light){ width="1440" height="2918" loading="lazy" }
![Archiv mit Umzug aus Lexoffice und Abgleich je Jahr](screenshot-archiv-dunkel.png#only-dark){ width="1440" height="2918" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Auswertungen und Jahresarchiv

Einnahmen, Ausgaben und Gewinn siehst du nach Monaten, dazu die Anlage EÜR und die offenen Posten. Zum
Jahresende lädst du das ganze Jahr als ZIP mit Prüfsummen herunter, für die Aufbewahrung und für die
Steuerberatung.

[Auswertungen und Jahresexport](auswertungen.md)

</div>
<div class="showcase-shot" markdown>
![Auswertungen 2026 mit Einnahmen, Ausgaben, Gewinn und Monatsdiagramm](screenshot-auswertungen.png#only-light){ width="1440" height="900" loading="lazy" }
![Auswertungen 2026 mit Einnahmen, Ausgaben, Gewinn und Monatsdiagramm](screenshot-auswertungen-dunkel.png#only-dark){ width="1440" height="900" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Am Handy

Auf dem Handy und am Desktop installierst du Haben aus dem Browser als App, einen App Store braucht es dafür nicht.
Belege fotografierst du direkt oder teilst sie aus einer anderen App an Haben, und die Übersicht hast du unterwegs
dabei.

[Als App installieren](einrichtung.md#als-app-installieren)

</div>
<div class="showcase-phone" markdown>
![Übersicht auf dem Smartphone](screenshot-mobil.png#only-light){ width="390" height="844" loading="lazy" }
![Übersicht auf dem Smartphone](screenshot-mobil-dunkel.png#only-dark){ width="390" height="844" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>

## Hell, dunkel oder wie dein System

Haben hat sechs Themes, zwei davon dunkel. „Automatisch“ wechselt mit der Einstellung deines Geräts zwischen
Wald und Nacht. Zieh am H, um beide zu vergleichen. Rechnungen und PDFs sehen in jedem Theme gleich aus.

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

<div class="showcase-fragen" markdown>

## Was Haben außerdem kann

<div class="showcase-zeilen" markdown>
<div markdown>

### GmbH und UG

<div markdown>
Doppelte Buchführung mit Bilanz und GuV, E-Bilanz, Körperschaft- und Gewerbesteuererklärung und
Gewinnausschüttung mit Kapitalertragsteuer-Anmeldung. [GmbH und UG](gmbh.md)
</div>
</div>
<div markdown>

### Lohn

<div markdown>
Haben rechnet den Lohn für Gesellschafter-Geschäftsführer und Minijobs nach dem Programmablaufplan des BMF,
für Angestellte als Entwurf, und meldet die Lohnsteuer über ELSTER an. [Lohn](lohn.md)
</div>
</div>
<div markdown>

### Angebote

<div markdown>
Angebote mit eigenem Nummernkreis, Antwort des Kunden und der Rechnung aus dem Angebot, dazu
Auftragsbestätigung und Lieferschein. [Angebote](angebote.md)
</div>
</div>
<div markdown>

### Steuerberatung

<div markdown>
Deine Steuerberatung bekommt einen eigenen Zugang, der nur lesen darf: Auswertungen, Journal, Belege, DATEV-Export
und Jahresarchiv. [Zugang für die Steuerberatung](steuerberatung.md)
</div>
</div>
<div markdown>

### Fristen

<div markdown>
Voranmeldungen, Abgabefristen und Vorauszahlungen stehen im Kalender-Abo, auf Wunsch mit Erinnerung per
E-Mail. [Fristen](fristen.md)
</div>
</div>
<div markdown>

### KI-Assistenten

<div markdown>
Claude oder ein lokales Modell beantwortet Fragen zu deinen Büchern, etwa welche Rechnungen offen sind. Ändern
kann der Assistent nichts. [KI-Assistenten](ki-assistenten.md)
</div>
</div>
<div markdown>

### Bedienung per Tastatur

<div markdown>
Alles geht ohne Maus, und jede Seite wird bei jeder Änderung nach WCAG 2.2 AA geprüft.
[Barrierefreiheit und Tastatur](barrierefreiheit.md)
</div>
</div>
</div>

Jede Seite und jede Einstellung im Detail steht in der [Dokumentation](ueberblick.md).

</div>

<div class="showcase-installation" id="installation" markdown>

## Installation

Haben läuft als vier Container: die App, PostgreSQL, Caddy für HTTPS und ein tägliches Backup mit restic. Auf
einem Linux-Server mit Docker und einer Domain, die auf ihn zeigt (Ports 80 und 443), sind es diese Schritte:

```sh
mkdir haben && cd haben
curl -O https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.env.example
# in .env eintragen: DOMAIN, DB_PASSWORD (openssl rand -hex 24),
# AUTH_SECRET, ENCRYPTION_KEY und RESTIC_PASSWORD (je openssl rand -base64 32), dann
docker compose up -d
```

Danach öffnest du deine Domain im Browser und legst dein Konto an. `ENCRYPTION_KEY` und `RESTIC_PASSWORD`
sicherst du zusätzlich an einem zweiten Ort, denn ohne sie lassen sich verschlüsselte Zugänge und das Backup nicht
mehr lesen. Wie du Firmendaten, Nummernkreis und ELSTER
einrichtest, steht in [Erste Schritte](einrichtung.md). Podman Quadlets, Backup, Updates und alle
Umgebungsvariablen beschreibt [Betrieb und Installation](installation.md). Den Quellcode findest du
[auf GitHub](https://github.com/firsttris/haben).

[Zur Installationsanleitung](installation.md){ .md-button .md-button--primary } [Erste Schritte](einrichtung.md){ .md-button }

</div>
