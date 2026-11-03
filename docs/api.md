# REST-API

Über die REST-API legen eigene Werkzeuge und Automationen Kontakte und Rechnungsentwürfe in Haben an, etwa ein [n8n](https://n8n.io)-Workflow, der Bestellungen aus Etsy oder eBay holt. Haben bekommt dafür keine eigene Bestellverwaltung: Die Bestellung bleibt auf der Plattform, Haben schreibt die Rechnung dazu.

Die API **bucht nichts, schreibt nichts fest und versendet nichts**. Ein Entwurf aus der API ist ein Entwurf wie jeder andere: Du prüfst ihn in Haben und schreibst ihn dort mit einem Klick fest. Das bleibt wegen GoBD so, denn erst mit dem Festschreiben bekommt die Rechnung ihre Nummer, ihr PDF und ihre Buchung.

| Bereich | Was die API kann |
| --- | --- |
| Kontakte | auflisten und suchen, lesen, anlegen, ändern (nicht löschen: Kontakte sind versioniert) |
| Rechnungen | alle lesen, auch festgeschriebene; Entwürfe anlegen, ändern und löschen, solange sie Entwurf sind |

Die vollständige Beschreibung als OpenAPI 3.1 liefert Haben selbst unter `https://<deine Adresse>/api/v1/openapi.json`, ohne Token. Werkzeuge wie Swagger UI, Bruno oder Postman lesen sie ein.

## Einrichten

1. **Einstellungen → KI-Assistenten und API** öffnen und **Zugang für KI-Assistenten und API einschalten**.
2. Unter **API-Tokens** einen Namen vergeben (z. B. „n8n Etsy“), die Gültigkeit wählen und unter **Rechte** nur ankreuzen, was das Werkzeug braucht. Für Bestellungen sind das meist „Kontakte lesen, anlegen und ändern“ und „Rechnungen lesen, Entwürfe anlegen, ändern und löschen“; den Haken bei „KI-Assistent (MCP)“ nimmst du dann heraus.
3. **Token anlegen** und das Token sofort kopieren: Haben speichert nur seinen SHA-256-Hash und zeigt es nie wieder an.

Es sind dieselben Tokens wie für die [KI-Assistenten](ki-assistenten.md); was ein Token darf, sagen allein seine Rechte. Jedes Werkzeug sollte sein eigenes Token bekommen. **Widerrufen** sperrt es sofort, den Zugang ausschalten sperrt alle auf einmal.

| Recht | Erlaubt |
| --- | --- |
| `kontakte:lesen` | `GET /kontakte`, `GET /kontakte/{id}` |
| `kontakte:schreiben` | dazu `POST /kontakte`, `PATCH /kontakte/{id}` |
| `rechnungen:lesen` | `GET /rechnungen`, `GET /rechnungen/{id}` |
| `rechnungen:entwuerfe` | dazu `POST /rechnungen`, `PATCH /rechnungen/{id}`, `DELETE /rechnungen/{id}` |
| `haben:lesen` | nur die Werkzeuge über [MCP](ki-assistenten.md), nicht die REST-API |

Schreiben schließt lesen ein. Ein Token ohne das nötige Recht bekommt `403`.

## Grundlagen

- **Adresse:** `https://<deine Adresse>/api/v1`. Die Version steht im Pfad. Innerhalb von `v1` kommen höchstens Felder und Endpunkte dazu; ein Client sollte unbekannte Felder in Antworten deshalb übergehen. Was nicht mehr dazu passt, kommt als `v2`.
- **Anmeldung:** Header `Authorization: Bearer hb_…`. Die Sitzung aus dem Browser reicht der API nicht, das Cookie zählt dort nicht.
- **Format:** JSON mit `Content-Type: application/json`, höchstens 1 MB je Anfrage.
- **Einheiten wie überall in Haben:** Beträge in ganzen Cent (`5712` = 57,12 €), Steuersätze in Basispunkten (`1900` = 19 %, `700` = 7 %, `0`), Mengen in Tausendsteln (`1000` = 1 Stück, `1500` = 1,5 Stunden), Datum als `JJJJ-MM-TT`. Bei Fremdwährung sind `net`, `tax` und `gross` in Euro umgerechnet, die Einzelpreise stehen in der Währung der Rechnung.
- **Listen** haben `limit` (1 bis 500, Vorgabe 100) und `offset` und antworten mit `{ "data": […], "total": …, "limit": …, "offset": … }`.
- **Grenze:** 120 Anfragen je Minute und Token, darüber `429` mit `Retry-After: 60`. Werkzeuge über MCP und die API zählen zusammen.
- **Protokoll:** Jeder Aufruf steht ohne Inhalte unter **Letzte Aufrufe** (z. B. `POST /rechnungen`), 90 Tage lang. Was die API anlegt oder ändert, steht im Änderungsprotokoll mit dem Namen des Tokens als Akteur (`api:n8n Etsy`).

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
| 400 | `validation_failed`, `invalid_json` | Eingabe ungültig, unbekanntes Feld oder kein JSON |
| 401 | `unauthorized` | Kein, ein falsches, abgelaufenes oder widerrufenes Token, oder der Zugang ist ausgeschaltet |
| 403 | `forbidden` | Dem Token fehlt das Recht; die Meldung nennt es |
| 404 | `not_found` | Unbekannter Pfad oder Datensatz |
| 405 | `method_not_allowed` | Methode gibt es hier nicht; `Allow` nennt die erlaubten |
| 409 | `conflict` | Die Rechnung ist festgeschrieben, oder ein Entwurf, den nur Haben selbst bearbeitet (Storno, Korrektur, Abschlag, Schlussrechnung, aus einem Angebot) |
| 413, 415 | `payload_too_large`, `unsupported_media_type` | Body größer als 1 MB oder nicht als JSON |
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

Rechnungsentwurf zu einer Etsy-Bestellung, zwei Becher zu je 24,00 € netto mit 19 %. Nicht genannte Felder nehmen die Vorgaben aus den Firmendaten (Zahlungsziel, Format, Kleinunternehmer), das Datum ist heute:

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

Endpreise inklusive Umsatzsteuer, wie in Shops üblich, gehen mit `"priceMode": "brutto"`; dann ist `unitPrice` der Bruttopreis in Cent. Einheiten sind `Std.`, `Tag`, `Monat`, `Stk.`, `Psch.` und `km`.

Entwurf ändern, nur die genannten Felder; `lines` ersetzt alle Positionen:

```sh
curl -s -X PATCH "$HABEN/rechnungen/5f3e…" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"serviceFrom": "2026-11-02", "serviceTo": "2026-11-02"}'
```

Entwurf löschen (antwortet `204`), etwa wenn die Bestellung storniert wurde, bevor du die Rechnung festgeschrieben hast:

```sh
curl -s -X DELETE "$HABEN/rechnungen/5f3e…" -H "Authorization: Bearer $TOKEN"
```

Ist die Rechnung schon festgeschrieben, antworten Ändern und Löschen mit `409`. Korrigiert wird dann in Haben per Storno ([Rechnungen](rechnungen.md)). Ob eine Rechnung bezahlt ist, zeigen `listStatus`, `paid` und `open` aus dem Bankabgleich.

## n8n

Im Node **HTTP Request** von n8n:

1. **Authentication:** „Generic Credential Type“ → „Header Auth“ mit Name `Authorization` und Wert `Bearer hb_…`. So steht das Token in den Zugangsdaten von n8n und nicht im Workflow.
2. **Method** und **URL** wie oben, etwa `POST` und `https://haben.example.de/api/v1/rechnungen`.
3. **Send Body** einschalten, **Body Content Type** „JSON“ und die Felder aus der Bestellung eintragen, z. B. `"externalId": "{{ $json.receipt_id }}"`. Beträge rechnest du dort in Cent um, etwa `{{ Math.round($json.price * 100) }}`.

Die curl-Beispiele dieser Seite lassen sich auch mit **Import cURL** im Node übernehmen.

Ein Ablauf für Bestellungen sieht typischerweise so aus:

1. Neue Bestellungen von der Plattform holen (Trigger oder Zeitplan).
2. `GET /kontakte?q=<E-Mail>`; ist `total` 0, den Kontakt mit `POST /kontakte` anlegen.
3. `POST /rechnungen` mit `contactId`, `externalSource`, `externalId` und den Positionen. Läuft der Workflow doppelt, kommt `200` mit der vorhandenen Rechnung statt eines Duplikats.
4. In Haben die Entwürfe prüfen und festschreiben, dann wie gewohnt versenden.

## Sicherheit

- Der Zugang ist standardmäßig aus. Tokens laufen nach 30, 90 oder 365 Tagen ab und lassen sich einzeln widerrufen. Gespeichert ist nur ihr SHA-256-Hash.
- Jedes Token hat nur die Rechte, die du ihm gibst. Keines kann buchen, festschreiben, stornieren, versenden oder etwas an ELSTER schicken, und keines sieht Zertifikat, Passwörter, API-Schlüssel oder Steuer-ID.
- Die API meldet sich nur mit dem Token an, nie mit dem Sitzungscookie. Eine fremde Webseite, die du im selben Browser öffnest, kann sie deshalb nicht in deinem Namen aufrufen.
- Ein Token im Workflow ist so viel wert wie seine Rechte. Halte es in den Zugangsdaten von n8n, nicht im Klartext im Workflow, und erreichst du Haben aus dem Internet, dann nur über HTTPS.

[Zurück zur Übersicht](README.md)
