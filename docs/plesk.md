---
title: "Haben auf einem Server mit Plesk installieren"
description: >-
  Haben mit Docker Compose auf einem Linux-Server mit Plesk: Subdomain und Let's Encrypt in Plesk, nginx von Plesk als
  Reverse Proxy, Backup und Updates.
---

# Plesk

Auf einem Server mit [Plesk](https://www.plesk.com/) läuft Haben mit den Dateien aus
[Docker Compose](installation.md#docker-compose). Den mitgelieferten Caddy brauchst du nicht: HTTPS und das Zertifikat
übernimmt Plesk, sein nginx leitet die Subdomain an die App weiter, die nur auf `127.0.0.1` erreichbar ist. Die
Einstellungen machst du in der Plesk-Oberfläche, Haben selbst richtest du als `root` auf der Kommandozeile ein.

## Voraussetzungen

- Plesk auf Linux mit der Erweiterung **Docker** (**Erweiterungen**) und dem Dienst **Reverse Proxy Server (nginx)**
  (**Tools & Einstellungen › Dienste-Verwaltung**).
- Docker Compose 2.23 oder neuer, `docker compose version` zeigt es.
- Zugang als `root`, per SSH oder unter **Tools & Einstellungen › SSH-Terminal**.
- Für die Übermittlung an ELSTER ein Server mit Intel- oder AMD-Prozessor, siehe
  [ELSTER auf arm64](installation-anbindungen.md#elster-auf-arm64).

## Subdomain und Zertifikat

1. **Websites & Domains › Subdomain hinzufügen**, etwa `haben.example.de`. Unter einem Unterpfad wie
   `example.de/haben` läuft Haben nicht. Leg dich vorher fest: Passkeys hängen an dieser Adresse, siehe
   [Passkeys und Domain](installation.md#passkeys-und-domain).
2. Bei der Subdomain unter **SSL/TLS-Zertifikate** ein Zertifikat von Let's Encrypt ausstellen und unter
   **Hosting-Einstellungen** die dauerhafte 301-Weiterleitung von HTTP zu HTTPS einschalten.

## Haben einrichten

Als `root`, wie unter [Docker Compose](installation.md#docker-compose), nur mit der Variante für einen Proxy direkt auf
dem Host:

```sh
mkdir -p /opt/haben && cd /opt/haben
curl -O https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/firsttris/haben/main/deploy/compose.env.example
chmod 600 .env
```

`.env` füllst du aus wie unter [Docker Compose](installation.md#docker-compose) beschrieben, mit der Subdomain als
`DOMAIN`. Daneben legst du `compose.override.yml` mit diesem Inhalt an (die Variante am Ende von
[`deploy/compose.override.example.yml`](https://github.com/firsttris/haben/blob/main/deploy/compose.override.example.yml)):

```yaml
services:
  caddy:
    profiles: [eigener-proxy]
  app:
    ports:
      - "127.0.0.1:3000:3000"
```

Caddy startet damit nicht, Port 80 und 443 bleiben bei Plesk. Ist Port 3000 schon belegt, nimm eine andere linke Zahl,
etwa `127.0.0.1:3001:3000`, und denselben Port in der Proxy-Regel unten. Dann die App-Rolle anlegen und starten wie dort
beschrieben:

```sh
docker compose up -d --wait db
docker compose exec db createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app
docker compose up -d
docker compose logs -f app   # bis „Listening on …“, darüber steht der Einrichtungscode
```

`ENCRYPTION_KEY` und `RESTIC_PASSWORD` aus `.env` gehören jetzt in deinen Passwortmanager; ohne sie lassen sich
ELSTER-Zertifikat, Zugangsdaten und Backup nach einem Verlust des Servers nicht mehr öffnen.

## nginx in Plesk

Bei der Subdomain unter **Einstellungen für Apache & nginx**:

1. Im Abschnitt **Einstellungen für nginx** den **Proxymodus** ausschalten. nginx gibt die Anfragen dann selbst an die
   App weiter, ohne Umweg über Apache.
2. **Maximale Größe einer Client-Anforderung** auf `250m` setzen, für Archivdateien bis 100 MB und mehrere Belege auf
   einmal. Plesk schreibt daraus `client_max_body_size`; die Zeile gehört deshalb nicht unten dazu.
3. In **Zusätzliche nginx-Anweisungen** eintragen:

   ```nginx
   proxy_read_timeout 300s;
   add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
   add_header X-Content-Type-Options nosniff always;
   add_header Referrer-Policy same-origin always;
   add_header X-Frame-Options SAMEORIGIN always;
   ```

   Eine Übermittlung an ELSTER wartet in der Anfrage auf ERiC; mit dem Standard von 60 Sekunden bräche sie ab. Was die
   Header bewirken, steht unter [Eigener Reverse Proxy](installation.md#eigener-reverse-proxy). `proxy_set_header`
   brauchst du hier nicht: Die Proxy-Regel aus dem nächsten Schritt setzt `Host` und `X-Forwarded-For` selbst, und
   Zeilen auf dieser Ebene würden nginx in ihrem Block ohnehin nicht übernehmen.
4. **Übernehmen**.

## Proxy-Regel

**Websites & Domains › haben.example.de › Docker-Proxy-Regeln › Regel hinzufügen:** den Container `haben-app-1`
wählen und Port `3000` (bzw. die linke Zahl aus `compose.override.yml`).

Mit `curl -sI https://haben.example.de/login` prüfst du, ob die Header aus dem vorigen Abschnitt ankommen. Dann rufst du
die Adresse im Browser auf, gibst den Einrichtungscode ein und legst dein Konto an; weiter geht es in
[Erste Schritte](einrichtung.md). ERiC lädst du unter **Einstellungen › ELSTER › ERiC** herunter, siehe
[ERiC einbinden](installation-anbindungen.md#eric-einbinden).

> [!WARNING]
> Die Container verwaltet Compose, nicht Plesk. Ändere ihre Einstellungen nicht in der Docker-Oberfläche von Plesk und
> bestätige dort nichts mit **OK** oder **Übernehmen**: Plesk legt den Container sonst nach seinen eigenen Werten neu
> an. Volumes, die Plesk dort als „Nicht bereitgestellt“ zeigt, sind trotzdem eingebunden.

## Backup

Der Dienst `backup` sichert Datenbank und Belege jeden Tag um 03:15 Uhr mit restic, ohne weitere Angaben in das Volume
`backups` auf demselben Server. Die Volumes liegen unter `/var/lib/docker` und damit außerhalb der Abonnements; das
Backup von Plesk erfasst sie nicht. Trag deshalb in `.env` bei `RESTIC_REPOSITORY` ein zweites System ein, etwa einen
S3-Speicher oder einen restic REST-Server, siehe
[Repository auf einem zweiten System](installation-backup.md#repository-auf-einem-zweiten-system). Die Uhrzeit änderst
du mit `BACKUP_TIME` in `.env` und `docker compose up -d backup`.

Ein Backup von Hand, Test-Restore und Wiederherstellen gehen in `/opt/haben` wie unter
[Backup und Wiederherstellen](installation-backup.md#backup-und-wiederherstellen).

## Updates

In `/opt/haben`:

```sh
docker compose exec backup backup.sh && docker compose pull && docker compose up -d
```

Migrationen laufen beim Start der App, siehe [Updates](installation-backup.md#updates).

## Mehrere Instanzen

Für jede Firma eine eigene Instanz, siehe [Mehrere Instanzen](installation.md#mehrere-instanzen): je Instanz ein
Verzeichnis wie `/opt/haben-firma2` mit eigenem `COMPOSE_PROJECT_NAME` und eigenen Schlüsseln in `.env`, in
`compose.override.yml` ein eigener Port (`127.0.0.1:3001:3000`), dazu in Plesk eine eigene Subdomain mit den
Einstellungen von oben und eine Proxy-Regel auf den Container `haben-firma2-app-1` und diesen Port. Das Werkzeug
`haben-instanzen.ts` passt hier nicht: Es verbindet die Instanzen über ein Container-Netz, der nginx von Plesk läuft
aber auf dem Host.
