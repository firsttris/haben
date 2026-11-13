---
title: "ERiC, KI-Auslesung, Kontoabruf einbinden"
description: >-
  ERiC für ELSTER einbinden (auch auf arm64), KI-Auslesung mit Anthropic oder einem OpenAI-kompatiblen Dienst wie Ollama, Kontoabruf über Enable Banking.
---

# Anbindungen

## ERiC einbinden

ERiC ist die Bibliothek der Finanzverwaltung für ELSTER. Sie ist kostenlos, darf aber nicht mit Haben weitergegeben werden. Deshalb lädt Haben sie auf deinen Wunsch direkt von `download.elster.de` auf deinen Server, nur den Teil für Linux x86_64 (rund 300 MB). Mit dem Download stimmst du den [Nutzungsbedingungen von ERiC](https://www.elster.de/elsterweb/entwickler/infoseite/eric) zu.

| Weg | So geht's |
| --- | --- |
| Per Knopf | **Einstellungen › ELSTER › ERiC**: Version prüfen, den Nutzungsbedingungen zustimmen, **Herunterladen und einrichten**. Der Download läuft im Hintergrund; danach prüft und sendet Haben ohne Neustart über ERiC |
| Beim Start | `ERIC_AUTO_INSTALL=ja` in `.env` bzw. `haben.env`. Fehlt ERiC, lädt der Container es vor dem Start der App; schlägt das fehl, startet die App trotzdem (simuliert) |
| Auf der Kommandozeile | `docker compose exec app bun /app/packages/elster/src/install-cli.ts --lizenz-akzeptiert [Version]` bzw. `podman exec haben-app …` |

Weil ERiC als native Bibliothek geladen wird, prüft Haben den Download: Er darf nur auf demselben Server weitergeleitet werden, ist auf 1 GB begrenzt, und seine SHA-256 steht danach im Log und in `HABEN_ERIC_SHA256` im Versionsordner. Mit `ERIC_SHA256` legst du die erwartete Prüfsumme fest, etwa die einer Installation, der du schon vertraust; weicht der Download ab, installiert Haben ihn nicht.

ERiC landet im Volume `eric` bzw. `haben-eric` (`ERIC_DIR=/var/lib/haben/eric`), je Version in einem Unterordner; die Datei `AKTUELL` zeigt auf die aktive. Eine neue Version ersetzt die alte erst, wenn sie vollständig entpackt ist. Das Paket selbst (rund 520 MB) lädt Haben in einen Ordner `.download-…` im selben Volume und löscht ihn nach dem Entpacken, Reste einer abgebrochenen Installation beim nächsten Versuch; nach `/tmp` geht es nicht, denn das liegt im gehärteten Container im Arbeitsspeicher. Während der Installation braucht das Volume deshalb kurz rund 800 MB frei; die bisherige Version bleibt bis zum Umschalten liegen. Die Version, die Haben vorschlägt, ist die zuletzt bekannte; die aktuelle steht auf der Infoseite. Die Finanzverwaltung stellt alte Versionen nach einiger Zeit ab, und Vordrucke eines neuen Jahres (etwa die Jahreserklärungen) brauchen meist eine neue Version. Dann die neue Versionsnummer eintragen und erneut laden.

Zum Prüfen und Übermitteln brauchst du zusätzlich eine eigene Hersteller-ID; ERiC 43 nimmt die frühere Test-Hersteller-ID nicht mehr an. Vor der ersten Nutzung bestätigst du außerdem unter **Einstellungen › ELSTER › ERiC** die Datenschutzhinweise der Finanzverwaltung, wie es der ERiC-Lizenzvertrag verlangt. Siehe [Erste Schritte](einrichtung.md#elster-einrichten), dort auch, wer bei Haben als Hersteller gilt.

Lieber von Hand? Entpacke das Paket auf dem Host nach `/opt/eric`, sodass `/opt/eric/lib/libericapi.so` und `/opt/eric/lib/plugins/` existieren (bei älteren ERiC-Versionen `lib/plugins2/`), und binde es ein. `ERIC_HOME` hat Vorrang vor dem heruntergeladenen ERiC.

| | Compose | Quadlet |
| --- | --- | --- |
| Verzeichnis mounten | in `compose.yml` die Zeile `- /opt/eric:/opt/eric:ro` einkommentieren | in `haben-app.container` die Zeile `Volume=/opt/eric:/opt/eric:ro` einkommentieren |
| Variable | `ERIC_HOME=/opt/eric` in `.env` | `ERIC_HOME=/opt/eric` in `haben.env` einkommentieren |
| Neu starten | `docker compose up -d` | `systemctl --user daemon-reload && systemctl --user restart haben-app` |

ERiC läuft nie im App-Prozess. Jede Prüfung und jede Übermittlung startet einen kurzlebigen Kindprozess, der die Bibliothek lädt. Ohne ERiC nutzt Haben einen simulierten Client; die Oberfläche zeigt dann „ERiC ist nicht eingerichtet“ an, und nichts geht an das Finanzamt.

### ELSTER auf arm64

ERiC gibt die Finanzverwaltung nur als fertige Bibliothek heraus, für Server nur für Linux x86_64; selbst übersetzen lässt sie sich nicht. Auf einem arm64-Server (Raspberry Pi, Ampere, Jetson) läuft Haben trotzdem nativ: Emuliert wird nur der kurzlebige Kindprozess, der für jede Prüfung und Übermittlung ERiC lädt. `ERIC_WORKER_COMMAND` startet ihn mit QEMU als x86_64-Prozess, mit Bun und den Bibliotheken aus dem amd64-Image derselben Haben-Version.

Das kostet Zeit: Auf einem Jetson AGX Orin dauerte ein ERiC-Aufruf emuliert rund 25 Sekunden statt einer, fast alles davon das Laden von ERiC. Für gelegentliche Meldungen reicht das; nach 120 Sekunden bricht Haben einen Aufruf ab.

1. **QEMU besorgen:** ein statisch gebautes `qemu-x86_64` (User-Mode) ab Version 9; mit 8.2 stürzt Bun schon beim Start ab. Debian ab 13 hat es im Paket `qemu-user` (`/usr/bin/qemu-x86_64`), ältere Systeme wie Ubuntu 24.04 nur 8.2 in `qemu-user-static`. Das Programm aus dem Debian-Paket läuft auch dort, z. B. mit `apt-get download qemu-user` in einem Container mit `debian:trixie` und `dpkg-deb -x`.
2. **Laufzeit anlegen:** auf dem Host als root, mit derselben Version wie das App-Image. Das Skript kommt vom Tag dieser Version, damit Skript und App zusammenpassen:
   ```sh
   VERSION=x.y.z   # Version deines App-Images
   curl -O https://raw.githubusercontent.com/firsttris/haben/v$VERSION/deploy/eric-x86_64/einrichten.sh
   sudo QEMU=/pfad/zu/qemu-x86_64 sh einrichten.sh $VERSION /opt/haben-x86_64
   ```
   Das Skript lädt das amd64-Image von Haben, entpackt es nach `/opt/haben-x86_64/root` (rund 730 MB), kopiert QEMU daneben und legt `worker.sh` an, den Befehl für `ERIC_WORKER_COMMAND`. Den lokalen Tag des Images setzt es danach zurück: Lag das Image der App schon auf dem Rechner, zeigt der Tag wieder darauf, sonst wird er entfernt. So startet die App beim nächsten Mal nicht das amd64-Image.
3. **In der App einbinden** und neu starten:

   | | Compose | Quadlet |
   | --- | --- | --- |
   | Verzeichnis mounten | in `compose.yml` die Zeile `- /opt/haben-x86_64:/opt/haben-x86_64:ro` einkommentieren | in `haben-app.container` die Zeile `Volume=/opt/haben-x86_64:/opt/haben-x86_64:ro` einkommentieren |
   | Variable | `ERIC_WORKER_COMMAND=/opt/haben-x86_64/worker.sh` in `.env` | `ERIC_WORKER_COMMAND=/opt/haben-x86_64/worker.sh` in `haben.env` einkommentieren |
   | Neu starten | `docker compose up -d` | `systemctl --user daemon-reload && systemctl --user restart haben-app` |

4. **ERiC laden** wie oben unter [ERiC einbinden](#eric-einbinden); mit `ERIC_WORKER_COMMAND` bietet Haben den Download auch auf arm64 an.

Ausprobiert sind so bisher Prüfen, Belegabruf, Berechtigungen und Postfach mit echtem ERiC. **Eine echte Übermittlung an ELSTER unter QEMU hat noch niemand getestet.** Der Weg ist derselbe wie beim Prüfen, nur mit Zertifikat und Netz. Prüfe deine erste Meldung danach im ELSTER-Portal.

Nach jedem Update von Haben `einrichten.sh` mit der neuen Version wiederholen. `worker.sh` vergleicht beide Versionen und startet nicht, wenn sie verschieden sind; Haben zeigt dann „x86_64-Laufzeit für ERiC ist Version …“ an.

Warum ein Skript statt nur QEMU: `worker.sh` setzt vorher `ulimit -s unlimited`. Dann vergibt Linux den Speicher von unten, unterhalb der 47-Bit-Grenze, die Bun (JavaScriptCore) auf x86_64 voraussetzt; sonst landet er unter QEMU an höheren Adressen, und Bun bricht mit „MemoryExhaustion“ ab. Außerdem startet es `worker.ts` aus der x86_64-Laufzeit, weil deren `node_modules` koffi für x86_64 enthalten.

## KI-Auslesung (Anthropic)

Optional. Ist `ANTHROPIC_API_KEY` gesetzt, liest Haben Belege, die keine E-Rechnung sind, mit Claude aus:

```sh
read -rs KEY   # Schlüssel einfügen, Enter; so landet er nicht in der Shell-Historie
printf '%s' "$KEY" | podman secret create haben-anthropic-key - && unset KEY
# in haben-app.container die Zeile "Secret=haben-anthropic-key,…" einkommentieren
systemctl --user daemon-reload && systemctl --user restart haben-app
```

Was an Anthropic geht und wann:

- Gesendet wird die Belegdatei selbst (PDF, JPEG, PNG oder WebP, base64-kodiert), zusammen mit einer festen Anweisung und der Liste der Ausgabenkategorien. Weitere Daten aus Haben (Firmendaten, Buchungen, Kontakte) gehen nicht mit.
- Das passiert automatisch direkt nach dem Hochladen, wenn die Datei keine lesbare E-Rechnung (ZUGFeRD, XRechnung) ist, und wenn du auf einem Beleg „Mit KI neu auslesen“ wählst.
- E-Rechnungen liest Haben immer lokal. HEIC-Fotos kann die KI nicht lesen.
- Die Felder werden nur vorbefüllt; gebucht wird erst nach deiner Bestätigung.

Ohne Schlüssel bleibt alles lokal, und du füllst die Felder von Hand aus. Mehr dazu in [Belege](belege.md).

## KI-Auslesung über OpenAI-kompatible Schnittstelle

Optional und statt Anthropic. Haben spricht jeden Dienst an, der die OpenAI-Schnittstelle `POST /v1/chat/completions` anbietet. Das kann ein selbst betriebenes Modell sein, etwa mit [Ollama](https://docs.ollama.com/api/openai-compatibility), LM Studio, vLLM oder Docker Model Runner (`docker model run`), oder ein Dienst in der Cloud wie [OpenRouter](https://openrouter.ai/docs/quickstart), OpenAI oder ein anderer Anbieter mit OpenAI-kompatibler API. Ein schon laufender Dienst genügt; einen Modell-Container bringt Haben nicht mit. Das Modell muss Bilder lesen können (Vision-Modell, z. B. aus der Qwen-VL-Familie wie `qwen2.5vl`). Ein reines Textmodell oder reine Texterkennung (OCR) genügt nicht: Haben braucht die Belegfelder, nicht nur den Text.

```sh
# .env (Compose) bzw. haben.env (Quadlets)
EXTRACTION_BASE_URL=http://host.docker.internal:11434/v1
EXTRACTION_MODEL=qwen2.5vl:7b
```

Für einen Dienst in der Cloud kommen Adresse, Modellname und Schlüssel vom Anbieter, etwa für OpenRouter:

```sh
EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
EXTRACTION_MODEL=qwen/qwen2.5-vl-72b-instruct   # Modellname wie in der Modellliste des Anbieters, mit Bildeingabe
EXTRACTION_API_KEY=sk-or-…                      # Quadlets: als Secret haben-extraction-key
```

Was dabei passiert:

- **Nur dieser Dienst.** Ist `EXTRACTION_BASE_URL` gesetzt, gehen Belege ausschließlich an diese Adresse, auch wenn zusätzlich `ANTHROPIC_API_KEY` gesetzt ist. Ist der Dienst nicht erreichbar, zu langsam oder antwortet er falsch, steht der Fehler am Beleg; Haben weicht nie auf Anthropic oder einen anderen Anbieter aus. Leitet der Dienst auf eine andere Adresse um (HTTP 3xx), folgt Haben dem nicht und meldet es am Beleg.
- **Fotos** (JPEG, PNG, WebP) gehen als Bild an den Dienst. **PDFs** wandelt Haben vorher lokal mit `pdftoppm` (poppler-utils, im Image enthalten) in Seitenbilder um, höchstens `EXTRACTION_MAX_PAGES` Seiten (Standard 4, längere Seite 1600 Pixel); hat das PDF mehr Seiten, steht ein Hinweis am Beleg. HEIC-Fotos und XML-Dateien gehen nicht an den Dienst. Hat ein PDF eine Textschicht, liest Haben sie mit `pdftotext` aus und schickt den Text mit; mit `EXTRACTION_INPUT=text` nur den Text, ohne Bilder, für ein reines Textmodell (etwa `qwen3:8b` in Ollama). Ein Scan oder ein Foto geht dann gar nicht an den Dienst.
- **Daten.** Ein Beleg geht genau an die eingetragene Adresse. Bei einem selbst betriebenen Modell verlässt er deinen Server nicht; bei einem Dienst in der Cloud liest ihn dieser Anbieter und, bei Vermittlern wie OpenRouter, der Anbieter des gewählten Modells. Was sie speichern oder zum Training nutzen, regeln deren Bedingungen und Einstellungen, nicht Haben.
- **Antwortformat.** Haben verlangt strukturierte Ausgabe nach einem JSON-Schema (`response_format` mit `json_schema`); Ollama, LM Studio und vLLM können das, bei Cloud-Diensten hängt es vom Modell ab. Lehnt der Dienst das ab, fragt Haben denselben Dienst noch einmal ohne und prüft die Antwort selbst gegen dasselbe Schema. Ein JSON-Schema garantiert keine richtigen Werte: Haben prüft Beträge, Daten und Summen wie bei Claude.
- **Authentifizierung.** Ohne `EXTRACTION_API_KEY` schickt Haben keinen Schlüssel. Verlangt der Dienst einen (jeder Cloud-Dienst wie OpenRouter, vLLM mit `--api-key`, ein Proxy davor), setze ihn; bei den Quadlets als Secret `haben-extraction-key` (Zeile in `haben-app.container` einkommentieren). Er steht nirgends in der Oberfläche oder im Log.
- **Wartezeit.** Auf einer CPU braucht ein 7B-Vision-Modell für einen Beleg leicht ein bis mehrere Minuten; ein Cloud-Dienst antwortet meist in Sekunden. Haben wartet `EXTRACTION_TIMEOUT_SECONDS` (Standard 300) und meldet dann eine Zeitüberschreitung am Beleg.
- **Log.** Bei einem Fehler schreibt Haben nur Anbieter, Modell und die Art des Fehlers ins Log, etwa `KI-Auslesung fehlgeschlagen (openai-compatible, qwen2.5vl:7b): zeitueberschreitung`. Beleginhalte, Antworten des Modells und Schlüssel stehen nicht im Log. Welcher Anbieter gerade gilt, zeigt **Einstellungen › KI-Assistenten und API › Belegauslesung**.

### Den Dienst aus dem Container erreichen

Das betrifft nur selbst betriebene Dienste; ein Cloud-Dienst ist über seine öffentliche Adresse erreichbar. Im Container ist `localhost` der Container selbst, nicht der Server. Läuft Ollama direkt auf dem Server:

| Betrieb | Adresse | Was noch nötig ist |
| --- | --- | --- |
| Docker Compose unter Linux | `http://host.docker.internal:11434/v1` | in `compose.yml` beim Dienst `app` die Zeilen `extra_hosts: - host.docker.internal:host-gateway` einkommentieren; Ollama muss auf der Docker-Bridge lauschen: `OLLAMA_HOST=0.0.0.0:11434` (oder die Adresse der Bridge, meist `172.17.0.1`) |
| Docker Desktop (macOS, Windows) | `http://host.docker.internal:11434/v1` | nichts |
| Podman (Quadlets) | `http://host.containers.internal:11434/v1` | Ollama mit `OLLAMA_HOST=0.0.0.0:11434`; den Namen trägt Podman selbst im Container ein |
| Dienst auf einem anderen Rechner im Netz | `http://192.168.178.20:11434/v1` | Firewall für den Port öffnen, nur für den Server |

Lauscht Ollama auf `0.0.0.0`, ist es von allen Rechnern im Netz erreichbar und hat keine Anmeldung. Beschränke den Port mit der Firewall auf den Server, oder setze einen Reverse Proxy mit Schlüssel davor und trage den Schlüssel als `EXTRACTION_API_KEY` ein.

Prüfen, ob der Container den Dienst erreicht:

```sh
docker compose exec app bun -e 'fetch(process.env.EXTRACTION_BASE_URL + "/models").then(r => r.text()).then(console.log, console.error)'
# Quadlets: podman exec haben-app bun -e '…'
```

### Beispiel: Ollama als eigener Container

Wer Ollama nicht schon betreibt, kann es neben Haben starten, etwa in einer `compose.override.yml`. Haben braucht diesen Container nicht.

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    restart: unless-stopped
    volumes:
      - ollama:/root/.ollama
    # Mit NVIDIA-GPU deutlich schneller; ohne GPU diese Zeilen weglassen
    # deploy:
    #   resources:
    #     reservations:
    #       devices: [{ driver: nvidia, count: all, capabilities: [gpu] }]
  app:
    environment:
      EXTRACTION_BASE_URL: http://ollama:11434/v1
      EXTRACTION_MODEL: qwen2.5vl:7b

volumes:
  ollama:
```

Das Modell lädst du einmal: `docker compose exec ollama ollama pull qwen2.5vl:7b` (rund 6 GB). Im selben Compose-Projekt erreicht Haben den Dienst unter seinem Namen `ollama`, ohne dass der Port nach außen offen ist.

**Grenzen.** Wie gut ein Beleg gelesen wird, hängt vom Modell ab. Ein lokales 7B-Modell liest saubere PDFs und gut ausgeleuchtete Fotos meist richtig, verliest sich aber eher als Claude bei Kassenzetteln, schrägen Fotos und kleinen Beträgen. Deshalb bleibt jeder Beleg „Zu prüfen“, bis du ihn bestätigst. Mehrseitige PDFs kosten je Seite Rechenzeit; bei Rechnungen stehen die Summen meist auf den ersten Seiten.

## Kontoabruf (Enable Banking)

Optional. Haben holt die Umsätze einmal täglich selbst über [Enable Banking](https://enablebanking.com), einen PSD2-Dienst mit Zugang zu fast allen deutschen Banken (DKB, Sparkassen, Volksbanken, N26 und viele mehr). Ohne Einrichtung bleibt der Import per CSV oder CAMT; beides geht auch nebeneinander.

1. Bei Enable Banking ein Konto anlegen und im Kontrollzentrum unter **API applications** eine Anwendung registrieren.
2. Als **Redirect URL** die Adresse `https://<deine Domain>/api/bank/callback` eintragen. Haben zeigt sie beim Verbinden auch an.
3. Den Schlüssel im Browser erzeugen lassen. Enable Banking lädt dann `<Application ID>.pem` herunter; die Application ID steht auch in der Übersicht.
4. Für eigene Konten genügt in der Regel der kostenlose eingeschränkte Produktionszugang: Die Anwendung wird aktiviert, indem du im Kontrollzentrum deine eigenen Konten verknüpfst, und darf danach nur diese abrufen. Die aktuellen Bedingungen stehen bei Enable Banking. Zum Ausprobieren gibt es eine Sandbox mit Testbanken.
5. Für die Produktionsumgebung verlangt Enable Banking außerdem eine **Privacy Policy URL** und eine **Terms of Service URL**. Haben bringt keine eigenen Seiten dafür mit: Die Instanz betreibst du selbst, also gehören dorthin deine Angaben, nicht die des Projekts. Trage die Datenschutzerklärung und das Impressum bzw. die AGB deiner eigenen Website ein, z. B. `https://<deine Domain>/datenschutz` und `https://<deine Domain>/impressum`. Die Adressen sollten erreichbar sein; im eingeschränkten Zugang bist du selbst der einzige Nutzer, der sie beim Zustimmen sieht.

Schlüssel und ID an Haben übergeben, am einfachsten in der Oberfläche: Unter **Einstellungen › Bank** die heruntergeladene `.pem`-Datei wählen; die Application ID übernimmt Haben aus dem Dateinamen. **Prüfen und speichern** fragt bei Enable Banking die Bankliste ab und speichert Schlüssel und ID nur, wenn das klappt. Der Schlüssel liegt danach verschlüsselt in der Datenbank wie das SMTP-Passwort; im Audit-Log steht nur die Application ID.

Alternativ über die Umgebung, etwa wenn du die Einrichtung automatisierst. Was in den Einstellungen gespeichert ist, geht vor:

```sh
# Compose: Datei neben compose.yml legen, Volume-Zeile in compose.yml einkommentieren, ID in .env
cp ~/Downloads/<Application ID>.pem ./enablebanking.pem && chown 1000:1000 enablebanking.pem && chmod 400 enablebanking.pem
echo 'ENABLE_BANKING_APP_ID=<Application ID>' >> .env
docker compose up -d

# Quadlets: Schlüssel als Secret, Zeile "Secret=haben-enablebanking-key,…" in haben-app.container einkommentieren
podman secret create haben-enablebanking-key ~/Downloads/<Application ID>.pem
# in haben.env: ENABLE_BANKING_APP_ID=<Application ID>
systemctl --user daemon-reload && systemctl --user restart haben-app
```

Danach erscheint unter **Bank** der Knopf **Bank verbinden**. Ablauf, Zustimmung und Dubletten stehen in [Bankimport und Abgleich](bank.md#automatischer-abruf).

Was an Enable Banking geht: beim Verbinden die gewählte Bank und die Rückleitungsadresse, danach nur Abrufe von Umsätzen und Kontoständen der freigegebenen Konten. Die Anmeldung bei der Bank geschieht auf deren Seite; Haben sieht weder Zugangsdaten noch TAN. Zahlungen auslösen kann Haben nicht.

## Lexware-Office-API

Für den Umzug ruft Haben die Public API von Lexware Office ab, standardmäßig unter `https://api.lexware.io/v1`. `LEXOFFICE_API_URL` brauchst du nur zum Testen oder falls Lexware die Adresse ändert; laut Code funktioniert auch `https://api.lexoffice.io/v1`. Den API-Schlüssel trägst du in der Oberfläche ein, nicht in der Umgebung. Ablauf und Voraussetzungen stehen in [Umzug aus Lexoffice](lexoffice.md).
