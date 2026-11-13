---
title: "Alle Funktionen der Open-Source-Buchhaltung im Überblick"
description: >-
  Was Haben kann, Seite für Seite: Rechnungen, Belege, Bank, Umsatzsteuer, EÜR, Bilanz, Lohn und
  ELSTER – Betrieb, Einrichtung und Technik im Detail.
---

# Dokumentation

Den Rundgang in Bildern gibt die [Startseite](index.md), den schnellen
Überblick die [README auf GitHub](https://github.com/firsttris/haben#readme).

## Betrieb

| | |
|---|---|
| [Installation](installation.md) | Docker Compose, Podman Quadlets, Caddy, Secrets, eigener Reverse Proxy; dazu [Konfiguration](installation-konfiguration.md) (Datenbankrollen, Umgebungsvariablen), [Backup und Updates](installation-backup.md), [Anbindungen](installation-anbindungen.md) (ERiC, KI, Kontoabruf), [Single Sign-on](installation-sso.md) und [Häufige Probleme](installation-probleme.md) |
| [Erste Schritte](einrichtung.md) | Konto und Passkey, als App installieren, Firmendaten, Ist oder Soll, SKR03 oder SKR04, Nummernkreis, ELSTER und Hersteller-ID, E-Mail, KI-Auslesung, Bankkonten |

## Im Alltag

| | |
|---|---|
| [Rechnungen und E-Rechnung](rechnungen.md) | Editor, Artikelkatalog, Textbausteine, Festschreiben, ZUGFeRD und XRechnung, Pflichtangaben, Abschläge, wiederkehrende Rechnungen, Mahnwesen, Versand, Storno und Korrektur, Kontakte |
| [Eigene Belegvorlagen](belegvorlagen.md) | Eigene Layouts in Typst für Rechnung, Angebot, Auftragsbestätigung, Lieferschein und Mahnung: Felder, Schriften, Prüfung beim Hochladen, Anleitung für KI-Agenten |
| [Angebote](angebote.md) | Eigener Nummernkreis, PDF, optionale und alternative Positionen, Zahlungsplan mit Abschlägen, Versand per E-Mail, Antwort des Kunden, Rechnung aus dem Angebot, Auftragsbestätigung und Lieferschein |
| [Belege](belege.md) | Hochladen, Teilen am Handy, E-Rechnungen lesen, KI-Auslesung, Dauerbelege, Kategorien, Aufteilung auf mehrere Kategorien, Buchen |
| [Pauschalen](pauschalen.md) | Homeoffice-Tagespauschale, Fahrten mit dem Privatfahrzeug, Verpflegungsmehraufwand; Buchung und Storno |
| [Kassenbuch](kasse.md) | Barkasse: Einlage, Entnahme, Geldtransit, bar bezahlte Belege und Rechnungen; nie negativer Bestand, Storno |
| [Anlagen und AfA](anlagen.md) | Anlagenverzeichnis, lineare und degressive AfA, Anschaffung per Beleg, Übernahme aus Lexoffice, AfA buchen, Abgang |
| [Bankimport und Abgleich](bank.md) | Automatischer Abruf per PSD2 (Enable Banking), DKB, Commerzbank, C24, N26, Swan, CAMT.053, Zahlungsdienstleister, Dubletten, Saldenprüfung, Vorschläge, Teilzahlungen, Buchungen ohne Beleg, Steuerzahlungen, Darlehen |
| [Umsatzsteuer-Voranmeldung](umsatzsteuer.md) | Kennzahlen aus den Buchungen, Vorprüfung, Prüfen, Test- und Echtübermittlung, XML-Import in Mein ELSTER, Berichtigung, Zahlung an das Finanzamt, Dauerfristverlängerung, Zusammenfassende Meldung |
| [Finanzamt](finanzamt.md) | Bescheide aus dem ELSTER-Postfach, Einspruchsfrist, Nachrichten über ELSTER, Herabsetzung der Vorauszahlungen, Bankverbindung |
| [Fristen](fristen.md) | Voranmeldungen, Abgabefristen, Vorauszahlungen, Einspruchsfristen; Kalender-Abo und Erinnerungen per E-Mail |
| [Jahreserklärungen](jahreserklaerung.md) | Umsatzsteuererklärung, Anlage EÜR mit AVEÜR und Einkommensteuererklärung, für GmbH und UG Körperschaft- und Gewerbesteuererklärung, Prüfen, Test- und Echtübermittlung, Belege von ELSTER |
| [GmbH und UG](gmbh.md) | Ablauf eines Jahres mit doppelter Buchführung: Einrichten, Bilanz und GuV, Jahresabschluss, E-Bilanz, Körperschaft- und Gewerbesteuer, Gewinnausschüttung, Hinterlegung |
| [Abgabe an ELSTER](elster-abgabe.md) | Alle Wege im Überblick: direkt per ERiC mit Hersteller-ID oder über Mein ELSTER mit XML-Import, Erweiterung, KI-Assistent oder von Hand |
| [Lohn](lohn.md) | Mitarbeiter, Abrechnung je Monat (Geschäftsführer, Minijob, Angestellte als Entwurf), festschreiben und stornieren, Entgeltabrechnung als PDF, Lohnkonto, Lohnsteuer-Anmeldung, Ausfüllliste für das SV-Meldeportal, Lohnsteuerbescheinigung |
| [Mein ELSTER mit Erweiterung](elster-mit-erweiterung.md) | Ohne Hersteller-ID: die Browser-Erweiterung trägt Voranmeldung, USt-Erklärung, EÜR und Einkommensteuer in Mein ELSTER ein, du sendest ab |
| [Auswertungen und Jahresexport](auswertungen.md) | EÜR, offene Posten, Monatsverlauf, CSV, Archiv-ZIP mit Prüfsummen, Aufbewahrung |
| [Umzug aus Lexoffice](lexoffice.md) | API-Abruf, Sicherung über die Web-Oberfläche oder Umzug nur über die Exporte, DATEV-Buchungsstapel, Originalexporte, offene Posten, Abgleich vor der Kündigung |
| [Umzug aus sevDesk](sevdesk.md) | API-Abruf aus sevDesk ins selbe Archiv, Unterschiede zu Lexoffice |
| [Umzug aus BuchhaltungsButler](buchhaltungsbutler.md) | BB Standardexport, DATEV-Stapel und Original-PDFs mit Testlauf archivieren |
| [Umzug aus Accountable](accountable.md) | Exportdatei hochladen, DATEV-Buchungsstapel und Belege verknüpfen, ohne API-Zugang |
| [Umzug aus WISO EÜR & Kasse](wiso.md) | Wechsel zum 1. Januar vorbereiten, Originalexporte sichern, Kontakte, Artikel und Anlagen per CSV übernehmen, Grenzen bei offenen Posten |
| [Belegimport](belegimport.md) | Geprüfte Bestände als JSON-Paket per Betreiber-CLI übernehmen, mit Herkunft und Prüflauf |
| [KI-Assistenten (MCP)](ki-assistenten.md) | Haben im Gespräch mit Claude Code, Claude Desktop oder einem lokalen Modell abfragen; nur lesen, API-Tokens, Datenschutz |
| [CSV-Import](csv-import.md) | Kontakte, Artikel und Anlagen aus CSV: Trennzeichen und Kodierung erkennen, Spalten zuordnen, Vorschau mit Fehlern je Zeile, Dubletten überspringen |
| [REST-API](api.md) | Kontakte und Rechnungsentwürfe aus eigenen Werkzeugen, mit Bestellnummer ohne Duplikate; Belege aus Dokumentenarchiven und Skripten; OpenAPI, Rechte je Token, Beispiele mit curl |
| [Eigene Seiten](eigene-seiten.md) | Eigene Werkzeuge wie eine Bestellübersicht aus n8n als Menüeintrag, im Rahmen angezeigt |
| [Zugang für die Steuerberatung](steuerberatung.md) | Eigener Zugang per Einladungslink, nur lesen: Auswertungen, Journal, Konten, Belege, Rechnungen, DATEV und Jahresarchiv |
| [Mein ELSTER mit KI-Assistent](elster-mit-assistent.md) | Ohne Hersteller-ID in Mein ELSTER abgeben: der Assistent trägt die Kennzahlen ein, du sendest ab |
| [Barrierefreiheit und Tastatur](barrierefreiheit.md) | Bedienung ohne Maus, Tastenkürzel, Kontraste in allen Themes, Prüfung mit axe-core nach WCAG 2.2 AA |

## Hintergrund

| | |
|---|---|
| [Buchhaltung in Haben](buchhaltung.md) | Grundsätze, GoBD und Festschreibung, Ist und Soll, Kontenrahmen, alle Buchungssätze, Steuerschlüssel |
| [Architektur](architektur.md) | Module, Datenmodell, Ablauf von Anfragen, Dateiablage, ERiC-Worker, E-Rechnung, Sicherheit |
| [Entwicklung](entwicklung.md) | Lokale Umgebung, Befehle, Tests, Migrationen, Konventionen, neue Bankformate, Mitwirken |
| [Roadmap](roadmap.md) | Wo die Planung steht, was bewusst nicht kommt, was blockiert ist, Quellen für Feldkennungen |
| [Lohn (Plan)](lohn-plan.md) | Recherche und Umsetzungsplan für den Lohn: Pull Requests, Pflichten einer Lohnsoftware, offene Fragen, Quellen |

## Screenshots

<img src="screenshot-rechnung.png#only-light" alt="Rechnungseditor mit Live-Vorschau" width="900">
<img src="screenshot-rechnung-dunkel.png#only-dark" alt="Rechnungseditor mit Live-Vorschau" width="900">

<img src="screenshot-bank.png#only-light" alt="Bankabgleich mit Vorschlag und Begründung" width="900">
<img src="screenshot-bank-dunkel.png#only-dark" alt="Bankabgleich mit Vorschlag und Begründung" width="900">

<img src="screenshot-umsatzsteuer.png#only-light" alt="Umsatzsteuer-Voranmeldung mit Kennzahlen und ELSTER-Übermittlung" width="900">
<img src="screenshot-umsatzsteuer-dunkel.png#only-dark" alt="Umsatzsteuer-Voranmeldung mit Kennzahlen und ELSTER-Übermittlung" width="900">

<img src="screenshot-auswertungen.png#only-light" alt="Auswertungen mit EÜR und Monatsdiagramm" width="900">
<img src="screenshot-auswertungen-dunkel.png#only-dark" alt="Auswertungen mit EÜR und Monatsdiagramm" width="900">

<img src="screenshot-archiv.png#only-light" alt="Archiv mit Umzug aus Lexoffice und Abgleich je Jahr" width="900">
<img src="screenshot-archiv-dunkel.png#only-dark" alt="Archiv mit Umzug aus Lexoffice und Abgleich je Jahr" width="900">

<img src="screenshot-mobil.png#only-light" alt="Übersicht auf dem Smartphone" width="320">
<img src="screenshot-mobil-dunkel.png#only-dark" alt="Übersicht auf dem Smartphone" width="320">
