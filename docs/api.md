# REST-API

Über die REST-API legen eigene Werkzeuge und Automationen Kontakte und Rechnungsentwürfe in Haben an, etwa eine Automation, die Bestellungen aus Etsy oder eBay holt. Haben bekommt dafür keine eigene Bestellverwaltung: Die Bestellung bleibt auf der Plattform, Haben schreibt die Rechnung dazu. Ebenso liefern eigene Werkzeuge, Dokumentenarchive und Skripte Eingangsbelege an Haben, die dort unter **Belege** als „Zu prüfen“ landen.

Die Oberfläche einer solchen Automation kannst du als [eigene Seite](eigene-seiten.md) ins Menü von Haben hängen.

Die API **bucht nichts, schreibt nichts fest und versendet nichts**. Ein Entwurf aus der API ist ein Entwurf wie jeder andere: Du prüfst ihn in Haben und schreibst ihn dort mit einem Klick fest. Das bleibt wegen GoBD so, denn erst mit dem Festschreiben bekommt die Rechnung ihre Nummer, ihr PDF und ihre Buchung. Genauso wird ein Beleg aus der API erst gebucht, wenn du ihn in Haben geprüft hast.

| Bereich | Was die API kann |
| --- | --- |
| Kontakte | auflisten und suchen, lesen, anlegen, ändern (nicht löschen: Kontakte sind versioniert) |
| Rechnungen | alle lesen, auch festgeschriebene; Entwürfe anlegen, ändern und löschen, solange sie Entwurf sind |
| Belege | hochladen (landen als „Zu prüfen“), auflisten und lesen, ob sie schon geprüft und gebucht sind; nicht ändern oder löschen |

Die vollständige Beschreibung als OpenAPI 3.1 liefert Haben selbst unter `https://<deine Adresse>/api/v1/openapi.json`, ohne Token. Werkzeuge wie Swagger UI, Bruno oder Postman lesen sie ein.

## Einrichten

1. **Einstellungen → KI-Assistenten und API** öffnen und **Zugang für KI-Assistenten und API einschalten**.
2. Unter **API-Tokens** einen Namen vergeben (z. B. „Shop-Automation“), die Gültigkeit wählen und unter **Rechte** nur ankreuzen, was das Werkzeug braucht. Für Bestellungen sind das meist „Kontakte lesen, anlegen und ändern“ und „Rechnungen lesen, Entwürfe anlegen, ändern und löschen“; den Haken bei „KI-Assistent (MCP)“ nimmst du dann heraus.
3. **Token anlegen** und das Token sofort kopieren: Haben speichert nur seinen SHA-256-Hash und zeigt es nie wieder an.

Es sind dieselben Tokens wie für die [KI-Assistenten](ki-assistenten.md); was ein Token darf, sagen allein seine Rechte. Jedes Werkzeug sollte sein eigenes Token bekommen. **Widerrufen** sperrt es sofort, den Zugang ausschalten sperrt alle auf einmal.

| Recht | Erlaubt |
| --- | --- |
| `kontakte:lesen` | `GET /kontakte`, `GET /kontakte/{id}` |
| `kontakte:schreiben` | dazu `POST /kontakte`, `PATCH /kontakte/{id}` |
| `rechnungen:lesen` | `GET /rechnungen`, `GET /rechnungen/{id}` |
| `rechnungen:entwuerfe` | dazu `POST /rechnungen`, `PATCH /rechnungen/{id}`, `DELETE /rechnungen/{id}` |
| `belege:lesen` | `GET /belege`, `GET /belege/{id}` |
| `belege:anlegen` | dazu `POST /belege` |
| `haben:lesen` | nur die Werkzeuge über [MCP](ki-assistenten.md), nicht die REST-API |

Schreiben und anlegen schließen lesen ein. Ein Token ohne das nötige Recht bekommt `403`.

## Grundlagen

- **Adresse:** `https://<deine Adresse>/api/v1`. Die Version steht im Pfad. Innerhalb von `v1` kommen höchstens Felder und Endpunkte dazu; ein Client sollte unbekannte Felder in Antworten deshalb übergehen. Was nicht mehr dazu passt, kommt als `v2`.
- **Anmeldung:** Header `Authorization: Bearer hb_…`. Die Sitzung aus dem Browser reicht der API nicht, das Cookie zählt dort nicht.
- **Format:** JSON mit `Content-Type: application/json`, höchstens 1 MB je Anfrage. Nur das Hochladen von Belegen nimmt `multipart/form-data`, mit der Grenze des Uploads unter Belege (20 MB je Datei).
- **Einheiten wie überall in Haben:** Beträge in ganzen Cent (`5712` = 57,12 €), Steuersätze in Basispunkten (`1900` = 19 %, `700` = 7 %, `0`), Mengen in Tausendsteln (`1000` = 1 Stück, `1500` = 1,5 Stunden), Datum als `JJJJ-MM-TT`. Bei Fremdwährung sind `net`, `tax` und `gross` in Euro umgerechnet, die Einzelpreise stehen in der Währung der Rechnung.
- **Listen** haben `limit` (1 bis 500, Vorgabe 100) und `offset` und antworten mit `{ "data": […], "total": …, "limit": …, "offset": … }`.
- **Grenze:** 120 Anfragen je Minute und Token, darüber `429` mit `Retry-After: 60`. Werkzeuge über MCP und die API zählen zusammen.
- **Protokoll:** Jeder Aufruf steht ohne Inhalte unter **Letzte Aufrufe** (z. B. `POST /rechnungen`), 90 Tage lang. Was die API anlegt oder ändert, steht im Änderungsprotokoll mit dem Namen des Tokens als Akteur (`api:Shop-Automation`).

### Fehler

Jeder Fehler hat dieselbe Form, mit einer deutschen Meldung und bei ungültigen Eingaben einer Liste je Feld:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Ungültige Eingabe. lines.0.taxRate: Ungültige Option: erwartet eine von 1900|700|0",
    "issues": [{ "path": "lines.0.taxRate", "message": "Ungültige Option: erwartet eine von 1900|700|0" }]
  }
}
```

| Status | `code` | Bedeutung |
| --- | --- | --- |
| 400 | `validation_failed`, `invalid_json`, `invalid_multipart` | Eingabe ungültig, unbekanntes Feld, kein JSON oder kein gültiges Formular |
| 401 | `unauthorized` | Kein, ein falsches, abgelaufenes oder widerrufenes Token, oder der Zugang ist ausgeschaltet |
| 403 | `forbidden` | Dem Token fehlt das Recht; die Meldung nennt es |
| 404 | `not_found` | Unbekannter Pfad oder Datensatz |
| 405 | `method_not_allowed` | Methode gibt es hier nicht; `Allow` nennt die erlaubten |
| 409 | `conflict` | Die Rechnung ist festgeschrieben, oder ein Entwurf, den nur Haben selbst bearbeitet (Storno, Korrektur, Abschlag, Schlussrechnung, aus einem Angebot); bei Belegen: dieselbe Datei liegt mit einer anderen oder ohne Referenz schon vor, `existingId` nennt den Beleg |
| 413, 415 | `payload_too_large`, `unsupported_media_type` | Body größer als 1 MB (Beleg: Datei größer als 20 MB) oder nicht als JSON (Beleg: nicht als `multipart/form-data`, oder die Datei ist kein PDF, Bild oder E-Rechnungs-XML) |
| 422 | `unprocessable` | Fachlich abgelehnt, etwa ein unbekannter Kontakt |
| 429 | `rate_limited` | Zu viele Anfragen |
| 500 | `internal_error` | Fehler im Server; die Details stehen nur im Server-Log |

## Externe Referenz: eine Rechnung je Bestellung

Ein Rechnungsentwurf kann eine externe Referenz tragen: `externalSource` ist die Plattform (Kleinbuchstaben, Ziffern, `.`, `-`, `_`, etwa `etsy` oder `ebay`), `externalId` die Bestellnummer dort. Beide gibt es nur zusammen, und zusammen sind sie eindeutig.

- **Kein Duplikat:** Schickt ein Workflow dieselbe Bestellung ein zweites Mal, legt Haben nichts an, sondern antwortet mit `200` und der vorhandenen Rechnung, unverändert. Neu angelegt heißt `201`. Das gilt auch, wenn zwei Anfragen gleichzeitig kommen; ein eindeutiger Index in der Datenbank sichert es ab.
- **Rechnung zur Bestellung finden:** `GET /rechnungen?externalSource=etsy&externalId=3141592653`.
- **Die Referenz gehört zum Vorgang:** Sie lässt sich nach dem Anlegen nicht ändern. Wird der Entwurf gelöscht, ist sie wieder frei. Nach dem Festschreiben ist sie Teil der Rechnung, gesperrt und versiegelt wie die übrigen Felder ([Hash-Kette und Siegel](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel)); dieselbe Bestellung liefert dann weiter diese Rechnung. Ein Storno trägt keine Referenz.

## Beispiele

Die Beispiele nehmen an, dass Adresse und Token in Variablen stehen:

```sh
HABEN=https://haben.example.de/api/v1
TOKEN=hb_…
```

Kontakt zu einer E-Mail-Adresse suchen (`q` sucht in Name, E-Mail und Kundennummer):

```sh
curl -s "$HABEN/kontakte?q=anna@example.com" -H "Authorization: Bearer $TOKEN"
```

Kontakt anlegen; nur `name` ist Pflicht, `land` ist ohne Angabe `DE`, die Kundennummer vergibt Haben, wenn unter Einstellungen ein Format steht:

```sh
curl -s -X POST "$HABEN/kontakte" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "Anna Muster", "strasse": "Lindenweg 3", "plz": "10115", "ort": "Berlin", "email": "anna@example.com"}'
```

Rechnungsentwurf zu einer Etsy-Bestellung, zwei Becher zu je 24,00 € netto mit 19 %. Nicht genannte Felder nehmen die Vorgaben aus den Firmendaten (Zahlungsziel, Format, Einleitung, Kleinunternehmer), Format, Sprache und Skonto wie im Rechnungseditor vom Kontakt (sein Standardformat, mit Leitweg-ID XRechnung), das Datum ist heute:

```sh
curl -s -X POST "$HABEN/rechnungen" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "contactId": "8b0c…",
  "externalSource": "etsy",
  "externalId": "3141592653",
  "note": "Danke für deine Bestellung!",
  "lines": [
    { "description": "Keramikbecher handgemacht", "quantity": 2000, "unit": "Stk.", "unitPrice": 2400, "taxRate": 1900 }
  ]
}'
```

Die Antwort enthält Summen, Positionen und `url`, den Link auf den Entwurf in Haben:

```json
{
  "id": "5f3e…",
  "status": "draft",
  "listStatus": "entwurf",
  "number": null,
  "net": 4800,
  "tax": 912,
  "gross": 5712,
  "externalSource": "etsy",
  "externalId": "3141592653",
  "url": "https://haben.example.de/rechnungen/5f3e…",
  "lines": [{ "position": 1, "description": "Keramikbecher handgemacht", "quantity": 2000, "unit": "Stk.", "unitPrice": 2400, "taxRate": 1900, "net": 4800, "detail": "" }]
}
```

Skonto steht in `skonto` als Liste von Stufen, Frist in Tagen ab dem Rechnungsdatum und Satz in Basispunkten: `"skonto": [{ "days": 10, "percent": 200 }]` für 2 % in 10 Tagen, `[]` für keins. Ohne Angabe gilt das Skonto des Kontakts, sonst das aus den Firmendaten, ohne Stufen über das Zahlungsziel hinaus; bei Fremdwährung keins (siehe [Skonto](rechnungen.md#skonto)).

Endpreise inklusive Umsatzsteuer, wie in Shops üblich, gehen mit `"priceMode": "brutto"`; dann ist `unitPrice` der Bruttopreis in Cent. Einheiten sind `Std.`, `Tag`, `Monat`, `Stk.`, `Psch.` und `km`.

Entwurf ändern, nur die genannten Felder; `lines` ersetzt alle Positionen. Ohne `skonto` passt sich das Skonto des Entwurfs an: Stufen über ein neues Zahlungsziel hinaus entfallen, bei Fremdwährung entfällt es ganz. Beispiel:

```sh
curl -s -X PATCH "$HABEN/rechnungen/5f3e…" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"serviceFrom": "2026-11-02", "serviceTo": "2026-11-02"}'
```

Entwurf löschen (antwortet `204`), etwa wenn die Bestellung storniert wurde, bevor du die Rechnung festgeschrieben hast:

```sh
curl -s -X DELETE "$HABEN/rechnungen/5f3e…" -H "Authorization: Bearer $TOKEN"
```

Ist die Rechnung schon festgeschrieben, antworten Ändern und Löschen mit `409`. Korrigiert wird dann in Haben per Storno ([Rechnungen](rechnungen.md)). Ob eine Rechnung bezahlt ist, zeigen `listStatus`, `paid` und `open` aus dem Bankabgleich.

## Ablauf für Bestellungen

Ein Ablauf für Bestellungen sieht typischerweise so aus:

1. Neue Bestellungen von der Plattform holen (Trigger oder Zeitplan).
2. `GET /kontakte?q=<E-Mail>`; ist `total` 0, den Kontakt mit `POST /kontakte` anlegen.
3. `POST /rechnungen` mit `contactId`, `externalSource`, `externalId` und den Positionen. Läuft der Abruf doppelt, kommt `200` mit der vorhandenen Rechnung statt eines Duplikats.
4. In Haben die Entwürfe prüfen und festschreiben, dann wie gewohnt versenden.

## Belege

Ein Dokumentenarchiv, ein Scanner mit eigenem Skript oder ein Werkzeug, das Rechnungen aus einem Postfach oder Kundenportal holt, schickt Eingangsbelege mit `POST /belege` an Haben. Der Beleg geht denselben Weg wie ein Upload unter **Belege**:

- **Formate und Größe** wie beim Upload: PDF, JPEG, PNG, WebP, HEIC und E-Rechnungs-XML (XRechnung, ZUGFeRD), höchstens 20 MB. Haben erkennt das Format am Inhalt, nicht am Dateinamen. Genau eine Datei je Anfrage, im Feld `datei`.
- **Auslesen:** Eine E-Rechnung liest Haben sofort, die Antwort enthält dann schon Lieferant, Nummer, Datum und Beträge. Andere PDFs und Fotos liest die [KI-Auslesung](belege.md#ki-auslesung-mit-claude) im Hintergrund, wenn sie eingerichtet ist; bis dahin steht `extractionStatus` auf `laeuft`.
- **Nichts wird gebucht.** Der Beleg steht unter Belege als „Zu prüfen“ (`status: "neu"`). Kategorie, Zahlungsweg und Buchen bleiben in Haben.
- **Vorbelegen** lässt sich nur eine Notiz (`note`). Lieferant, Nummer, Datum und Beträge nimmt die API bewusst nicht an: Sie kommen aus der E-Rechnung oder der Auslesung, die sie sonst überschriebe, und geprüft werden sie ohnehin in Haben.

Hochladen, mit einer Referenz auf das Dokument im Archiv:

```sh
curl -s -X POST "$HABEN/belege" -H "Authorization: Bearer $TOKEN" \
  -F datei=@rechnung.pdf -F externalSource=archiv -F externalId=4711 -F "note=Aus dem Dokumentenarchiv"
```

Die Antwort ist der Beleg mit `url`, dem Link auf seine Seite in Haben, und `issues`, was vor dem Buchen noch fehlt:

```json
{
  "id": "0c9a…",
  "filename": "rechnung.pdf",
  "status": "neu",
  "booked": false,
  "extractionStatus": "fertig",
  "extractedBy": "zugferd",
  "supplierName": "Hetzner Online GmbH",
  "invoiceNumber": "R0018834512",
  "documentDate": "2026-09-30",
  "gross": 3856,
  "externalSource": "archiv",
  "externalId": "4711",
  "issues": ["Kategorie fehlt"],
  "url": "https://haben.example.de/belege/0c9a…"
}
```

**Kein Beleg doppelt.** `externalSource` (Kleinbuchstaben, Ziffern, `.`, `-`, `_`, etwa `archiv` oder `scanner`) und `externalId` (die Kennung des Dokuments dort) gibt es nur zusammen, und zusammen sind sie eindeutig, auch bei gleichzeitigen Anfragen. Dazu kommt wie beim Upload in Haben die Prüfung über den Inhalt der Datei (SHA-256): Jede Datei gibt es nur einmal.

| Anfrage | Antwort |
| --- | --- |
| Neue Datei, neue oder keine Referenz | `201` mit dem neuen Beleg |
| Referenz gibt es schon (mit derselben oder einer anderen Datei) | `200` mit dem vorhandenen Beleg, unverändert |
| Dieselbe Datei ohne Referenz | `200` mit dem vorhandenen Beleg, wie der Upload in Haben „schon vorhanden“ meldet |
| Dieselbe Datei mit einer anderen Referenz, oder der Beleg wurde ohne Referenz hochgeladen | `409` mit `existingId`; die Referenz bleibt frei |

Das `409` hat einen Grund: Ein Werkzeug merkt sich zu jedem Dokument den Beleg in Haben. Bekäme es für ein zweites Dokument mit derselben Datei den Beleg des ersten, stimmte diese Zuordnung nicht mehr; so sieht es, dass die Datei schon da ist, und unter welchem Beleg.

Stand abfragen, etwa ob ein Beleg schon geprüft und gebucht ist:

```sh
curl -s "$HABEN/belege?externalSource=archiv&externalId=4711" -H "Authorization: Bearer $TOKEN"
curl -s "$HABEN/belege?status=neu" -H "Authorization: Bearer $TOKEN"
curl -s "$HABEN/belege/0c9a…" -H "Authorization: Bearer $TOKEN"
```

`status` ist `neu` („Zu prüfen“) oder `gebucht`, `booked` und `bookedAt` sagen dasselbe als Wahrheitswert und Zeitpunkt. Ein stornierter Beleg bleibt `gebucht`; `cancelledOn` nennt dann den Tag des Stornos (sonst `null`), und in der Einzelansicht zeigt `replacedById` auf seine Neuerfassung, `replacesId` umgekehrt von der Neuerfassung auf den stornierten Beleg ([Stornieren und neu erfassen](belege.md#stornieren-und-neu-erfassen)). Ein gebuchter Beleg ist gesperrt und versiegelt, mit seiner Referenz ([Hash-Kette und Siegel](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel)); dieselbe Referenz liefert dann weiter diesen Beleg. Löschst du einen ungebuchten Beleg in Haben, ist seine Referenz wieder frei. Die Datei selbst gibt die API nicht heraus, und ändern oder löschen lässt sich ein Beleg nur in Haben.

## Sicherheit

- Der Zugang ist standardmäßig aus. Tokens laufen nach 30, 90 oder 365 Tagen ab und lassen sich einzeln widerrufen. Gespeichert ist nur ihr SHA-256-Hash.
- Jedes Token hat nur die Rechte, die du ihm gibst. Keines kann buchen, festschreiben, stornieren, versenden oder etwas an ELSTER schicken, und keines sieht Zertifikat, Passwörter, API-Schlüssel oder Steuer-ID. Ein Token mit `belege:anlegen` kann Belege nur hinzufügen, nicht ändern, löschen oder herunterladen.
- Die API meldet sich nur mit dem Token an, nie mit dem Sitzungscookie. Eine fremde Webseite, die du im selben Browser öffnest, kann sie deshalb nicht in deinem Namen aufrufen.
- Ein Token ist so viel wert wie seine Rechte. Halte es in den Zugangsdaten deines Werkzeugs, nicht im Klartext in Skripten oder Workflows, und erreichst du Haben aus dem Internet, dann nur über HTTPS.

[Zurück zur Übersicht](README.md)
