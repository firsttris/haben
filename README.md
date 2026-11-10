<div align="center">

<h1>Haben: Open-Source-Buchhaltung, selbst gehostet</h1>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dunkel.png">
  <img src="docs/hero-hell.png" alt="Haben: Rechnung 2026-033 festgeschrieben, Zahlungseingang zugeordnet, Voranmeldung Oktober an ELSTER übermittelt" width="900">
</picture>

**Die Buchhaltungssoftware für Freiberufler, Selbstständige, Kleinunternehmer und kleine GmbHs, die du selbst betreibst.**<br>
Rechnungen mit E-Rechnung (ZUGFeRD, XRechnung), Belege, Bankabgleich, EÜR oder Bilanz mit E-Bilanz und die Steuern
direkt an ELSTER. Für die GoBD gebaut, auf deinem Server, ohne Datenabfluss.

![Status: Beta](https://img.shields.io/badge/Status-Beta-orange)
[![CI](https://github.com/firsttris/haben/actions/workflows/ci.yml/badge.svg)](https://github.com/firsttris/haben/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/firsttris/haben?logo=github&label=release)](https://github.com/firsttris/haben/releases/latest)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-blue)](LICENSE)
[![Doku](https://img.shields.io/badge/Doku-haben.app-4f46e5?logo=zensical&logoColor=white)](https://haben.app/)
[![Docker Pulls](https://img.shields.io/docker/pulls/tristanteu/haben?logo=docker&logoColor=white)](https://hub.docker.com/r/tristanteu/haben)

[Warum?](#warum-haben) •
[Funktionen](#funktionen) •
[Schnellstart](#schnellstart) •
[FAQ](#faq) •
[Dokumentation](https://haben.app/) •
[Entwicklung](#entwicklung)

<sub>English: self-hosted open-source bookkeeping for German freelancers, small businesses and small limited companies (GmbH, UG), with e-invoicing (ZUGFeRD, XRechnung), bank reconciliation, EÜR or balance sheet with E-Bilanz, and VAT, corporate and trade tax returns via ELSTER. The app and its [documentation](https://haben.app/) are in German.</sub>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-uebersicht-dunkel.png">
  <img src="docs/screenshot-uebersicht.png" alt="Übersicht in Haben: offene Forderungen, Umsatz, Umsatzsteuer-Zahllast, Kontostand und die nächsten Aufgaben" width="900">
</picture>

</div>

> [!WARNING]
> **Beta:** Haben wird noch stark weiterentwickelt. Datenmodell und Abläufe können sich von Version zu Version
> ändern, und Migrationen lassen sich nicht zurückspielen. Vor jedem Update ein Backup machen
> (`docker compose exec backup backup.sh`, siehe [Backup und Wiederherstellen](https://haben.app/installation.html#backup-und-wiederherstellen))
> und Auswertungen und Meldungen ans Finanzamt vor dem Absenden prüfen.

## <img src="docs/icons/info.svg" width="24" height="24" alt=""> Warum Haben?

In der Buchhaltung gibt es Soll und Haben. Haben ist, was dir gehört.

Rechnungen schreiben, Belege sammeln, Konto abgleichen, Voranmeldung schicken: Dafür braucht es kein Abo bei
Lexware Office (früher lexoffice) oder sevDesk und keinen fremden Dienst, der jede Rechnung sieht. Haben ist die
Open-Source-Alternative dazu: eine Web-App für Buchhaltung, Steuern und Rechnungen, die du mit Docker oder Podman
auf deinem eigenen Server betreibst.

**Aus Deutschland, für das deutsche Steuerrecht.**

- **Ein Weg vom Beleg bis zum Finanzamt**: festschreiben, Zahlung zuordnen, Voranmeldung prüfen und senden
- **Für die GoBD gebaut**: Festschreibung per Postgres-Trigger, Audit-Log, Korrekturen nur über Storno
- **Deine Daten bleiben bei dir**: eigener Server, Schlüssel verschlüsselt, Jahresarchiv mit Prüfsummen; KI nur auf Wunsch, auch mit eigenem Modell auf deinem Server
- **Umzug ohne Datenverlust**: Rechnungen, Belege, Buchungen und Kontakte aus Lexware Office, sevDesk, BuchhaltungsButler oder Accountable übernehmen, DATEV-Export archivieren
- **Für Freiberufler und Kleingewerbe**: Einnahmen-Überschuss-Rechnung (EÜR), Ist- oder Soll-Versteuerung,
  Kleinunternehmerregelung nach § 19 UStG, Kontenrahmen SKR03 oder SKR04
- **Für GmbH und UG**: Bilanz und GuV, E-Bilanz, Körperschaft- und Gewerbesteuer, Gewinnausschüttung mit
  Kapitalertragsteuer-Anmeldung und Steuerbescheinigung für die Gesellschafter, Pflichtangaben nach § 35a GmbHG auf
  Rechnungen und Geschäftsbriefen, siehe [GmbH und UG](https://haben.app/gmbh.html)

## <img src="docs/icons/overview.svg" width="24" height="24" alt=""> Funktionen

Kurz je Bereich, gegliedert wie die Navigation der App; die Details stehen auf der verlinkten Seite der
[Dokumentation](https://haben.app/).

### Verkauf

| Bereich | Was Haben kann |
|---|---|
| <img src="docs/icons/invoice.svg" width="20" height="20" alt=""> [Rechnungen](https://haben.app/rechnungen.html) | Live-Vorschau, ZUGFeRD/XRechnung (KoSIT-geprüft), Storno, Abschlags- und wiederkehrende Rechnungen, Skonto, GiroCode, [SEPA-Lastschrift](https://haben.app/rechnungen.html#lastschrift) mit Mandaten und Sammeldatei, Mahnwesen mit Basiszinssatz von der Bundesbank, Versand per E-Mail |
| <img src="docs/icons/quote.svg" width="20" height="20" alt=""> [Angebote](https://haben.app/angebote.html) | Optionale und alternative Positionen, Zahlungsplan mit Abschlagsrechnungen, [Auftragsbestätigung und Lieferschein](https://haben.app/angebote.html#auftragsbestätigung-und-lieferschein), mit einem Klick zur Rechnung |
| <img src="docs/icons/textblock.svg" width="20" height="20" alt=""> [Eigene Belegvorlagen](https://haben.app/belegvorlagen.html) | Eigenes Layout in Typst für Rechnung, Angebot, Auftragsbestätigung, Lieferschein und Mahnung, mit Schriften und Briefpapier |

### Ausgaben und Geld

| Bereich | Was Haben kann |
|---|---|
| <img src="docs/icons/receipt.svg" width="20" height="20" alt=""> [Belege](https://haben.app/belege.html) | Hochladen per Drag-and-drop, Kamera oder E-Mail; E-Rechnungen direkt gelesen, sonst optional per KI (Claude, Ollama, OpenRouter …); Dauerbelege, SEPA-Überweisung, § 13b und innergemeinschaftlicher Erwerb |
| <img src="docs/icons/bank.svg" width="20" height="20" alt=""> [Bankabgleich](https://haben.app/bank.html) | Automatischer Abruf per PSD2 oder Import (DKB, N26, CAMT.053, PayPal, Stripe, Etsy, Google Play, App Store …), Vorschläge mit Begründung, Rücklastschriften, Steuerzahlungen und Darlehen |
| <img src="docs/icons/cash.svg" width="20" height="20" alt=""> [Kasse](https://haben.app/kasse.html) · [Pauschalen](https://haben.app/pauschalen.html) | Kassenbuch für Barzahlungen und Bareinnahmen ohne Rechnung; Homeoffice, Kilometer, Verpflegungsmehraufwand |
| <img src="docs/icons/assets.svg" width="20" height="20" alt=""> [Anlagen und AfA](https://haben.app/anlagen.html) | Anlagenverzeichnis, lineare und degressive AfA, GWG und Sammelposten |
| <img src="docs/icons/payroll.svg" width="20" height="20" alt=""> [Lohn](https://haben.app/lohn.html) | Abrechnung nach dem Programmablaufplan des BMF, Minijob und Gesellschafter-Geschäftsführer, Lohnsteuer-Anmeldung über ELSTER, Lohnkonto |

### Steuern und Finanzamt

| Bereich | Was Haben kann |
|---|---|
| <img src="docs/icons/vat.svg" width="20" height="20" alt=""> [Voranmeldung](https://haben.app/umsatzsteuer.html) | Kennzahlen aus den Buchungen (Ist oder Soll) mit Herkunft jeder Zahl, Dauerfristverlängerung, Zusammenfassende Meldung |
| <img src="docs/icons/send.svg" width="20" height="20" alt=""> [Abgabe an ELSTER](https://haben.app/elster-abgabe.html) | Direkt per ERiC oder ohne Hersteller-ID über Mein ELSTER: XML-Upload, Browser-Erweiterung [Haben für Mein ELSTER](https://haben.app/elster-mit-erweiterung.html) oder ein [KI-Assistent](https://haben.app/elster-mit-assistent.html) wie Claude in Chrome |
| <img src="docs/icons/annual.svg" width="20" height="20" alt=""> [Jahreserklärungen](https://haben.app/jahreserklaerung.html) | USt-Erklärung, Anlage EÜR, Einkommensteuer; für GmbH und UG Körperschaft- und Gewerbesteuer |
| <img src="docs/icons/mail.svg" width="20" height="20" alt=""> [Finanzamt](https://haben.app/finanzamt.html) · [Fristen](https://haben.app/fristen.html) | Bescheide und Nachrichten über ELSTER, Herabsetzung der Vorauszahlungen; alle Steuertermine auf einer Seite, als Kalender-Feed (iCal) und per E-Mail |
| <img src="docs/icons/building.svg" width="20" height="20" alt=""> [GmbH und UG](https://haben.app/gmbh.html) | Bilanz und GuV, E-Bilanz per ERiC, Gesellschafter-Verrechnungskonto, Gewinnausschüttung mit Kapitalertragsteuer |

### Buchhaltung und Auswertungen

| Bereich | Was Haben kann |
|---|---|
| <img src="docs/icons/journal.svg" width="20" height="20" alt=""> [Buchhaltung](https://haben.app/buchhaltung.html) | Doppelte Buchführung nach SKR03/SKR04, Journal, freie Buchungen mit Steuerschlüssel, Saldenliste, Kontenblätter, DATEV-Export |
| <img src="docs/icons/reports.svg" width="20" height="20" alt=""> [Auswertungen](https://haben.app/auswertungen.html) | EÜR, offene Posten, Monatsverlauf, Jahresexport als ZIP mit SHA-256-Prüfsummen |
| <img src="docs/icons/archive.svg" width="20" height="20" alt=""> Umzug aus [Lexoffice](https://haben.app/lexoffice.html) · [sevDesk](https://haben.app/sevdesk.html) · [BuchhaltungsButler](https://haben.app/buchhaltungsbutler.html) · [Accountable](https://haben.app/accountable.html) · [JSON-Paket](https://haben.app/belegimport.html) | Rechnungen, Belege, Buchungen und Kontakte übernehmen oder im Archiv aufbewahren, mit Abgleich je Jahr |
| <img src="docs/icons/upload.svg" width="20" height="20" alt=""> [CSV-Import](https://haben.app/csv-import.html) | Kontakte, Artikel und Anlagen aus CSV, mit Spaltenzuordnung und Vorschau |

### Betrieb und Anbindung

| Bereich | Was Haben kann |
|---|---|
| <img src="docs/icons/key.svg" width="20" height="20" alt=""> [Anmeldung](https://haben.app/einrichtung.html#konto-anlegen) · [App](https://haben.app/einrichtung.html#als-app-installieren) | Passkey oder ausschließlich OpenID Connect mit Rollen aus Gruppen, Lesezugang für die [Steuerberatung](https://haben.app/steuerberatung.html), installierbar als App auf Handy und Desktop, helles und dunkles Theme |
| <img src="docs/icons/code.svg" width="20" height="20" alt=""> [REST-API](https://haben.app/api.html) | Versionierte Schnittstelle mit OpenAPI für Kontakte, Rechnungsentwürfe und Belege; Tokens mit Rechten je Bereich |
| <img src="docs/icons/chat.svg" width="20" height="20" alt=""> [KI-Assistenten (MCP)](https://haben.app/ki-assistenten.html) | Haben im Gespräch mit Claude oder einem lokalen Modell abfragen („Welche Rechnungen sind überfällig?“), nur lesend |
| <img src="docs/icons/external.svg" width="20" height="20" alt=""> [Eigene Seiten](https://haben.app/eigene-seiten.html) | Eigene Werkzeuge, etwa aus n8n, als Menüeintrag in Haben |
| <img src="docs/icons/access.svg" width="20" height="20" alt=""> [Barrierefreiheit](https://haben.app/barrierefreiheit.html) | Vollständig per Tastatur bedienbar, jede Seite in der CI gegen WCAG 2.2 AA geprüft |
| <img src="docs/icons/server.svg" width="20" height="20" alt=""> [Installation](https://haben.app/installation.html) | Docker Compose oder Podman Quadlets, Image für amd64 und arm64, tägliches Backup mit restic |

## <img src="docs/icons/eye.svg" width="24" height="24" alt=""> Screenshots

Hell oder dunkel, je nach Einstellung deines Systems.

<table>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-rechnung-dunkel.png"><img src="docs/screenshot-rechnung.png" alt="Rechnungseditor mit Positionen links und Live-Vorschau des PDFs rechts"></picture><br><sub><b>Rechnung schreiben</b>: Vorschau des PDFs, während du tippst</sub></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-bank-dunkel.png"><img src="docs/screenshot-bank.png" alt="Bankabgleich: Umsatz von Rheinpixel GmbH mit dem besten Treffer und den Gründen"></picture><br><sub><b>Bankabgleich</b>: Vorschlag mit Begründung, Enter ordnet zu</sub></td>
  </tr>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-umsatzsteuer-dunkel.png"><img src="docs/screenshot-umsatzsteuer.png" alt="Voranmeldung mit Kennzahlen 81, 86, 66 und 83, dem Bereich zum Übermitteln an ELSTER und dem Verlauf"></picture><br><sub><b>Voranmeldung</b>: aus den Buchungen berechnet, direkt an ELSTER</sub></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-auswertungen-dunkel.png"><img src="docs/screenshot-auswertungen.png" alt="Auswertungen mit Einnahmen, Ausgaben, Gewinn und Monatsdiagramm"></picture><br><sub><b>Auswertungen</b>: EÜR nach Zufluss und Abfluss</sub></td>
  </tr>
</table>

## <img src="docs/icons/server.svg" width="24" height="24" alt=""> Schnellstart

Haben läuft als vier Container: die App (`tristanteu/haben`, amd64 und arm64), PostgreSQL, Caddy für HTTPS und ein
tägliches Backup mit restic.
Du brauchst einen Linux-Server mit Docker oder Podman und eine Domain, die auf ihn zeigt (Ports 80 und 443),
denn Passkeys funktionieren nur über HTTPS.

### Von einem Agenten aufsetzen lassen

Gib Claude Code oder einem anderen Coding-Agenten dieses Repository und SSH-Zugang zu deinem Server und sag:
„Setz Haben auf meinem Server auf, nach der [Installationsanleitung](https://haben.app/installation.html).“

### Von Hand

```bash
mkdir haben && cd haben
curl -O https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.env.example
# in .env eintragen: DOMAIN, DB_PASSWORD (openssl rand -hex 24),
# AUTH_SECRET und ENCRYPTION_KEY (je openssl rand -base64 32), dann
docker compose up -d
```

Öffne **https://deine-domain**, leg dein Konto an und richte Firmendaten, Nummernkreis und ELSTER ein, wie in
[Erste Schritte](https://haben.app/einrichtung.html) beschrieben.

Podman Quadlets, ERiC für die ELSTER-Übermittlung, Backup, Updates und alle Umgebungsvariablen stehen in
[Betrieb und Installation](https://haben.app/installation.html).

> [!IMPORTANT]
> Sichere den Verschlüsselungsschlüssel (`ENCRYPTION_KEY` bzw. das Secret `haben-encryption-key`) zusätzlich an
> einem zweiten Ort. Ohne ihn sind ELSTER-Zertifikat und die Schlüssel für Lexoffice und sevDesk nach einer Wiederherstellung nicht mehr lesbar.

## <img src="docs/icons/help.svg" width="24" height="24" alt=""> FAQ

<details>
<summary><b>Was kostet Haben?</b></summary>

Die Software ist kostenlos (AGPL). Du brauchst nur einen Server, etwa einen VPS ab rund 5 € im Monat.
</details>

<details>
<summary><b>Ist Haben eine Alternative zu Lexware Office (lexoffice) und sevDesk?</b></summary>

Ja, ohne Abo und auf deinem eigenen Server. Rechnungen, Belege und Kontakte übernimmst du per API oder, bei
Lexware Office ohne Tarif XL, über eine Sicherung aus der Web-Oberfläche, siehe
[Umzug aus Lexoffice](https://haben.app/lexoffice.html) und [Umzug aus sevDesk](https://haben.app/sevdesk.html); Bestände aus BuchhaltungsButler und Accountable übernimmt Haben ins Archiv.
</details>

<details>
<summary><b>Für wen ist Haben gedacht?</b></summary>

Für Freiberufler, Selbstständige und Kleinunternehmer mit Einnahmen-Überschuss-Rechnung (EÜR), auch mit
Kleinunternehmerregelung nach § 19 UStG, und für kleine GmbHs und UGs. Eine GmbH oder UG bucht mit
Gesellschafter-Verrechnungskonto, sendet E-Bilanz, Körperschaft- und Gewerbesteuererklärung und schüttet Gewinne mit
Kapitalertragsteuer-Anmeldung aus, siehe [GmbH und UG](https://haben.app/gmbh.html). Den Lohn von
Gesellschafter-Geschäftsführer, Minijobs und (als Entwurf) Angestellten rechnet Haben und meldet die Lohnsteuer über ELSTER an,
siehe [Lohn](https://haben.app/lohn.html).
</details>

<details>
<summary><b>Ist Haben GoBD-konform?</b></summary>

Haben setzt die technischen Anforderungen der GoBD um: Gebuchtes wird festgeschrieben und lässt sich nur per Storno
korrigieren, jede Änderung steht im Audit-Log, und das Jahresarchiv hat SHA-256-Prüfsummen. Zur Ordnungsmäßigkeit
gehören außerdem dein Betrieb (Backups, Aufbewahrung) und deine Verfahrensdokumentation; ein Testat für die Software gibt
es nicht. Siehe [Buchhaltung in Haben](https://haben.app/buchhaltung.html).
</details>

<details>
<summary><b>Wie kommen Voranmeldung und Erklärungen zu ELSTER?</b></summary>

Direkt aus Haben oder über das Portal Mein ELSTER ([alle Wege im Vergleich](https://haben.app/elster-abgabe.html)):
- **Direkt aus Haben** per ERiC, für Voranmeldung, Umsatzsteuererklärung, Anlage EÜR und Einkommensteuer, dazu Bescheide
  aus dem ELSTER-Postfach. Dafür brauchst du eine eigene Hersteller-ID; die Beantragung dauert oft Wochen
  ([Erste Schritte](https://haben.app/einrichtung.html#elster-einrichten)).
- **Über Mein ELSTER**, ohne Hersteller-ID: Die Voranmeldung lädst du als XML-Datei hoch. Alle vier Formulare trägt
  die Browser-Erweiterung [Haben für Mein ELSTER](https://haben.app/elster-mit-erweiterung.html)
  ein, oder ein [KI-Assistent](https://haben.app/elster-mit-assistent.html) wie Claude in Chrome.
  Absenden machst du dort selbst; die Abgabe der Voranmeldung vermerkst du danach in Haben mit Transferticket und Protokoll.
</details>

<details>
<summary><b>Kann meine Steuerberatung damit arbeiten?</b></summary>

Ja, mit einem [eigenen Zugang](https://haben.app/steuerberatung.html), der nur lesen kann, oder über den
[DATEV-Export](https://haben.app/auswertungen.html#datev-export-für-die-steuerberatung) im Kontenrahmen SKR03 oder SKR04.
</details>

<details>
<summary><b>Können mehrere Personen Haben nutzen?</b></summary>

Haben ist für dich und deine eigene Firma gedacht: Es gibt genau einen Inhaber mit allen Rechten. Dazu kannst du deine
Steuerberatung per Einladungslink mit einem [Zugang, der nur lesen kann](https://haben.app/steuerberatung.html), dazuholen.
</details>

<details>
<summary><b>Kann ich Claude oder andere Agenten mit meiner Buchhaltung nutzen?</b></summary>

Ja, über MCP, und nur lesend: „Welche Rechnungen sind überfällig?“ Buchen und Senden an ELSTER
machst du weiter selbst. Siehe [KI-Assistenten (MCP)](https://haben.app/ki-assistenten.html). Für
eigene Werkzeuge und Automationen gibt es die [REST-API](https://haben.app/api.html).
</details>

<details>
<summary><b>Ist das sicher?</b></summary>

Wir prüfen automatisiert, und du kannst es auch: Der Code ist offen. Ein unabhängiges Audit gibt es bisher nicht.

- **Automatisiert geprüft:** mit Cloudflares [Security Audit Skill](https://github.com/cloudflare/security-audit-skill) und
  `/security-review` von Claude Code. Lass deinen Agenten gern selbst über dieses Repository laufen.
- **Abgesichert:** Zugangsdaten verschlüsselt in der Datenbank, ERiC getrennt vom App-Prozess, Rollen für Inhaber und
  Steuerberatung, Festschreibung per Datenbank-Trigger, Änderungsprotokoll als Hashkette.
- **Aktuell gehalten:** Renovate bringt Updates der Abhängigkeiten als Pull Request durch die CI; bekannte Lücken
  (Dependabot-Warnungen und OSV-Datenbank) behebt es außerhalb des Zeitplans, siehe
  [SECURITY.md](SECURITY.md#abhängigkeiten-aktuell-halten).
- **Offen für alle:** Jeder kann den Code lesen und Lücken melden, bitte vertraulich wie in [SECURITY.md](SECURITY.md)
  beschrieben.
</details>

## <img src="docs/icons/docs.svg" width="24" height="24" alt=""> Dokumentation

Alles im Detail, mit Suche: **https://haben.app/**. Jede Funktion oben verlinkt ihre Seite; dazu kommen:

- **Einstieg:** [Betrieb und Installation](https://haben.app/installation.html) (Docker Compose, Podman, Backup, Updates),
  [Erste Schritte](https://haben.app/einrichtung.html) (Konto, Firmendaten, ELSTER und Hersteller-ID) und
  [Abgabe an ELSTER](https://haben.app/elster-abgabe.html) (alle Wege zum Finanzamt im Vergleich)
- **Hintergrund:** [Buchhaltung in Haben](https://haben.app/buchhaltung.html) (GoBD, Kontenrahmen, alle Buchungssätze),
  [Architektur](https://haben.app/architektur.html) · [Entwicklung](https://haben.app/entwicklung.html) und [Roadmap](https://haben.app/roadmap.html)

## <img src="docs/icons/code.svg" width="24" height="24" alt=""> Entwicklung

Voraussetzungen: Bun 1.4.4, Git und PostgreSQL 18. Bun ist Laufzeit und Paketmanager zugleich.

```sh
bun install
cp apps/web/.env.example apps/web/.env   # DATABASE_URL, BETTER_AUTH_SECRET, HABEN_ENCRYPTION_KEY eintragen
bun run db:migrate
bun run dev                               # http://localhost:3000
```

Oder ohne Bun und PostgreSQL auf dem Rechner, mit Docker: `docker compose up` im Hauptordner startet Datenbank,
Migrationen und Dev-Server mit Neuladen beim Speichern
([Mit Docker Compose](https://haben.app/entwicklung.html#mit-docker-compose)).

Ohne ERiC (unter Einstellungen per Knopf von der Finanzverwaltung geladen) simuliert Haben die ELSTER-Übermittlung
und zeigt das deutlich an. Ohne `ANTHROPIC_API_KEY` oder `EXTRACTION_BASE_URL` (OpenAI-kompatibler Dienst wie Ollama oder OpenRouter) bleibt die KI-Auslesung aus.

**Stack**: TanStack Start (React-API mit TanStack Redact, Server Functions), PostgreSQL mit Drizzle, Better Auth mit Passkeys oder OIDC-SSO, Zod, Typst für
die Rechnungs-PDFs, `@e-invoice-eu/core` für ZUGFeRD und XRechnung, ERiC über `koffi` in einem eigenen Prozess,
Vitest und Playwright. Aufbau und Abläufe beschreibt die [Architektur](https://haben.app/architektur.html), alles Weitere
[Entwicklung](https://haben.app/entwicklung.html).

| Paket | Inhalt |
|---|---|
| `apps/web` | Oberfläche, Server Functions, Datenbank, Anmeldung |
| `packages/core` | Beträge, Zeiträume, Voranmeldung, EÜR, Buchungssätze, Zuordnungsvorschläge |
| `packages/einvoice` | Rechnungs-PDF, ZUGFeRD und XRechnung erzeugen, eingehende E-Rechnungen lesen |
| `packages/elster` | ERiC-Anbindung im Worker-Prozess, XML für Voranmeldung, Jahreserklärungen und Nachrichten, Postfach, Belege von ELSTER |
| `packages/import` | CSV-Import von Kontakten, Artikeln und Anlagen, Kontoauszüge (DKB, N26, CAMT.053), Exporte von Zahlungsdienstleistern (PayPal, Stripe, Shopify Payments, eBay), Kontoabruf über Enable Banking, DATEV-Buchungsstapel, Lexware Office (API und Web-Sicherung), sevDesk-API |
| `apps/elster-helfer` | Browser-Erweiterung „Haben für Mein ELSTER“ (TypeScript, Vite): trägt die Werte aus Haben in die Formulare ein |

## <img src="docs/icons/external.svg" width="24" height="24" alt=""> Mehr von uns

- Suchst du einen Ersatz für Gmail oder Google Workspace? **[Kontext](https://github.com/firsttris/kontext)**: Mail, Kalender, Kontakte, Chat und Telefonie für dein Team, auf deinem eigenen Server.
- Word, Excel und PowerPoint ohne Microsoft 365? **[Schreibzeug](https://github.com/firsttris/schreibzeug)** bearbeitet sie im Browser und speichert sie als .docx, .xlsx und .pptx.

## <img src="docs/icons/contacts.svg" width="24" height="24" alt=""> Mitwirken

Fehler und Ideen gern als Issue. Besonders hilfreich sind anonymisierte Kontoauszüge von Banken, die Haben noch nicht
kennt, und Rückmeldungen zur ELSTER-Übermittlung. Vor einem Pull Request bitte `bun run lint`, `bun run typecheck` und
`bun run test` laufen lassen (die Datenbanktests brauchen `TEST_DATABASE_URL`, siehe [Entwicklung](https://haben.app/entwicklung.html)).

## <img src="docs/icons/star.svg" width="24" height="24" alt=""> Sterne im Verlauf

<a href="https://www.star-history.com/#firsttris/haben&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=firsttris/haben&type=Date&theme=dark">
    <img alt="Verlauf der GitHub-Sterne von Haben" src="https://api.star-history.com/svg?repos=firsttris/haben&type=Date">
  </picture>
</a>

---

<div align="center">

<img src="docs/icons/star.svg" width="16" height="16" alt=""> Gefällt dir Haben? Ein [Stern auf GitHub](https://github.com/firsttris/haben) hilft anderen, es zu finden.<br>
<img src="docs/icons/bug.svg" width="16" height="16" alt=""> [Fehler melden](https://github.com/firsttris/haben/issues/new) · <img src="docs/icons/info.svg" width="16" height="16" alt=""> [Idee vorschlagen](https://github.com/firsttris/haben/issues/new)

<sub>Lizenz: <a href="LICENSE">AGPL-3.0</a> · © Tristan Teufel und Mitwirkende<br>
Wer Haben für andere betreibt, muss ihnen den Quellcode anbieten; der Link steht in der Navigation. Eine kommerzielle Lizenz ohne diese Pflichten gibt es über <a href="https://teufel-it.de">teufel-it.de</a>.<br>
Haben ist keine Steuerberatung. Konten, Kategorien und Aufbewahrung vor dem Echtbetrieb mit deiner Steuerberatung abgleichen.<br>
ELSTER ist eine Marke der Finanzverwaltung. Haben steht in keiner Verbindung zu Lexware, DATEV oder der Finanzverwaltung.</sub>

</div>
