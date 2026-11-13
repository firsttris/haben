---
title: "E-Mail-Versand in Haben einrichten: SMTP oder Microsoft 365"
description: >-
  Rechnungen, Angebote, Mahnungen und Erinnerungen an Fristen per E-Mail versenden: Zugang über SMTP
  oder für Postfächer in Microsoft 365 über Microsoft Graph einrichten.
---

# E-Mail

Für [Rechnungen, Angebote und Mahnungen per E-Mail](rechnungen.md#per-e-mail-versenden) und [Erinnerungen an Fristen](fristen.md#erinnerungen-per-e-mail) braucht Haben einen E-Mail-Zugang über SMTP oder, für Postfächer in Microsoft 365, über [Microsoft Graph](#e-mail-über-microsoft-365). Unter **Einstellungen › E-Mail › E-Mail-Versand** den Anbieter wählen (Gmail, GMX, web.de, Posteo, mailbox.org belegen Server, Port und Verschlüsselung vor) oder einen eigenen Server eintragen, dazu Benutzername, Passwort, Absender und den Empfänger der Erinnerungen. Der **Absendername** steht beim Empfänger vor der Adresse; bleibt er leer, nimmt Haben den Firmennamen aus den Firmendaten, ohne Firmennamen „Haben“. **Test-Mail senden** prüft den Zugang. Solange „Prüfwert des Änderungsprotokolls wöchentlich mailen“ eingeschaltet ist, kommt an dieselbe Adresse einmal pro Woche der aktuelle Prüfwert, wenn sich etwas geändert hat. Bewahre diese Mails auf: Mit ihnen lässt sich später zeigen, dass das Protokoll bis dahin nicht nachträglich verändert wurde (siehe [Buchhaltung in Haben](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel)).

- **Gmail:** Zwei-Faktor-Anmeldung einschalten und unter myaccount.google.com › Sicherheit › App-Passwörter ein App-Passwort erzeugen; das ist das Passwort für Haben, Benutzername ist die Gmail-Adresse. Eine eigene Gmail-Anbindung über die Google-API braucht es nicht.
- **GMX und web.de:** im Postfach unter Einstellungen › POP3/IMAP den Zugriff per externem Programm erlauben.

Unter **Vorlagen** legst du Betreff und Text der E-Mails je Art und Sprache fest (siehe [Per E-Mail versenden](rechnungen.md#per-e-mail-versenden)).

Das Passwort speichert Haben AES-256-GCM-verschlüsselt wie das ELSTER-Zertifikat; es steht nicht im Audit-Log und wird nie angezeigt. Zum Ändern anderer Angaben das Passwortfeld leer lassen.

## E-Mail über Microsoft 365

Microsoft schaltet Basic Auth für SMTP AUTH in Exchange Online ab. Für Postfächer in Microsoft 365 verschickt Haben deshalb auch über **Microsoft Graph**. Haben meldet sich dabei als App ohne Benutzer bei Microsoft Entra ID an (Client Credentials) und sendet mit `POST /users/{Postfach}/sendMail`. Das geht aus einem Benutzerpostfach und aus einer **Shared Mailbox**; die Mail steht danach in „Gesendete Elemente“ dieses Postfachs. SMTP bleibt unverändert, der Versandweg ist unter **Einstellungen › E-Mail › E-Mail-Versand** wählbar. Für die Einrichtung brauchst du Administratorrechte im Tenant (Entra ID und Exchange Online).

> [!WARNING]
> Die Berechtigung `Mail.Send` (Application) mit Administratorzustimmung erlaubt der App, **als jedes Postfach des Tenants** zu senden. Beschränke sie auf die Postfächer, aus denen Haben senden soll (Schritt 5).

**1. App registrieren.** Im Entra-Admin-Center unter **Anwendungen › App-Registrierungen › Neue Registrierung** einen Namen wählen (etwa „Haben Mailversand“), Konten nur in diesem Verzeichnis, keine Umleitungs-URI. Auf der Übersicht stehen **Anwendungs-ID (Client)** und **Verzeichnis-ID (Mandant)**; beide trägst du in Haben ein.

**2. Zertifikat erzeugen und hochladen (empfohlen).** Ein Zertifikat ersetzt das Secret, das nach höchstens 24 Monaten abläuft. Auf einem beliebigen Rechner:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout haben-mail.key -out haben-mail.crt -days 730 -subj "/CN=Haben Mailversand"
```

`haben-mail.crt` lädst du in der App-Registrierung unter **Zertifikate & Geheimnisse › Zertifikate** hoch. In Haben wählst du **Zertifikat** als Anmeldung und gibst beide Dateien an (`.crt` und `.key`, ohne Passwort). Haben prüft, dass Schlüssel und Zertifikat zusammengehören und das Zertifikat nicht abgelaufen ist, speichert den privaten Schlüssel AES-256-GCM-verschlüsselt und zeigt danach nur noch den Fingerabdruck. Lösche `haben-mail.key` anschließend vom Rechner. Das Zertifikat läuft nach 730 Tagen ab; Haben erinnert nicht daran, trage den Termin in deinen Kalender ein.

*Alternative Client Secret:* unter **Zertifikate & Geheimnisse › Geheimnisse › Neues Clientgeheimnis** erzeugen, den **Wert** (nicht die ID) sofort kopieren und in Haben unter **Client Secret** eintragen.

**3. Berechtigung vergeben.** Es gibt zwei Wege:

- **Eingeschränkt (empfohlen):** Die Rechte kommen aus **Exchange Online** (RBAC für Anwendungen), die App bekommt in Entra ID **keine** Graph-Berechtigung. Weiter mit Schritt 4 und 5.
- **Tenantweit (schnell, nicht empfohlen):** In der App-Registrierung unter **API-Berechtigungen › Berechtigung hinzufügen › Microsoft Graph › Anwendungsberechtigungen** `Mail.Send` wählen und **Administratorzustimmung erteilen**. Danach darf die App aus jedem Postfach senden. Eine Einschränkung nach Schritt 5 wirkt dann **nicht**, weil Microsoft die Rechte aus Entra ID und aus Exchange vereinigt.

**4. Dienstprinzipal in Exchange Online anlegen.** In PowerShell mit dem Modul `ExchangeOnlineManagement` als Administrator:

```powershell
Connect-ExchangeOnline
# AppId = Anwendungs-ID (Client). ObjectId = Objekt-ID der *Unternehmensanwendung* (Entra ID › Unternehmensanwendungen),
# nicht die Objekt-ID der App-Registrierung: Beide Seiten zeigen verschiedene Werte.
New-ServicePrincipal -AppId <Anwendungs-ID> -ObjectId <Objekt-ID der Unternehmensanwendung> -DisplayName "Haben Mailversand"
```

**5. Auf bestimmte Postfächer beschränken.** Ein Verwaltungsbereich nennt die erlaubten Postfächer, die Rollenzuweisung gibt der App `Mail.Send` nur dafür:

```powershell
New-ManagementScope -Name "Haben Postfächer" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'rechnung@firma.example'"
New-ManagementRoleAssignment -App <Objekt-ID der Unternehmensanwendung> -Role "Application Mail.Send" -CustomResourceScope "Haben Postfächer"
Test-ServicePrincipalAuthorization -Identity <Objekt-ID der Unternehmensanwendung> -Resource rechnung@firma.example
```

Mehrere Postfächer verbindest du im Filter mit `-or`; statt eines Filters geht auch eine Administrative Unit (`-RecipientAdministrativeUnitScope`). `InScope` muss bei `Test-ServicePrincipalAuthorization` für das Postfach `True` sein und für ein anderes `False`. Änderungen wirken laut Microsoft nach 30 Minuten bis 2 Stunden; der Testbefehl umgeht diesen Zwischenspeicher. Ältere Anleitungen nennen **Application Access Policies**; Microsoft hat sie durch RBAC für Anwendungen ersetzt. Quellen: [RBAC for Applications in Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [user: sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

**6. In Haben eintragen.** Unter **Einstellungen › E-Mail › E-Mail-Versand** den Versandweg **Microsoft 365 (Graph)** wählen und eintragen:

| Feld | Inhalt |
| --- | --- |
| Verzeichnis-ID (Tenant) | GUID oder Domäne des Tenants (`firma.onmicrosoft.com`) |
| Anwendungs-ID (Client) | GUID der App-Registrierung |
| Anmeldung | Zertifikat oder Client Secret |
| Absender | Adresse des Postfachs, aus dem gesendet wird, auch die einer Shared Mailbox |
| Postfach | Nur nötig, wenn es von der Absenderadresse abweicht: Benutzerprinzipalname (UPN) oder Objekt-ID, etwa bei einer Alias-Adresse |

Dann **Speichern** und **Test-Mail senden**; sie geht an die Adresse für Erinnerungen. Beim Ändern anderer Angaben lässt du Secret oder Zertifikat leer, dann bleibt das gespeicherte. Beim Wechsel des Versandwegs oder der Anmeldeart musst du das Geheimnis neu angeben.

**Shared Mailbox als Absender.** Trage die Adresse der Shared Mailbox als **Absender** ein. Die Mail geht als diese Mailbox hinaus und liegt in deren „Gesendeten Elementen“. Die Shared Mailbox braucht keine Anmeldung; die Rechte der App in Schritt 5 müssen sie einschließen. „Blindkopie an mich“ schickt die Kopie an diese Adresse.

**Grenzen gegenüber SMTP:**

- **Anhänge:** höchstens 2,5 MB zusammen. Darüber lehnt Haben den Versand vor dem Senden mit einer Meldung ab. Größere Anhänge bräuchten zusätzlich `Mail.ReadWrite` (die App könnte dann alle Mails der erlaubten Postfächer lesen); das hat Haben bewusst nicht eingebaut. Bei größeren Anhängen nutze SMTP.
- **Nur HTML:** Eine Nachricht über Graph hat einen Inhalt. Haben sendet den HTML-Teil, einen Nur-Text-Teil daneben gibt es nicht.
- **Absendername:** Haben schickt den Namen aus den Einstellungen mit. Ob Exchange ihn übernimmt oder den Anzeigenamen des Postfachs verwendet, ist nicht geprüft.
- **Ungeprüft:** Haben ist gegen einen gemockten Endpunkt getestet, nicht gegen einen echten Tenant. Meldet sich etwas anders als hier beschrieben, bitte als Issue melden (ohne Tenant-IDs und Adressen).

**Fehlerbilder.** Jeder Versuch steht im Versandprotokoll mit dem Versandweg. Die Meldung nennt dahinter den Fehlercode und die Anfrage-ID von Microsoft; mit ihr findet der Support die Anfrage.

| Meldung | Ursache und Abhilfe |
| --- | --- |
| „Die Anmeldung bei Microsoft Entra ID ist fehlgeschlagen … AADSTS…“ | Tenant, Client-ID, Secret oder Zertifikat stimmen nicht, das Secret ist abgelaufen oder das Zertifikat fehlt in Entra ID. Den Code (AADSTS) in der [Fehlerliste von Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes) nachschlagen |
| „Die App darf nicht aus dem Postfach … senden“ (403) | Die Rolle `Application Mail.Send` fehlt, das Postfach liegt nicht im Verwaltungsbereich, oder die Änderung ist noch nicht wirksam (bis zu 2 Stunden). Mit `Test-ServicePrincipalAuthorization` prüfen |
| „Das Postfach … gibt es nicht“ (404) | Absenderadresse oder Feld Postfach falsch; bei einer Alias-Adresse den Benutzerprinzipalnamen eintragen |
| „Microsoft 365 hat die Mail abgelehnt“ (400) | Ungültiger Empfänger oder Inhalt |
| „Microsoft 365 ist überlastet“ (429) | Haben hat nach der Wartezeit von Microsoft dreimal versucht (höchstens 30 Sekunden). Später erneut senden. Für Outlook gelten je App und Postfach 10 000 Anfragen in 10 Minuten und vier gleichzeitige ([Limits](https://learn.microsoft.com/en-us/graph/throttling-limits)) |
| „Keine Verbindung zu Microsoft 365“ | Netzwerk oder Zeitüberschreitung. Haben wiederholt dann **nicht** von selbst: Die Mail ist vielleicht doch angekommen, prüfe „Gesendete Elemente“, bevor du erneut sendest |

Client Secret und privater Schlüssel liegen wie das SMTP-Passwort AES-256-GCM-verschlüsselt in der Datenbank; sie stehen nicht im Audit-Log und werden nie angezeigt. Tenant, Client, Fingerabdruck und Postfach stehen im Audit-Log, sie sind keine Geheimnisse. Sichere `HABEN_ENCRYPTION_KEY` wie sonst getrennt vom Backup.
