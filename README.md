<div align="center">

<img src="docs/banner.png" alt="Haben: Rechnung 2026-031 festgeschrieben, Zahlungseingang zugeordnet, Voranmeldung September an ELSTER übermittelt" width="900">

**Die Buchhaltung für Freiberufler, die du selbst betreibst.**<br>
Rechnungen mit E-Rechnung, Belege, Bankabgleich, EÜR und die monatliche Umsatzsteuer-Voranmeldung direkt an ELSTER.
Auf deinem Server, ohne Abo, ohne Datenabfluss.

[![CI](https://github.com/firsttris/haben/actions/workflows/ci.yml/badge.svg)](https://github.com/firsttris/haben/actions/workflows/ci.yml)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-blue)](LICENSE)
[![E-Rechnung](https://img.shields.io/badge/E--Rechnung-ZUGFeRD%20%7C%20XRechnung-1f6f5c)](docs/rechnungen.md)
[![ELSTER](https://img.shields.io/badge/ELSTER-ERiC-1f6f5c)](docs/umsatzsteuer.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![TanStack Start](https://img.shields.io/badge/TanStack-Start-ff4154)](https://tanstack.com/start)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker Pulls](https://img.shields.io/docker/pulls/tristanteu/haben?logo=docker&logoColor=white)](https://hub.docker.com/r/tristanteu/haben)
[![Image Size](https://img.shields.io/docker/image-size/tristanteu/haben/latest?logo=docker&logoColor=white&label=image)](https://hub.docker.com/r/tristanteu/haben)
[![Plattformen](https://img.shields.io/badge/platform-amd64%20%7C%20arm64-lightgrey)](https://hub.docker.com/r/tristanteu/haben/tags)
[![Podman](https://img.shields.io/badge/Betrieb-Podman%20Quadlets-892ca0?logo=podman&logoColor=white)](docs/installation.md)

[Warum?](#-warum-haben) •
[Funktionen](#-funktionen) •
[Schnellstart](#-schnellstart) •
[Dokumentation](https://firsttris.github.io/haben/) •
[Entwicklung](#-entwicklung)

<img src="docs/screenshot-uebersicht.png" alt="Übersicht in Haben: offene Forderungen, Umsatz, Umsatzsteuer-Zahllast, Kontostand und die nächsten Aufgaben" width="900">

</div>

## 💡 Warum Haben?

Als Freiberufler schreibst du Rechnungen, sammelst Belege, gleichst das Konto ab und schickst die Voranmeldung.
Dafür braucht es kein Abo bei Lexware Office oder sevDesk und keinen fremden Dienst, der jede Rechnung sieht.

- **Ein Weg vom Beleg bis zum Finanzamt**: festschreiben, Zahlung zuordnen, Voranmeldung prüfen und senden
- **GoBD-konform von Anfang an**: Festschreibung per Postgres-Trigger, Audit-Log, Korrekturen nur über Storno
- **Deine Daten bleiben bei dir**: eigener Server, Schlüssel verschlüsselt, Jahresarchiv mit Prüfsummen; KI nur auf Wunsch
- **Umzug ohne Datenverlust**: Rechnungen, Belege und Kontakte aus Lexware Office übernehmen, DATEV-Export archivieren

## ✨ Funktionen

| Bereich | Was Haben kann |
|---|---|
| 🧾 [Rechnungen](docs/rechnungen.md) | Live-Vorschau, ZUGFeRD/XRechnung (KoSIT-geprüft), Storno, Reverse Charge, § 19 UStG, Abschlagsrechnungen, wiederkehrende Rechnungen, Mahnwesen, Versand per E-Mail |
| 📝 [Angebote](docs/angebote.md) | Eigener Nummernkreis, PDF und Versand, mit einem Klick zur Rechnung |
| 📎 [Belege](docs/belege.md) | Drag-and-drop, Kamera, Teilen am Handy oder per E-Mail (IMAP); E-Rechnungen direkt gelesen, sonst optional per KI |
| 🏦 [Bankabgleich](docs/bank.md) | Automatischer Abruf per PSD2 oder Import (DKB, N26, CAMT.053), Vorschläge mit Begründung, Teil- und Sammelzahlungen |
| 📤 [Voranmeldung](docs/umsatzsteuer.md) | Kennzahlen aus den Buchungen (Ist oder Soll), Herkunft jeder Zahl, Vorprüfung, Übermittlung per ERiC, Berichtigung |
| 📑 [Jahreserklärungen](docs/jahreserklaerung.md) | USt-Erklärung, Anlage EÜR mit AVEÜR, Einkommensteuererklärung; vorausgefüllte Belege von ELSTER abrufen |
| 🏛️ [Finanzamt](docs/finanzamt.md) | Bescheide und Nachrichten über ELSTER, Herabsetzung der Vorauszahlungen mit Steuerprognose |
| ⏰ [Fristen](docs/fristen.md) | Alle Steuertermine auf einer Seite, als Kalender-Abo und per E-Mail |
| 🚗 [Pauschalen](docs/pauschalen.md) · [Kasse](docs/kasse.md) | Homeoffice, Kilometer, Verpflegungsmehraufwand; Kassenbuch für Barzahlungen |
| 🖥️ [Anlagen und AfA](docs/anlagen.md) | Anlagenverzeichnis, lineare AfA, GWG und Sammelposten, AfA-Buchung zum Jahresende |
| 📊 [Auswertungen](docs/auswertungen.md) | EÜR, offene Posten, Monatsverlauf, Jahresexport als ZIP mit SHA-256-Prüfsummen |
| 📚 [Buchhaltung](docs/buchhaltung.md) | Doppelte Buchführung nach SKR03/SKR04, Journal, Saldenliste, Kontenblätter, DATEV-Export |
| 📦 [Umzug aus Lexoffice](docs/lexoffice.md) | Abruf über die Public API, DATEV-Buchungsstapel, offene Posten und Anlagen übernehmen |
| 🔐 Anmeldung und App | Passkey (Passwort als Ersatz), installierbar als PWA auf Handy und Desktop |

## 📸 Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshot-rechnung.png" alt="Rechnungseditor mit Positionen links und Live-Vorschau des PDFs rechts"><br><sub><b>Rechnung schreiben</b>: Vorschau des PDFs, während du tippst</sub></td>
    <td width="50%"><img src="docs/screenshot-bank.png" alt="Bankabgleich: Umsatz von Rheinpixel GmbH mit dem besten Treffer Rechnung 2026-033 und den Gründen"><br><sub><b>Bankabgleich</b>: Vorschlag mit Begründung, Enter ordnet zu</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshot-umsatzsteuer.png" alt="Voranmeldung September mit Kennzahlen 81, 86, 66 und 83 und dem Bereich zum Übermitteln an ELSTER"><br><sub><b>Voranmeldung</b>: aus den Buchungen berechnet, direkt an ELSTER</sub></td>
    <td width="50%"><img src="docs/screenshot-auswertungen.png" alt="Auswertungen 2026 mit Einnahmen, Ausgaben, Gewinn und Monatsdiagramm"><br><sub><b>Auswertungen</b>: EÜR nach Zufluss und Abfluss</sub></td>
  </tr>
</table>

## 🚀 Schnellstart

Haben läuft als drei Container: die App (`tristanteu/haben`, amd64 und arm64), PostgreSQL und Caddy für HTTPS.
Du brauchst einen Linux-Server mit Docker oder Podman und eine Domain, die auf ihn zeigt (Ports 80 und 443),
denn Passkeys funktionieren nur über HTTPS.

```bash
mkdir haben && cd haben
curl -O https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.env.example
# in .env eintragen: DOMAIN, DB_PASSWORD (openssl rand -hex 24),
# AUTH_SECRET und ENCRYPTION_KEY (je openssl rand -base64 32), dann
docker compose up -d
```

Öffne **https://deine-domain**, leg dein Konto an und richte Firmendaten, Nummernkreis und ELSTER ein, wie in
[Erste Schritte](docs/einrichtung.md) beschrieben.

Podman Quadlets, ERiC für die ELSTER-Übermittlung, Backup, Updates und alle Umgebungsvariablen stehen in
[Betrieb und Installation](docs/installation.md).

> [!IMPORTANT]
> Sichere den Verschlüsselungsschlüssel (`ENCRYPTION_KEY` bzw. das Secret `haben-encryption-key`) zusätzlich an
> einem zweiten Ort. Ohne ihn sind ELSTER-Zertifikat und Lexoffice-Schlüssel nach einer Wiederherstellung nicht mehr lesbar.

## 📚 Dokumentation

Alles im Detail steht in der [Dokumentation](docs/README.md): [Installation](docs/installation.md),
[Erste Schritte](docs/einrichtung.md), jede Funktion einzeln, [Buchhaltung](docs/buchhaltung.md),
[Architektur](docs/architektur.md) und [Roadmap](docs/roadmap.md).

## 🔧 Entwicklung

Voraussetzungen: Node 22, pnpm 10 und PostgreSQL 16.

```sh
pnpm install
cp apps/web/.env.example apps/web/.env   # DATABASE_URL, BETTER_AUTH_SECRET, HABEN_ENCRYPTION_KEY eintragen
pnpm db:migrate
pnpm dev                                  # http://localhost:3000
```

Ohne ERiC (unter Einstellungen per Knopf von der Finanzverwaltung geladen) simuliert Haben die ELSTER-Übermittlung und zeigt das deutlich an. Ohne `ANTHROPIC_API_KEY` bleibt
die KI-Auslesung aus.

**Stack**: TanStack Start (React, Server Functions), PostgreSQL mit Drizzle, Better Auth mit Passkeys, Zod, Typst für
die Rechnungs-PDFs, `@e-invoice-eu/core` für ZUGFeRD und XRechnung, ERiC über `koffi` in einem eigenen Prozess,
Vitest und Playwright. Aufbau und Abläufe beschreibt die [Architektur](docs/architektur.md), alles Weitere
[Entwicklung](docs/entwicklung.md).

| Paket | Inhalt |
|---|---|
| `apps/web` | Oberfläche, Server Functions, Datenbank, Anmeldung |
| `packages/core` | Beträge, Zeiträume, Voranmeldung, EÜR, Buchungssätze, Zuordnungsvorschläge |
| `packages/einvoice` | Rechnungs-PDF, ZUGFeRD und XRechnung erzeugen, eingehende E-Rechnungen lesen |
| `packages/elster` | ERiC-Anbindung, UStVA-XML, Worker-Prozess |
| `packages/import` | Kontoauszüge (DKB, N26, CAMT.053), DATEV-Buchungsstapel, Lexware-Office-API |

## 🤝 Mitwirken

Fehler und Ideen gern als Issue. Besonders hilfreich sind anonymisierte Kontoauszüge von Banken, die Haben noch nicht
kennt, und Rückmeldungen zur ELSTER-Übermittlung. Vor einem Pull Request bitte `pnpm lint`, `pnpm typecheck` und
`pnpm test` laufen lassen (die Datenbanktests brauchen `TEST_DATABASE_URL`, siehe [Entwicklung](docs/entwicklung.md)).

---

<div align="center">
<sub>Haben ist keine Steuerberatung. Konten, Kategorien und Aufbewahrung vor dem Echtbetrieb mit deiner Steuerberatung abgleichen.<br>
Lizenz: <a href="LICENSE">AGPL-3.0</a>. Wer Haben für andere betreibt, muss ihnen den Quellcode anbieten; der Link steht in der Navigation.<br>
ELSTER ist eine Marke der Finanzverwaltung. Haben steht in keiner Verbindung zu Lexware, DATEV oder der Finanzverwaltung.</sub>
</div>
