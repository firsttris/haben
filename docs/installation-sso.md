---
title: "Single Sign-on mit OpenID Connect"
description: >-
  Haben im SSO-Modus betreiben: Anmeldung über OpenID Connect (etwa Authelia), Rollen aus Gruppen, Umstellen und zurück.
---

# Single Sign-on mit OpenID Connect

Haben kennt zwei strikt getrennte Betriebsarten:

| | Standardmodus (`OIDC_ONLY=false`, Vorgabe) | SSO-Modus (`OIDC_ONLY=true`) |
| --- | --- | --- |
| Anmeldung | Passwort und Passkeys | ausschließlich OIDC, etwa Authelia |
| Inhaber | genau einer, mit Einrichtungscode angelegt | jedes Mitglied der Inhaber-Gruppe, auch mehrere |
| Weitere Zugänge | per Einladung, Sperren und Entfernen in Haben | automatisch bei der ersten Anmeldung, Rolle aus der Gruppe |
| Verwaltung | **Einstellungen › Sicherheit** | Gruppen im Anmeldedienst; **Einstellungen › Zugänge** zeigt nur an |

Einen gemischten Modus gibt es nicht. Vorhandene `OIDC_*`-Werte allein schalten SSO nicht ein; im Standardmodus sind sämtliche OIDC-Wege gesperrt, im SSO-Modus sämtliche lokalen Anmelde- und Kontowege, auch bei direkten API-Aufrufen.

## Haben konfigurieren

```dotenv
# false: ausschließlich lokale Anmeldung
# true: ausschließlich SSO
OIDC_ONLY=true

OIDC_ISSUER=https://auth.example.de
OIDC_CLIENT_ID=haben
OIDC_CLIENT_SECRET=<urspruengliches-clientsecret>
OIDC_DISPLAY_NAME=Authelia

OIDC_GROUPS_CLAIM=groups
OIDC_GROUP_INHABER=haben-inhaber
OIDC_GROUP_STEUERBERATUNG=haben-steuerberatung
```

Mit `OIDC_ONLY=true` sind Issuer, Client-ID, Clientsecret und beide Gruppen Pflicht; fehlt etwas, startet Haben nicht. Die Gruppen müssen verschieden sein und werden exakt verglichen (Groß-/Kleinschreibung zählt, keine Leerzeichen am Rand). `OIDC_GROUPS_CLAIM` nennt genau einen Claim auf oberster Ebene, keinen Pfad oder Ausdruck; ein URL-förmiger Name wie `https://haben.example.de/groups` ist erlaubt.

In Docker Compose stehen die Werte in der `.env` neben `compose.yml` (nur für dich lesbar, `chmod 600 .env`), bei Quadlets in `haben.env` und das Clientsecret als Podman-Secret `haben-oidc-client-secret` (die vorbereitete `Secret=`-Zeile in `haben-app.container` einkommentieren). In **Coolify** die Werte als Laufzeit-Umgebungsvariablen der Anwendung setzen, das Clientsecret als „Secret“ markieren und neu deployen. `BETTER_AUTH_URL` muss der öffentlichen Adresse im Browser entsprechen, einschließlich eines Ports.

Haben lädt `${OIDC_ISSUER}/.well-known/openid-configuration`; der dort genannte Issuer muss exakt dem konfigurierten Wert entsprechen, UserInfo wird verwendet, wenn der Anbieter einen entsprechenden Endpunkt nennt. Anbieter und Haben laufen über HTTPS; HTTP ist nur auf Loopback außerhalb des Betriebs erlaubt. Hat der Anbieter ein Zertifikat einer eigenen CA, deren Datei über `NODE_EXTRA_CA_CERTS` in den Haben-Container geben. Die feste Callback-Adresse lautet:

```text
https://haben.example.de/api/auth/callback/oidc
```

## Scopes und andere Anbieter

`OIDC_SCOPES` legt durch Leerzeichen getrennte Scopes genau fest und muss `openid` enthalten. Ohne Angabe fragt Haben `openid profile email` an und ergänzt `groups` nur, wenn Discovery diesen Scope ausdrücklich unterstützt. Gruppen werden bevorzugt aus UserInfo gelesen, sonst aus dem geprüften ID-Token. Ein vorhandener ungültiger oder verweigernder Gruppenclaim erlaubt keinen Rückgriff. Die E-Mail muss die Form `name@domain` haben, auch Intranet-Domains und Umlaute sind zulässig; `email_verified=false` ebenfalls. Konten werden niemals über gleiche E-Mail-Adressen verbunden.

Alle Anbieter verwenden einen vertraulichen Client, Code-Flow, PKCE S256, `client_secret_basic` und die exakte Haben-Callback-Adresse.

| Anbieter | Einstellungen |
| --- | --- |
| Pocket ID | Beide Benutzergruppen zuordnen, Scopes `openid profile email groups`, Claim `groups`. [Clientbeispiele](https://pocket-id.org/docs/client-examples) |
| Authentik | Asymmetrischen **Signing Key** auswählen, etwa RS256. Ohne Key verwendet Authentik HS256; das unterstützt Haben nicht. Scope-Mapping muss `groups` als Array liefern. Issuer exakt aus Discovery übernehmen, typischerweise `https://auth.example.de/application/o/haben/` einschließlich Schrägstrich. [Providerdoku](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/) |
| Keycloak | Issuer `https://auth.example.de/realms/<realm>`, Client-Authentifizierung, Standard Flow und PKCE S256. `OIDC_SCOPES=openid profile email` und Group-Membership-Mapper mit Claim `groups` in UserInfo oder ID-Token. Bei **Full group path** Werte wie `/haben-inhaber` konfigurieren. [Client Scopes und Mapper](https://www.keycloak.org/docs/latest/server_admin/#_client_scopes) |

Nicht unterstützt sind reines OAuth 2.0 ohne OIDC-Discovery und SAML, Clients ohne Secret oder mit anderer Authentifizierung als `client_secret_basic`, signierte UserInfo-Antworten (`application/jwt`) und Gruppen in anderer Form als einem Array aus Zeichenketten auf oberster Ebene. Verschachtelte Claims wie `realm_access.roles` und die Rollen-Claims von Zitadel brauchen daher einen Mapper oder eine Action, die einen flachen Claim liefert. Bei Entra ID fehlt `groups` ab 200 Gruppen im Token (Overage); Haben ruft Microsoft Graph nicht ab und weist solche Konten ab. Für Entra ID außerdem den optionalen Claim `email` einrichten.

Scheitert eine Anmeldung, steht die Ursache mit dem Präfix `SSO:` oder `Better Auth:` im Server-Log, etwa `SSO: Token-Endpunkt antwortete 401, invalid_client`, ohne Codes, Tokens oder Claims.

Authelia ist die reale Referenzintegration. Pocket ID, Authentik und Entra-/Keycloak-Claimvarianten werden mit einem kontrollierten Testanbieter nachgestellt; das ersetzt keinen vollständigen Durchlauf gegen diese Server. Versionen und tatsächlich ausgeführte Referenzprüfungen stehen im jeweiligen Prüfbericht.

## Authelia konfigurieren

Authelia muss bereits als OIDC-Anbieter eingerichtet sein (Signaturschlüssel, HMAC-Secret und die übrige Pflichtkonfiguration). Für Haben die beiden Gruppen anlegen, Benutzer jeweils **genau einer** davon zuordnen und diesen vertraulichen Client ergänzen:

```yaml
authentication_backend:
  # Gruppen bei jeder Anfrage neu lesen, damit erneute OIDC-Durchläufe aktuelle Gruppen liefern
  refresh_interval: always

identity_providers:
  oidc:
    # Übrige Pflichtkonfiguration des OIDC-Anbieters bleibt erforderlich.
    clients:
      - client_id: haben
        client_name: Haben
        client_secret: '<HASH-DES-CLIENTSECRETS>'
        public: false
        authorization_policy: two_factor
        require_pkce: true
        pkce_challenge_method: S256
        redirect_uris:
          - https://haben.example.de/api/auth/callback/oidc
        scopes:
          - openid
          - profile
          - email
          - groups
        response_types:
          - code
        grant_types:
          - authorization_code
        token_endpoint_auth_method: client_secret_basic
```

Mit der Dateibackend-Variante (`authentication_backend.file`) stehen die Gruppen in der Benutzerdatei:

```yaml
users:
  inhaberin:
    displayname: Inhaberin
    email: inhaberin@example.de
    password: '<HASH>'
    groups:
      - haben-inhaber
  kanzlei:
    displayname: Kanzlei Muster
    email: kanzlei@example.de
    password: '<HASH>'
    groups:
      - haben-steuerberatung
```

In Haben steht das **ursprüngliche Clientsecret**, in Authelia dessen **Hash** (`authelia crypto hash generate pbkdf2`, das Secret interaktiv eingeben). Authelia liefert Gruppen und E-Mail über den UserInfo-Endpunkt, nicht im ID-Token ([Authelia: Claims](https://www.authelia.com/integration/openid-connect/openid-connect-1.0-claims/)); Haben fragt ihn nach jedem geprüften ID-Token ab und verlangt dort dasselbe Subject. Eine E-Mail-Adresse der Form `name@domain` ist erforderlich; der Bestätigungsclaim vergibt keine Rechte. Änderungen an LDAP oder Benutzerdatei müssen Authelia erreichen (bei der Datei `watch: true` oder Neustart). Siehe auch [Authelia: OIDC-Clients](https://www.authelia.com/configuration/identity-providers/openid-connect/clients/).

## Einrichten und anmelden

Bei einer **neuen Instanz** zeigt `/setup` nur **Mit Authelia einrichten**, ohne Einrichtungscode, Passwort oder Passkey. Die erste erfolgreiche Anmeldung eines Mitglieds der Inhaber-Gruppe richtet Haben für diesen Issuer ein. Mitglieder der Steuerberatungs-Gruppe können eine Instanz nicht erstmals einrichten.

Danach entsteht jedes Konto mit genau einer passenden Gruppe automatisch bei der ersten Anmeldung, ohne Einladung. Mehrere Inhaber sind möglich. Abgewiesen wird, wer keiner oder beiden Haben-Gruppen angehört oder einen fehlenden oder ungültigen Gruppen-Claim hat (erwartet ist ein Array aus Zeichenketten); andere Gruppen spielen keine Rolle.

Bei **jeder** Anmeldung bestimmt Haben die Rolle neu. Ändert sie sich (Beförderung oder Herabstufung), enden alle bisherigen Sitzungen dieses Kontos. Wird eine bekannte Identität wegen ihrer Gruppen abgewiesen, enden ihre SSO-Sitzungen ebenfalls. Lokale Sperren gibt es im SSO-Modus nicht; den Zugang regelt die Gruppenzuordnung.

## Höchstens 15 Minuten alte Berechtigungen

Eine Haben-Sitzung trägt die beim Callback bestätigte Rolle mit fester Frist von 15 Minuten ab der Prüfung. Die Laufzeit der Tokens des Anbieters spielt keine Rolle, Haben verwirft sie nach dem Callback. Aktivität oder die Verlängerung der Sitzung durch Better Auth verlängern diese Frist nicht. Danach verweigert Haben geschützte Zugriffe und führt zur Anmeldeseite; ein Klick auf **Mit Authelia anmelden** prüft die Gruppen erneut, bei bestehender Authelia-Sitzung ohne neue Passworteingabe. Schreibende Anfragen werden nicht automatisch wiederholt.

Das heißt auch:

- Eine Änderung der Gruppen wirkt spätestens nach 15 Minuten, bei der nächsten Anmeldung sofort.
- Abmelden oder Sperren in Authelia beendet eine laufende Haben-Sitzung **nicht sofort**; es gibt keine zentrale Abmeldung. Die Berechtigung läuft spätestens nach 15 Minuten aus.
- Fällt der Anbieter aus, sind keine neuen und keine erneuten Anmeldungen möglich; es gibt keinen lokalen Rückfall. Ist er beim Start von Haben noch nicht erreichbar, holt Haben die Discovery bei der nächsten Anmeldung nach; ein Neustart ist nicht nötig.
- Haben speichert keine Access-, Refresh- oder ID-Tokens und fragt Authelia nicht im Hintergrund ab.
- API-, MCP- und Kalender-Tokens werden bei erkanntem Entzug des Verantwortlichen deaktiviert; siehe unten.

## Zugänge

**Einstellungen › Zugänge** ersetzt im SSO-Modus den Bereich **Sicherheit**. Er zeigt die Konten, die sich schon angemeldet haben, mit der zuletzt bestätigten Rolle und der letzten Anmeldung, und verweist für die Verwaltung auf Authelia. Er ist kein Abbild des Authelia-Verzeichnisses: Wer noch nie angemeldet war, erscheint nicht. Einladen, Sperren, Freigeben und Entfernen gibt es nicht, auch nicht über die Server-Schnittstelle. Alte Einladungslinks zeigen „Einladungen nicht verfügbar“; die Einladungen bleiben für einen späteren Standardbetrieb gespeichert. Alte Links auf `?bereich=sicherheit` führen nach **Zugänge**.

## Bestehende Instanz umstellen

Gespeicherte lokale Zugangsdaten bleiben beim Wechsel erhalten, alle Sitzungen der bisherigen Betriebsart werden ungültig. Haben führt Konten **nicht** anhand gleicher E-Mail-Adressen zusammen: Meldet sich jemand mit der E-Mail eines bestehenden, nicht zugeordneten Kontos an, lehnt Haben ab und verweist auf die Übernahme durch den Betreiber. Unverknüpfte lokale Konten erhalten im SSO-Modus keinen Zugang, verhindern aber den Start nicht.

Damit das bestehende Konto (und damit seine Belege, sein Audit-Verlauf und seine Konto-ID) weiterverwendet wird, ordnet der Betreiber es **bei gestoppter Anwendung** ausdrücklich einer Identität zu. Das Subject (`sub`) anhand der Identitätsausgabe des Anbieters nachweisen, siehe unten. Die Konto-ID steht unter `id` in der Haben-Tabelle `"user"`.

```sh
docker compose stop app
# erst prüfen, nichts ändern
docker compose run --rm --entrypoint bun app apps/web/src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <sub>
# dann ausdrücklich übernehmen
docker compose run --rm --entrypoint bun app apps/web/src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <sub> --uebernehmen
docker compose start app
```

Die Übernahme ordnet nur dem konfigurierten Issuer zu, verweigert ein schon vergebenes Subject und läuft nicht, solange Haben läuft. Sie steht im Änderungsprotokoll (`sso_takeovers`) und vergibt **keine** Rolle: Die kommt bei der nächsten Anmeldung aus der Gruppe. Bestehende exakte Issuer-/Subject-Zuordnungen melden weiterhin dasselbe Konto an; eine erneute Übernahme ist nicht erforderlich.

Führt der Anbieter dasselbe Konto mit einem **neuen Subject**, etwa weil es dort neu angelegt wurde, endet die Anmeldung mit dem Hinweis auf ein vorhandenes Konto. Dann bei gestoppter Anwendung `--ersetzen` angeben:

```sh
docker compose stop app
# erst prüfen, nichts ändern; die Ausgabe nennt das bisherige und das neue Subject
docker compose run --rm --entrypoint bun app apps/web/src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <neues-sub> --ersetzen
# dann ausdrücklich ersetzen
docker compose run --rm --entrypoint bun app apps/web/src/server/db/sso-uebernahme.ts --konto <Konto-ID> --subject <neues-sub> --ersetzen --uebernehmen
docker compose start app
```

Die bisherige Identität dieses Issuers wird entfernt, ihre Sitzungen und die bestätigte Rolle enden, und `sso_takeovers` nennt das alte Subject. API-Tokens und Kalender-Abo gelten erst wieder nach der ersten Anmeldung mit dem neuen Subject. Vor dem Ersetzen belegen, dass das neue Subject dieselbe Person ist: Wer die Zuordnung bekommt, erhält das Konto mit allen Daten.

## Tokens nach Gruppenentzug

API/MCP-Tokens und das Kalender-Abo haben einen ursprünglichen Ersteller und einen aktuell verantwortlichen Inhaber. Verliert dieser bei einer geprüften Anmeldung die Inhaberrolle, deaktiviert Haben seine Tokens und erhält deren Hash, Rechte und Frist. **Ohne erneute Anmeldung erkennt Haben einen Gruppenentzug nicht. Deshalb gilt ein Token höchstens 30 Tage nach der letzten bestätigten Anmeldung seines Verantwortlichen;** danach zeigt die Verwaltung „unbestätigt“, bis er sich wieder anmeldet oder jemand den Zugang übernimmt. Dasselbe gilt nach einem Moduswechsel für Tokens eines Kontos, das in der neuen Betriebsart keine Identität hat. Die 15-Minuten-Frist betrifft interaktive Sitzungen.

Ein **anderer** aktuell berechtigter Inhaber kann deaktivierte oder unbestätigte Tokens in ihrer bisherigen Verwaltung ausdrücklich **übernehmen und reaktivieren**. Er wird verantwortlich; das bisherige Geheimnis beziehungsweise der Kalender-Link bleibt gültig. Ein späterer Entzug dieses neuen Verantwortlichen deaktiviert den Zugang erneut. Rückkehr in die Gruppe reaktiviert nichts automatisch. Gibt es keinen anderen aktuell bestätigten Inhaber, darf der Verantwortliche seine eigenen Tokens selbst reaktivieren, sonst blieben sie etwa nach einem vorübergehend fehlenden Gruppen-Claim unbrauchbar. Endgültig widerrufene oder abgelaufene Tokens bleiben unbrauchbar.

Beim Update werden bestehende Tokens dem bisherigen Inhaber zugeordnet und bleiben aktiv. Nur ohne Inhaber bleiben sie gespeichert, werden aber deaktiviert und benötigen eine ausdrückliche Übernahme. Die Verwaltung zeigt Verantwortlichen, Zustand und Grund; Verwaltungsereignisse stehen ohne Geheimnisse im Audit.

## Zurück zum Standardmodus

Auch rein per SSO eingerichtete Instanzen lassen sich ohne erreichbaren IdP auf lokale Anmeldung umstellen. Zuerst Backup erstellen und **alle Haben-Instanzen stoppen**. Dann ein vorhandenes Konto anhand seiner Konto-ID ausdrücklich als lokalen Inhaber vorbereiten:

```sh
docker compose stop app
# Nur prüfen, keine Änderungen:
docker compose run --rm --no-deps --entrypoint bun app apps/web/src/server/db/local-owner.ts --konto <Konto-ID>
# Ohne vorhandenen lokalen Zugang: Passwort über geschützten Eingabekanal übergeben.
docker compose run --rm --no-deps -T --entrypoint bun app apps/web/src/server/db/local-owner.ts --konto <Konto-ID> --uebernehmen --passwort-stdin < /geschuetzt/passwort
```

Die nur für dich lesbare Eingabedatei enthält ein Passwort mit mindestens 12 Zeichen. Kein Passwort in Kommandozeilenargumente, Shell-Historie oder Logs schreiben. Sind Passwort oder Passkey vorhanden, reicht `--uebernehmen` ohne Passworteingabe; ein übergebenes Passwort ersetzt ein vorhandenes. Konten der Steuerberatung werden nicht zum Inhaber. Ein anderer vorhandener lokaler Inhaber wird nicht ersetzt. Das Werkzeug erhält Konto-ID, SSO-Zuordnungen und Buchhaltungsdaten, protokolliert die Vorbereitung und entwertet Sitzungen. Danach `OIDC_ONLY=false` setzen und neu starten. Bis zum Moduswechsel bleibt lokale Anmeldung gesperrt; eine öffentliche Notanmeldung gibt es nicht.

Bei **Quadlet** mit `systemctl --user stop haben-app` stoppen. Einen einmaligen Container aus demselben Image mit der Netzwerk-, Umgebungsdatei- und Datenbank-Secret-Konfiguration aus `haben-app.container` starten, den Entrypoint auf `bun` setzen und `apps/web/src/server/db/local-owner.ts` mit den obigen Argumenten ausführen. Das Passwort ausschließlich über geschützte Standardeingabe übergeben. Anschließend `haben.env` ändern und `systemctl --user start haben-app` ausführen. Für die SSO-Übernahme denselben einmaligen Container mit `sso-uebernahme.ts --konto <ID> --subject <sub> --uebernehmen` verwenden.

In **Coolify** die Anwendung stoppen und den Betreiberbefehl auf dem Server als einmaligen Container aus demselben Image mit derselben Datenbankkonfiguration ausführen. Kein Exec in eine weiterhin laufende Haben-Instanz verwenden: Der exklusive Lock muss erfolgreich sein. Danach die Laufzeitvariable ändern und über Coolify neu starten. Weder Passwörter noch Secrets in Coolify-Befehlsprotokolle kopieren. Der Rückweg benötigt nur `DATABASE_URL`, nicht die Erreichbarkeit des IdP.

## Identitäten, Datenschutz und Betrieb

Beim Wechsel einer bestehenden Instanz erhält die erste erfolgreiche Inhaber-Anmeldung unmittelbar Zugriff auf vorhandene Daten. Deshalb Client, Issuer und Gruppen vor Aktivierung kontrollieren und bestehende Konten ausdrücklich übernehmen.

Das Subject muss belegbar zum Haben-Client gehören, etwa aus `authelia storage user identifiers export --config /config/configuration.yml`. Bei Keycloak ist es ohne eigenen Mapper die ID des Benutzers in der Admin-Konsole. Bei paarweisen Subjects den zum Client beziehungsweise Sector passenden Eintrag verwenden; E-Mail und Benutzername sind kein Ersatz für `sub`. Eine bereits gespeicherte exakte Kombination aus Issuer und Subject meldet weiterhin dasselbe Konto an. Eine erneute Übernahme derselben Zuordnung wird als bereits vorhanden abgewiesen, ein neues Subject braucht `--ersetzen`. Ein anderer Issuer, etwa nach einem Domainwechsel, benötigt neue ausdrückliche Zuordnungen je Konto.

Haben speichert Name und E-Mail beim ersten Login, Issuer und Subject, zuletzt bestätigte Rolle und Prüfzeitpunkt sowie IP und User-Agent der Sitzung. Vollständige Claims und Provider-Tokens werden nicht dauerhaft gespeichert. Uhren per NTP synchronisieren: Die Tokenprüfung bietet keine zusätzliche Ablauf-Toleranz. Backup und Restore müssen Datenbank, Secrets und denselben Issuer zusammen erhalten; abweichende Issuer benötigen eine bewusste Übernahme.
