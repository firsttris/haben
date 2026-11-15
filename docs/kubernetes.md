---
title: "Haben mit Helm in Kubernetes installieren"
description: >-
  Haben mit dem Helm-Chart in Kubernetes: App mit Backup im selben Pod, eigene oder vorhandene PostgreSQL, Ingress oder
  Gateway API, Restore und Updates.
---

# Kubernetes

Das Helm-Chart [`deploy/helm`](https://github.com/firsttris/haben/tree/main/deploy/helm) startet dieselben Images wie
[Docker Compose](installation.md#docker-compose): die App, daneben im selben Pod das tägliche Backup, und auf Wunsch
PostgreSQL als StatefulSet. Haben läuft immer mit genau einem Pod; ein Update beendet ihn, bevor der neue startet, weil
die Migrationen beim Start nur vorwärts gehen. Jede Einstellung ist in
[`values.yaml`](https://github.com/firsttris/haben/blob/main/deploy/helm/values.yaml) erklärt.

## Installieren

1. Das Chart holen: `git clone --depth 1 https://github.com/firsttris/haben.git`
2. Eine Datei `werte.yaml` anlegen und mit `chmod 600 werte.yaml` nur für dich lesbar machen:

    ```yaml
    domain: haben.example.de        # Passkeys hängen daran, später nicht mehr ändern
    image:
      tag: "0.9.0"                  # aktuelle Version unter github.com/firsttris/haben/releases
    app:
      secretEnv:
        BETTER_AUTH_SECRET: …       # openssl rand -base64 32
        HABEN_ENCRYPTION_KEY: …     # openssl rand -base64 32, zusätzlich im Passwortmanager
    postgresql:
      password: …                   # openssl rand -hex 24
      appPassword: …                # openssl rand -hex 24
    backup:
      secretEnv:
        RESTIC_PASSWORD: …          # openssl rand -base64 32, zusätzlich im Passwortmanager
    ingress:
      enabled: true
      className: traefik
      tlsSecret: haben-tls
    ```

3. Installieren und auf den Einrichtungscode warten:

    ```sh
    helm install haben ./haben/deploy/helm -n haben --create-namespace -f werte.yaml
    kubectl -n haben logs -f deploy/haben -c app   # „Migrationen angewendet“, „Einrichtungscode …“, „Listening on …“
    ```

Mit dem Code legst du dein Konto an, siehe [Erste Schritte](einrichtung.md). Weitere Variablen aus
[Umgebungsvariablen](installation-konfiguration.md#umgebungsvariablen) trägst du unter `app.env` ein, geheime wie
`ANTHROPIC_API_KEY` oder `OIDC_CLIENT_SECRET` unter `app.secretEnv`. Jeden Wert schreibst du in Anführungszeichen, sonst
liest YAML etwa `off` als `false`; das Chart bricht dann mit einer Meldung ab.

Die mitgelieferte Datenbank legt beim ersten Start die App-Rolle `haben_app` an
([Getrennte Datenbankrollen](installation-konfiguration.md#getrennte-datenbankrollen)). Ein späteres neues Passwort in
`werte.yaml` ändert die Rolle nicht; das geht nur in der Datenbank selbst. Belege, Datenbank und Backup-Volume bleiben
bei `helm uninstall` erhalten; eine neue Installation mit demselben Namen nimmt sie wieder, mit den bisherigen Passwörtern.

### Secrets aus einer anderen Quelle

Statt der Werte in `werte.yaml` nimmt das Chart vorhandene Secrets, etwa aus Sealed Secrets oder External Secrets. Die
Schlüssel heißen wie die Variablen:

| Wert | Schlüssel im Secret |
| --- | --- |
| `app.existingSecret` | `BETTER_AUTH_SECRET`, `HABEN_ENCRYPTION_KEY`, `DATABASE_URL`, `MIGRATION_DATABASE_URL` und weitere geheime Variablen |
| `postgresql.existingSecret` | `POSTGRES_PASSWORD` (Eigentümer `haben`), `APP_PASSWORD` (`haben_app`); dann auch `app.existingSecret` |
| `backup.existingSecret` | `RESTIC_PASSWORD`, für S3 `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY`, mit eigener Datenbank `PGPASSWORD` |

## Eigene Datenbank

Mit `postgresql.enabled: false` startet keine Datenbank. Die Zugänge stehen dann in `app.secretEnv`: `DATABASE_URL` für
die App-Rolle und, für [getrennte Rollen](installation-konfiguration.md#getrennte-datenbankrollen), `MIGRATION_DATABASE_URL`
für den Eigentümer, bei CloudNativePG etwa über den `-rw`-Service. Ein Pooler davor muss im Sitzungsmodus laufen, siehe
[Image](installation.md#image). Das Backup braucht den Eigentümerzugang auch: `PGHOST`, `PGUSER` und `PGDATABASE` unter `backup.env`, `PGPASSWORD`
unter `backup.secretEnv`. Schaltest du es ab, weil der Operator die Datenbank sichert, fehlen im Backup die Belege.

## Ingress und Gateway API

Ingress oder Gateway müssen leisten, was unter [Eigener Reverse Proxy](installation.md#eigener-reverse-proxy) steht.

**Gateway API:** Mit `httpRoute.enabled: true` und dem Gateway unter `httpRoute.parentRefs` setzt der HTTPRoute die
Header und die Wartezeit selbst.

**Traefik** (Standard in k3s) braucht für die Header eine Middleware im Namespace von Haben:

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: haben-header
  namespace: haben
spec:
  headers:
    stsSeconds: 31536000
    stsIncludeSubdomains: true
    contentTypeNosniff: true
    referrerPolicy: same-origin
    customFrameOptionsValue: SAMEORIGIN   # nicht DENY, sonst bleiben die eingebetteten Vorschauen leer
```

In `werte.yaml` unter `ingress.annotations` dann
`traefik.ingress.kubernetes.io/router.middlewares: haben-haben-header@kubernetescrd`. Traefik bricht außerdem eine
Anfrage nach 60 Sekunden Lesezeit ab, ein großer Upload über eine langsame Leitung endet dann mit Fehler 502. In k3s
hebt das eine `HelmChartConfig` an, für Ingress wie für Gateway API:

```yaml
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    ports:
      websecure:
        transport:
          respondingTimeouts:
            readTimeout: 600s
```

### NetworkPolicy

Ohne NetworkPolicy erreicht jeder Pod im Cluster Port 3000 der App und kann `X-Forwarded-For` fälschen.
`networkPolicy.enabled: true` lässt wie das eigene Netz in Compose nur die Pods aus `networkPolicy.ingressFrom` an die
App und nur App und Wiederherstellen an die mitgelieferte Datenbank; ausgehend bleibt alles offen. Eine eigene
Datenbank braucht eine eigene Richtlinie. Das Netzwerk-Plugin des Clusters muss NetworkPolicy umsetzen, in k3s ist das
eingebaut. Für Traefik in k3s:

```yaml
networkPolicy:
  enabled: true
  ingressFrom:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          app.kubernetes.io/name: traefik
```

Andere Dienste im Cluster, etwa Paperless, rufen Haben dann über die Domain auf.

## ELSTER

ERiC gibt es nur für Linux x86_64. In einem Cluster mit beiden Architekturen setzt `nodeSelector` mit
`kubernetes.io/arch: amd64` die App auf einen passenden Knoten. Den Download übernimmt `ERIC_AUTO_INSTALL: "ja"` unter
`app.env` oder der Knopf unter **Einstellungen › ELSTER › ERiC**; er bleibt im Volume `haben-eric`. Nur mit arm64 geht es
emuliert wie unter [ELSTER auf arm64](installation-anbindungen.md#elster-auf-arm64): das Verzeichnis `/opt/haben-x86_64`
des Knotens als `hostPath` unter `extraVolumes`, eingehängt mit `app.extraVolumeMounts`, dazu `ERIC_WORKER_COMMAND`.

## Backup

Der Container `backup` sichert Datenbank und Belege täglich um 03:15 Uhr, wie unter
[Backup und Wiederherstellen](installation-backup.md#backup-und-wiederherstellen) beschrieben. Ohne
`RESTIC_REPOSITORY` unter `backup.env` liegt das Repository im Volume `haben-backups` im selben Cluster; gegen dessen
Verlust gehört es auf ein [zweites System](installation-backup.md#repository-auf-einem-zweiten-system), mit dem Chart
über S3 oder einen REST-Server.

Ein Backup von Hand, etwa vor einem Update:

```sh
kubectl -n haben exec deploy/haben -c backup -- backup.sh
```

## Wiederherstellen

`restore.enabled: true` stoppt die App und startet einen Pod, in dem `restore.sh` die Belege schreiben darf:

```sh
helm upgrade haben ./haben/deploy/helm -n haben -f werte.yaml --set restore.enabled=true
kubectl -n haben exec -it deploy/haben-restore -- restore.sh          # verfügbare Stände anzeigen
kubectl -n haben exec -it deploy/haben-restore -- restore.sh latest   # oder eine Snapshot-ID
helm upgrade haben ./haben/deploy/helm -n haben -f werte.yaml
```

Was dabei passiert, steht unter [Wiederherstellen](installation-backup.md#wiederherstellen). Auf einem neuen Cluster
installierst du gleich mit `--set restore.enabled=true` und demselben `HABEN_ENCRYPTION_KEY`, `RESTIC_PASSWORD` und
`RESTIC_REPOSITORY`; so läuft kein Backup des leeren Stands, bevor du wiederhergestellt hast.

## Updates

Vor einem Update ein Backup von Hand wie oben, dann `image.tag` in `werte.yaml` anheben, `git pull` im Klon und
`helm upgrade haben ./haben/deploy/helm -n haben -f werte.yaml`. Migrationen laufen beim Start der App, siehe
[Updates](installation-backup.md#updates).

Zum [Zurücknehmen](installation-backup.md#update-zurücknehmen) setzt du `image.tag` auf die vorige Version und
`postgresql.tag` auf die neue, für Datenbank und Backup: Die Datenbank kann eine Anhebung auf eine neue
PostgreSQL-Version nicht rückgängig machen, und das Backup braucht deren `pg_dump`.
