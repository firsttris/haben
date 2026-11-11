---
title: "Entscheidung: E-Mail-Versand über Microsoft Graph"
description: >-
  Entscheidung: zweiter Versandweg neben SMTP über Microsoft Graph (Exchange Online, auch aus Shared
  Mailboxes) mit App-only-Anmeldung, Anhängen, Rechtebegrenzung, Fehlerbehandlung und Tests.
---

# Entscheidung: E-Mail-Versand über Microsoft Graph

**Status:** umgesetzt im Pull Request „E-Mail über Microsoft 365“; die Entscheidungen unten gelten, Abweichungen vom ersten
Entwurf stehen im Abschnitt „Entschieden und offen“. **Stand:** `main` bei `93124e3`, Microsoft-Doku am 10. November 2026
gelesen.
**Bezug:** [Roadmap S17](../roadmap.md) („E-Mail-Versand über Google oder Microsoft“, ohne Issue),
[E-Mail einrichten](../einrichtung.md#e-mail).

## Ausgangslage

Alle Mails gehen durch **eine** Funktion: `send()` in `apps/web/src/server/modules/mail/mail.ts`. Sie lädt die
Zeile `mail_settings`, baut ein nodemailer-Transport (`transportFactory`), ruft `sendMail` und schreibt jeden Versuch
nach `mail_log` (auch Fehler; Fehler kommen als Ergebnis zurück, nicht als Ausnahme). Aufrufer sind die Rechnungs-,
Mahnungs- und Angebotsmails (`rechnungen/invoice-mail.ts`), die Fristen-Erinnerung, die Prüfwert-Mail und die
Test-Mail. Das Passwort liegt AES-256-GCM-verschlüsselt in `mail_settings.ciphertext`, die Audit-Funktion
`haben_audit` lässt diese Spalte aus. Sieben Testdateien ersetzen den Transport über `setMailTransportForTests`.

Abweichungen von der Aufgabenstellung, die ich im Code gefunden habe:

- Die Dateien heißen `modules/mail/mail.ts` und `modules/rechnungen/invoice-mail.ts`, nicht `server/mail.ts`.
- **Eine Antwortadresse (`replyTo`) gibt es im SMTP-Weg heute nicht.** „Analog zum SMTP-Weg“ heißt hier: nicht setzen.
  Der Transport-Vertrag bekommt das Feld trotzdem, siehe offene Fragen.
- Haben läuft unter **Bun**, nicht unter Node 22; Prüfungen mit `bun run lint|typecheck|test`, nicht `pnpm`.
- `mail.ts` hat 390 Zeilen, die Grenze ist 400 (`scripts/dateigroesse`). Neuer Code kommt in neue Dateien, der SMTP-Teil
  wird dafür ausgelagert.

## Annahmen (bitte bestätigen)

- **A1** Ziel sind Exchange Online und Shared Mailboxes im eigenen Tenant des Betreibers; Google, sovereign Clouds
  (US Gov, China) und reine Microsoft-Konten sind nicht Teil dieses PRs.
- **A2** Ein Versandweg ist zur Zeit aktiv (SMTP **oder** Graph), kein Ausweichen vom einen auf den anderen.
- **A3** Es gibt für den PR keinen echten Tenant in der CI und auch sonst keinen Testtenant; das Verhalten gegen
  Exchange Online (Absendername, Shared Mailbox, Fehlercodes) ist bis dahin aus der Doku abgeleitet und im ADR als
  „zu prüfen“ markiert.

## Entscheidungen

### 1. Abstraktion: `MailTransport`

`send()` bleibt der einzige Einstieg und behält Protokollierung und Rückgabewert. Neu ist nur, woher der Transport kommt:

```ts
/** Was `send()` einem Versandweg übergibt; Form wie bei nodemailer, damit der SMTP-Weg unverändert bleibt */
interface OutgoingMail {
  from: { name: string; address: string };
  to: string;            // wie heute: eine oder mehrere Adressen, durch Komma getrennt
  bcc?: string;
  replyTo?: string;      // heute von keinem Aufrufer gesetzt
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer | string; contentType: string }[];
}
interface MailTransport { sendMail(mail: OutgoingMail): Promise<unknown>; }   // wirft bei Fehler
```

- `smtp`: das bestehende nodemailer-Transport, Code unverändert, nur in `transport-smtp.ts` verschoben.
- `graph`: neue Implementierung (siehe unten).
- Auswahl: neue Spalte `mail_settings.transport` (`smtp` | `graph`, Vorgabe `smtp`), `transportFor(settings)` in
  `transport.ts`. `setMailTransportForTests(factory)` bleibt mit gleicher Signatur und ersetzt **beide** Wege; die
  sieben bestehenden Testdateien ändern sich nicht.
- Der Vertrag ist absichtlich `sendMail(options)` wie bei nodemailer: Der erste Commit ist dann ein reines Verschieben
  ohne Verhaltensänderung, und ein Test beweist es (die bestehenden Tests laufen unverändert grün).

### 2. Anmeldung: App-only (Client Credentials)

Token über `@azure/msal-node` (`ConfidentialClientApplication.acquireTokenByClientCredential`,
Scope `https://graph.microsoft.com/.default`, Authority `https://login.microsoftonline.com/<Tenant-ID>`).
msal cached das Token im Speicher und erneuert es vor Ablauf selbst; wir halten eine Instanz je Einstellungsstand und
verwerfen sie beim Speichern oder Löschen der Einstellungen.

| Mittel | Wann | Speicherung |
| --- | --- | --- |
| **Zertifikat** (bevorzugt) | Vorgabe in der Doku | Privater Schlüssel (PEM, PKCS#8) verschlüsselt in `ciphertext`; SHA-256-Fingerabdruck des Zertifikats im Klartext in `graph_thumbprint` (kein Geheimnis, wird aus dem hochgeladenen Zertifikat berechnet) |
| **Client Secret** | Alternative | Secret verschlüsselt in `ciphertext` |

- Nur ein Geheimnis je Zeile, immer in `ciphertext`. Damit greift die vorhandene Regel „Geheimnisse nur in einer Spalte
  `ciphertext`“ und `haben_audit` lässt es ohne Änderung des Audit-Triggers aus (ein Trigger, der Audit-Daten
  filtert, wird nicht angefasst).
- Tenant-ID, Client-ID, Authentifizierungsart, Fingerabdruck und Absender sind keine Geheimnisse und stehen im Klartext
  (und damit im Audit-Log).
- Wechselt der Versandweg oder die Authentifizierungsart, muss das Geheimnis neu eingegeben werden; ein SMTP-Passwort
  wird nie als Graph-Geheimnis weiterverwendet.
- Zertifikat hochladen statt in Haben erzeugen: Node bringt keine X.509-Erzeugung mit, eine Bibliothek dafür wäre
  eine weitere Abhängigkeit. Die Doku zeigt `openssl`; ein Erzeugen in der Oberfläche kann später folgen.

**msal-node oder selbst mit `fetch` und `node:crypto`?** Ich empfehle msal-node (wie vorgegeben): Die Anmeldung mit
Zertifikat (signierte JWT-Assertion, Header `x5t#S256`), Token-Cache, Zeitabweichung und die Übersetzung der
AADSTS-Fehler sind sicherheitsrelevanter Code, den man nicht neu schreiben will. Gegenargumente: Bun ist **nicht
verifiziert** (ich habe msal-node 7.2.1, `engines: node >=20`, 8,3 MB mit `jsonwebtoken` und Co., unter Node 24
geladen und einen Tokenabruf bis zur Antwort von Entra ausgelöst; Bun ist auf meinem Rechner nicht installiert). **Gate
im zweiten Commit:** läuft msal-node im Dev-Container unter Bun (Tokenabruf gegen einen gemockten Endpunkt), bleibt es
dabei; sonst schreibe ich `TokenProvider` mit `fetch`/`node:crypto` (rund 80 Zeilen) hinter derselben Schnittstelle.
Den Graph-Client `@microsoft/microsoft-graph-client` nehme ich **nicht**: Es sind vier Endpunkte, und `fetch` gibt
volle Kontrolle über `Retry-After` und lässt sich in Tests einfach ersetzen.

### 3. Versand: `POST /users/{absender}/sendMail`

- Endpunkt und Form laut [user: sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0):
  `POST /users/{id | userPrincipalName}/sendMail`, Antwort `202 Accepted` ohne Inhalt. `saveToSentItems` ist laut Doku
  schon `true`, wenn es fehlt; Haben setzt es trotzdem ausdrücklich, damit die Absicht im Code steht.
- Application-Berechtigung `Mail.Send` ist die niedrigste. Bei **App-only** läuft der Versand als das Postfach in
  `{absender}`, also auch aus einer **Shared Mailbox**; die Mail landet in deren „Gesendeten Elementen“ (zu prüfen im
  Testtenant, siehe A3).
- **Absender frei einstellbar:** `fromAddress` (wie heute, steht im `From` und als BCC bei „Kopie an mich“) und
  optional `graph_mailbox` (UPN oder Objekt-ID, wenn sie von der Adresse abweicht, etwa bei Alias-Adressen).
  Ohne `graph_mailbox` gilt `fromAddress`.
- Abbildung: `to`/`bcc` (Komma-Liste) → `toRecipients`/`bccRecipients`; `html` → `body.contentType = "HTML"`;
  den Textteil kann `sendMail` im JSON nicht neben HTML tragen (ein Body hat genau einen `contentType`). Der Text
  entfällt also im Graph-Weg; die HTML-Mails von Haben sind schlicht aufgebaut, das ist die Abweichung zu SMTP
  (`multipart/alternative`) und kommt in die Doku. `replyTo` → `replyTo`. `from` wird gesetzt (Name und Adresse des
  Postfachs). **Zu prüfen:** ob Exchange den Anzeigenamen aus `from.emailAddress.name` übernimmt oder den des
  Postfachs nimmt (`senderName` wäre dann wirkungslos, die Doku sagt es).
- **MIME statt JSON** (`Content-Type: text/plain`, Base64-MIME) wäre die Alternative: nodemailers `MailComposer`
  erzeugt dieselben Bytes wie der SMTP-Weg, mit Text- und HTML-Teil und beliebigen Anhängen. Ich habe es **nicht**
  gewählt, weil die Größengrenze für diesen Weg in der Doku nicht steht und ich sie ohne Testtenant nicht prüfen kann.
  Reicht sie für größere Anhänge, wäre MIME der Weg dafür (kein Entwurf, kein `Mail.ReadWrite`); das lässt sich erst mit
  einem Testtenant entscheiden und ist nicht Teil dieses PRs.

### 4. Delegierter Modus: nicht umsetzen

Nur App-only. Begründung:

- Haben sendet **unbeaufsichtigt** (wiederkehrende Rechnungen, Erinnerungen, die Prüfwert-Mail nachts). Ein delegierter
  Weg bräuchte ein Refresh-Token einer Person, das bei Passwortwechsel, Conditional Access oder Inaktivität ablaufen
  kann; dann stehen Rechnungen still.
- Er bräuchte einen OAuth-Ablauf in der App (Weiterleitung, Callback, `state`, Zustimmung je Nutzer) und ein weiteres
  Benutzer-gebundenes Geheimnis; die Angriffsfläche wäre größer als ein Zertifikat auf dem Server.
- Shared-Mailbox-Versand wäre zusätzlich von SendAs- oder SendOnBehalf-Rechten der angemeldeten Person abhängig.
- Der einzige echte Vorteil, dass der Admin keinen tenantweiten Anwendungszugriff vergeben will, ist mit der
  Einschränkung auf bestimmte Postfächer (nächster Abschnitt) abgedeckt.

### 5. Rechte begrenzen

**Wichtig für die Doku:** `Mail.Send` (Application) mit Admin-Zustimmung in Entra erlaubt der App, **als jedes
Postfach des Tenants** zu senden. Die Einrichtung muss das deshalb einschränken. Stand der Microsoft-Doku
([Role Based Access Control for Applications in Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)):

- **RBAC for Applications** ersetzt die Application Access Policies („It replaces Application Access Policies“).
  Haben dokumentiert RBAC; die Access Policy bekommt nur einen Hinweis für Bestandstenants.
- Schritte: `New-ServicePrincipal` (AppId und **ObjectId der Unternehmensanwendung**, nicht die Werte der
  App-Registrierung), `New-ManagementScope` mit `-RecipientRestrictionFilter` für die erlaubten Postfächer (oder eine
  Administrative Unit), `New-ManagementRoleAssignment -App … -Role "Application Mail.Send" -CustomResourceScope …`,
  prüfen mit `Test-ServicePrincipalAuthorization -Resource <Postfach>`.
- **Falle:** Die Rechte aus Entra und aus Exchange-RBAC werden **vereinigt**. Bleibt `Mail.Send` in Entra mit
  Admin-Zustimmung erteilt, ist die Einschränkung wirkungslos. Für den eingeschränkten Weg wird die Zustimmung in Entra
  deshalb nicht erteilt bzw. entfernt. Ob dann ein Token ohne `roles`-Claim trotzdem sendet, ist laut Doku so gedacht,
  **aber im Testtenant zu prüfen** (A3); die Einrichtung beschreibt beide Wege (schnell und tenantweit, oder
  eingeschränkt).
- Änderungen wirken laut Doku nach 30 Minuten bis 2 Stunden (Cache); `Test-ServicePrincipalAuthorization` umgeht ihn.
  Das gehört in die Fehlerbilder („gerade geändert, noch nicht wirksam“).

### 6. Anhänge

Grenzen aus [Attach large files](https://learn.microsoft.com/en-us/graph/outlook-large-attachments): unter 3 MB ein
einzelner Anhang direkt; ab 3 MB braucht es eine Upload-Session, und die verlangt laut Doku `Mail.ReadWrite`
(Application), nicht nur `Mail.Send`. Zu Shared Mailboxes und großen Anhängen nennt die Doku ein bekanntes Problem
(Known Issue 13644). Die ungefähre Grenze von 4 MB für den `sendMail`-Request habe ich in der Doku **nicht** bestätigt
gefunden; ich rechne vorsichtig.

**Entscheidung: nur direkter Versand, keine Upload-Session.** Die Summe der Anhänge darf höchstens 2,5 MB roh betragen
(Base64 macht daraus rund 3,3 MB); `sendMail` bekommt sie als `fileAttachment` mit `contentBytes`. Darüber bricht der
Versand ab, bevor etwas gesendet wird (kein Teilversand), mit der Meldung: „Die Anhänge (x MB) sind für den Versand über
Microsoft 365 zu groß (höchstens 2,5 MB). Verkleinere die Anhänge oder verwende SMTP.“

Gründe:

- **Geringstes Recht:** `Mail.Send` allein genügt. `Mail.ReadWrite` hieße, die App könnte **alle Mails der erlaubten
  Postfächer lesen und ändern**; für Rechnungs-PDF plus E-Rechnung (meist unter 1 MB) ist das zu viel.
- **Nicht prüfbar:** Der Entwurf-und-Upload-Weg, besonders in einer Shared Mailbox (Known Issue 13644), lässt sich ohne
  Testtenant nicht verifizieren; ungeprüftes Verhalten baue ich nicht ein.
- **Später möglich:** Der Schwellwert steht als Konstante in einer Datei. Eine Stufe B (Entwurf, `createUploadSession`,
  `/send`, Entwurf bei Fehler löschen) oder der MIME-Weg (siehe 3.) lassen sich nachrüsten, sobald ein Testtenant
  da ist, ohne die Schnittstelle zu ändern.

### 7. Fehlerbehandlung

- **Wiederholen** nur bei `429` und `503` mit `Retry-After` (Sekunden oder Datum), höchstens 3 Versuche und in Summe
  höchstens 30 Sekunden Wartezeit (der Nutzer wartet in der Oberfläche; der Scheduler bekommt dann den Fehler und
  versucht es im nächsten Lauf). Ohne `Retry-After`: Backoff 1 s, 2 s, 4 s.
- **Nicht wiederholen** bei Zeitüberschreitung, Netzfehlern und anderen 5xx: Ein `202` trägt keine Kennung, ein
  erneuter Versuch nach einer Zeitüberschreitung könnte dieselbe Rechnung **doppelt** zustellen. Besser ein protokollierter
  Fehler, den der Nutzer bewusst wiederholt.
- **Limits** (Outlook je App und Postfach, aus [Throttling-Limits](https://learn.microsoft.com/en-us/graph/throttling-limits)):
  10 000 Anfragen je 10 Minuten, 4 gleichzeitige, 150 MB Upload je 5 Minuten. Haben sendet seriell, das reicht; die
  tägliche Empfängergrenze von Exchange Online ist ein Dienstlimit und kommt als Fehler zurück.
- **Meldungen auf Deutsch** statt der rohen Graph-Antwort. Zuordnung nach HTTP-Status und `error.code`, mit dem
  `request-id` aus dem Antwort-Header im Fehlertext (für den Microsoft-Support). Die genauen Fehlercodes der
  Anmeldung (AADSTS …) und von Exchange für „Postfach nicht erlaubt“, „Absender existiert nicht“ und „Berechtigung fehlt“
  sind **im Testtenant zu verifizieren**; ich lege sie nicht aus dem Gedächtnis fest, sondern gruppiere vorerst nach
  Status: 401 → Anmeldung (Tenant, Client, Geheimnis, Zertifikat), 403 → Berechtigung oder Postfach nicht erlaubt,
  404 → Postfach unbekannt, 400 → Empfänger oder Inhalt, 413 → zu groß, 429/503 → überlastet, später versuchen.
- **Protokoll:** Jeder Versuch steht wie bisher in `mail_log` (`ok`, `error`), vom Versandweg unabhängig, weil `send()`
  protokolliert. Der Fehlertext nennt nie Secret, Token oder Zertifikat. Jede Zeile trägt den Versandweg in der neuen
  Spalte `transport` (siehe 8.).

### 8. Schema und Einstellungsseite

Migration (erzeugt mit `bun run db:generate`, danach Trigger-Prüfung):

- `mail_settings.transport text not null default 'smtp'` mit CHECK `in ('smtp','graph')`;
- `host`, `port`, `secure`, `username`, `ciphertext` werden **nullable**, dazu ein CHECK: bei `smtp` sind sie alle
  gesetzt, bei `graph` sind `graph_tenant_id`, `graph_client_id`, `graph_auth` (`secret` | `certificate`) und
  `ciphertext` gesetzt (bei `certificate` auch `graph_thumbprint`);
- neue Spalten `graph_tenant_id`, `graph_client_id`, `graph_auth`, `graph_thumbprint`, `graph_mailbox`;
- `mail_log.transport text not null default 'smtp'` (`smtp` | `graph`): zeigt je Versuch den Versandweg. Die Tabelle ist nur
  anhängbar und nicht versiegelt, eine neue Spalte ändert keinen Trigger; vorhandene Zeilen sind SMTP. `send()` schreibt sie.

Bestehende Zeilen bekommen `transport = 'smtp'` und bleiben gültig; kein Trigger ändert sich, `mail_settings` ist weder
versiegelt noch festgeschrieben. Das Lockern von NOT NULL ist ein neuer Schritt in einer neuen Migration, keine Änderung
einer bestehenden.

Die Seite (`MailCard.tsx`, 307 Zeilen, wird dafür in zwei Komponenten geteilt) bekommt eine Auswahl „SMTP“ / „Microsoft
365 (Graph)“. Graph: Tenant-ID, Client-ID, Anmeldung (Zertifikat: PEM-Datei und Zertifikat hochladen; Secret: Feld),
Absender und optional Postfach (UPN), **Test-Mail senden** (vorhanden). Die Oberfläche
bekommt das Geheimnis nie zurück, nur „gespeichert“ (wie beim SMTP-Passwort).

### 9. Ausblick, nicht Teil des PRs

Belegeingang per Graph statt IMAP (`Mail.Read` auf ein Postfach, `inbox_settings`), Google OAuth, sovereign Clouds,
Zertifikat in Haben erzeugen, Ablaufwarnung für Secret und Zertifikat.

## Betroffene Stellen

| Bereich | Änderung |
| --- | --- |
| `modules/mail/` | `mail.ts` schrumpft (SMTP-Transport und Schema ausgelagert); neu `transport.ts`, `transport-smtp.ts`, `graph/` (Token, Anfrage, Versand, Fehler) |
| `index.ts` des Moduls | nur Exporte; andere Module bleiben unberührt (Modulgrenzen) |
| `db/schema.ts` | `mail_settings` und `mail_log` (nur Spalten, kein Trigger) |
| `functions/mail.ts`, `MailCard.tsx` | Eingabe als `z.discriminatedUnion("transport", …)`, Oberfläche |
| `rechnungen/invoice-mail.ts` | keine; es ruft weiter `send()` und liest `settings.fromAddress` |
| `docs/` | `einrichtung.md` (neuer Abschnitt), `architektur.md` (Tabelle, Verschlüsselung), `installation.md` (Liste der Geheimnisse), `roadmap.md` (S17), `rechnungen.md` (SMTP-Hinweis) |
| Abhängigkeiten | `@azure/msal-node` (Begründung oben), sonst keine |

## Sicherheit

- **Geheimnisse** nur in `ciphertext`, nie im Audit-Log, nie in Antworten an den Browser, nie in Fehlertexten oder Logs.
- **Rechte des Tokens:** Die Doku erklärt, wie der Zugriff auf erlaubte Postfächer begrenzt wird, und dass ohne Begrenzung
  jedes Postfach des Tenants als Absender möglich ist. Die Oberfläche weist darauf hin.
- **Nur der Inhaber** darf die Einstellungen ändern (`authMiddleware`, wie bisher); die Steuerberatung sieht sie nicht.
- **HTTP:** feste Hosts (`login.microsoftonline.com`, `graph.microsoft.com`); die Upload-URL aus der Session wird nur
  genutzt, wenn sie `https` ist und auf `outlook.office.com` bzw. `outlook.office365.com` zeigt (kein Weiterreichen von
  Anfragen an beliebige Adressen); Zeitlimits an jedem Aufruf.
- **Lizenz:** `@azure/msal-node` steht unter MIT (vor dem Eintragen in `package.json` am Paket zu bestätigen); AGPL-3.0
  von Haben bleibt unberührt.

## Tests (Umsetzung)

- **Unit (Vitest, mit gemocktem `fetch` und gemocktem `TokenProvider`):** Auswahl des Transports nach `transport`;
  Aufbau des Requests (Shared Mailbox als `{absender}`, `from`, mehrere Empfänger, BCC, HTML, `replyTo`); Anhänge im
  Limit (`fileAttachment` mit Base64), knapp darüber (Fehler, nichts gesendet, kein Request); Retry mit `Retry-After` (Sekunden und Datum), kein Retry bei
  Zeitüberschreitung; deutsche Meldungen je Status.
- **Postgres (`TEST_DATABASE_URL`):** `mail_log.transport` stimmt je Versuch; Geheimnis liegt nur verschlüsselt in der Zeile und nicht im Audit-Log (weder
  `new_value` noch `old_value`), weder bei Secret noch bei Zertifikat; Wechsel von SMTP auf Graph verlangt neues
  Geheimnis; CHECK der Spalten; bestehende SMTP-Zeile bleibt nach der Migration gültig.
- **SMTP unverändert:** die sieben bestehenden Testdateien laufen ohne Änderung.
- **Kein echter Tenant in der CI.** Ein Test gegen einen echten Tenant bleibt eine lokale Skript-Hilfe, die ohne
  Umgebungsvariablen nichts tut und in der Beschreibung des PRs als nicht gelaufen steht.

## Entschieden und offen

Entschieden (10. November 2026, mit dem Auftraggeber):

- Es gibt **keinen Testtenant**. Alles, was nur dort prüfbar ist, wird nicht eingebaut (Upload-Session, MIME) oder als
  „zu prüfen“ in der Doku und im PR genannt.
- **Große Anhänge:** keine Upload-Session, kein `Mail.ReadWrite`, stattdessen eine klare Fehlermeldung (6.).
- **MIME statt JSON:** nicht in diesem PR.
- **`mail_log.transport`:** kommt (8.).

Offen:

1. `replyTo` jetzt schon verdrahten (es gibt kein Eingabefeld dafür) oder nur im Vertrag vorsehen? Vorschlag: nur im Vertrag.
2. Passt es zu Haben, dass `@azure/msal-node` als Abhängigkeit dazukommt? Das Bun-Gate im zweiten Commit entscheidet,
   ob stattdessen `fetch` und `node:crypto` genügen.
3. Ob Exchange den Anzeigenamen aus `from` übernimmt, bleibt ungeprüft; die Doku sagt es offen.

Umgesetzt wie vorgeschlagen: `replyTo` nur im Vertrag (`OutgoingMail`) und im Request, ohne Eingabefeld; `@azure/msal-node` läuft
unter Bun (Test mit gemocktem Entra-ID-Endpunkt in `graph/token.test.ts`), die Alternative mit `fetch` und `node:crypto` wurde
deshalb nicht gebraucht.

## Reihenfolge der Commits

1. Vertrag `MailTransport`, SMTP in `transport-smtp.ts`, `mail.ts` unter 400 Zeilen, **keine Verhaltensänderung**.
2. Schema und Migration (`transport`, Graph-Spalten), Speichern und Verschlüsseln.
3. Graph-Transport: Token, `sendMail`, Anhänge bis 2,5 MB, Fehler, Tests.
4. Einstellungsseite.
5. Doku: Einrichtung Schritt für Schritt (App registrieren, Zertifikat, Postfächer einschränken, Shared Mailbox,
   Fehlerbilder, Grenze für Anhänge), Architektur, Roadmap.
