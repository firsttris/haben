---
title: "REST-API für Kontakte und Rechnungsentwürfe"
description: >-
  Über die REST-API von Haben Kontakte und Rechnungsentwürfe aus eigenen Werkzeugen anlegen, etwa
  Bestellungen aus Shops – mit OpenAPI-Beschreibung.
---

# REST-API

Über die REST-API legen eigene Werkzeuge und Automationen Kontakte und Rechnungsentwürfe in Haben an, etwa eine Automation, die Bestellungen aus Etsy oder eBay holt. Haben bekommt dafür keine eigene Bestellverwaltung: Die Bestellung bleibt auf der Plattform, Haben schreibt die Rechnung dazu. Ebenso liefern eigene Werkzeuge, Dokumentenarchive und Skripte Eingangsbelege an Haben, die dort unter **Belege** als „Zu prüfen“ landen.

Die Oberfläche einer solchen Automation kannst du als [eigene Seite](eigene-seiten.md) ins Menü von Haben hängen.

Die API **bucht nichts, schreibt nichts fest und versendet nichts**. Ein Entwurf aus der API ist ein Entwurf wie jeder andere: Du prüfst ihn in Haben und schreibst ihn dort mit einem Klick fest. Das bleibt wegen GoBD so, denn erst mit dem Festschreiben bekommt die Rechnung ihre Nummer, ihr PDF und ihre Buchung. Genauso wird ein Beleg aus der API erst gebucht, wenn du ihn in Haben geprüft hast.

| Bereich | Was die API kann |
| --- | --- |
| Kontakte | auflisten und suchen, lesen, anlegen, ändern (nicht löschen: Kontakte sind versioniert) |
| Rechnungen | alle lesen, auch festgeschriebene; Entwürfe anlegen, ändern und löschen, solange sie Entwurf sind |
| Belege | hochladen (landen als „Zu prüfen“), auflisten und lesen, ob sie schon geprüft und gebucht sind; nicht ändern oder löschen |
| Leistungen | Zeiteinträge je Kunde auflisten, lesen, anlegen (mit Kennung wiederholbar) und löschen, etwa aus Kimai |

Die vollständige Beschreibung als OpenAPI 3.1 liefert Haben selbst unter `https://<deine Adresse>/api/v1/openapi.json`, ohne Token. Werkzeuge wie Swagger UI, Bruno oder Postman lesen sie ein.

## Einrichten

1. **Einstellungen → KI-Assistenten und API** öffnen und **Zugang für KI-Assistenten und API einschalten**.
2. Unter **API-Tokens** einen Namen vergeben (z. B. „Shop-Automation“), die Gültigkeit wählen und unter **Rechte** nur ankreuzen, was das Werkzeug braucht. Für Bestellungen sind das meist „Kontakte lesen, anlegen und ändern“ und „Rechnungen lesen, Entwürfe anlegen, ändern und löschen“; den Haken bei „KI-Assistent (MCP)“ nimmst du dann heraus.
3. **Token anlegen** und das Token sofort kopieren: Haben speichert nur seinen SHA-256-Hash und zeigt es nie wieder an.

Es sind dieselben Tokens wie für die [KI-Assistenten](ki-assistenten.md); was ein Token darf, sagen allein seine Rechte. Anlegen und widerrufen kann sie nur der Inhaber, nicht der [Zugang der Steuerberatung](steuerberatung.md). Jedes Werkzeug sollte sein eigenes Token bekommen. **Widerrufen** sperrt es sofort, den Zugang ausschalten sperrt alle auf einmal.

| Recht | Erlaubt |
| --- | --- |
| `kontakte:lesen` | `GET /kontakte`, `GET /kontakte/{id}` |
| `kontakte:schreiben` | dazu `POST /kontakte`, `PATCH /kontakte/{id}` |
| `rechnungen:lesen` | `GET /rechnungen`, `GET /rechnungen/{id}` |
| `rechnungen:entwuerfe` | dazu `POST /rechnungen`, `PATCH /rechnungen/{id}`, `DELETE /rechnungen/{id}` |
| `belege:lesen` | `GET /belege`, `GET /belege/{id}` |
| `belege:anlegen` | dazu `POST /belege` |
| `leistungen:lesen` | `GET /leistungen`, `GET /leistungen/{id}` |
| `leistungen:schreiben` | dazu `POST /leistungen`, `DELETE /leistungen/{id}` |
| `haben:lesen` | nur die Werkzeuge über [MCP](ki-assistenten.md), nicht die REST-API |

Schreiben und anlegen schließen lesen ein. Ein Token ohne das nötige Recht bekommt `403`.

## Grundlagen

- **Adresse:** `https://<deine Adresse>/api/v1`. Die Version steht im Pfad. Innerhalb von `v1` kommen höchstens Felder und Endpunkte dazu; ein Client sollte unbekannte Felder in Antworten deshalb übergehen. Was nicht mehr dazu passt, kommt als `v2`.
- **Anmeldung:** Header `Authorization: Bearer hb_…`. Die Sitzung aus dem Browser reicht der API nicht, das Cookie zählt dort nicht.
- **Format:** JSON mit `Content-Type: application/json`, höchstens 1 MB je Anfrage. Nur das Hochladen von Belegen nimmt `multipart/form-data`, mit der Grenze des Uploads unter Belege (20 MB je Datei).
- **Einheiten wie überall in Haben:** Beträge in ganzen Cent (`5712` = 57,12 €), Steuersätze in Basispunkten (`1900` = 19 %, `700` = 7 %, `0`), Mengen in Tausendsteln (`1000` = 1 Stück, `1500` = 1,5 Stunden), Datum als `JJJJ-MM-TT`. Bei Fremdwährung sind `net`, `tax` und `gross` in Euro umgerechnet, die Einzelpreise stehen in der Währung der Rechnung.
- **Listen** haben `limit` (1 bis 500, Vorgabe 100) und `offset` und antworten mit `{ "data": […], "total": …, "limit": …, "offset": … }`.
- **Grenze:** 120 Anfragen je Minute und Token, darüber `429` mit `Retry-After: 60`. Werkzeuge über MCP und die API zählen zusammen.
- **Protokoll:** Jeder Aufruf steht ohne Inhalte unter **Letzte Aufrufe** (z. B. `POST /rechnungen`), 90 Tage lang. Was die API anlegt oder ändert, steht im Änderungsprotokoll mit dem Token als Akteur: seiner ID und seinem Namen (`api:5b1d0c4e-…:Shop-Automation`). Über die ID bleiben zwei Tokens mit gleichem Namen unterscheidbar, etwa nach Widerruf und Neuanlage; ältere Einträge tragen nur den Namen (`api:Shop-Automation`).

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

## Bestell-, Auftrags- und Lieferscheinnummer

Ein Rechnungsentwurf nimmt `buyerOrderReference` (Bestellnummer des Kunden, BT-13), `sellerOrderReference` (eigene Auftragsnummer, BT-14) und `despatchAdviceReference` (Lieferscheinnummer, BT-16) an, je bis 100 Zeichen, leer = keine. Sie stehen im PDF und in der E-Rechnung an ihrem eigenen Feld ([Rechnungen](rechnungen.md#bestellnummer-auftrag-und-lieferschein)). `PATCH` ohne diese Felder behält sie. Die externe Referenz (unten) bleibt davon getrennt; soll die Bestellnummer der Plattform auf der Rechnung stehen, schick sie zusätzlich als `sellerOrderReference` oder `buyerOrderReference`.

`propertyRetention: true` ergänzt den festen [Aufbewahrungshinweis für private Grundstücksleistungen](rechnungen.md#aufbewahrungshinweis-bei-grundstücksleistungen) im PDF und in BT-22 der E-Rechnung. Beim Anlegen ist die Vorgabe `false`; ein `PATCH` ohne Feld behält die Auswahl, `false` schaltet sie aus. Die Antwort liefert den gespeicherten Wahrheitswert. Festgeschriebene Rechnungen bleiben unveränderlich.

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

Je Position nimmt die API optional `detail` (Text unter der Bezeichnung, BT-154) und `itemNumber` (Artikelnummer, BT-155, bis 50 Zeichen) an.

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
  "lines": [{ "position": 1, "description": "Keramikbecher handgemacht", "quantity": 2000, "unit": "Stk.", "unitPrice": 2400, "taxRate": 1900, "net": 4800, "detail": "", "itemNumber": "" }]
}
```

Skonto steht in `skonto` als Liste von Stufen, Frist in Tagen ab dem Rechnungsdatum und Satz in Basispunkten: `"skonto": [{ "days": 10, "percent": 200 }]` für 2 % in 10 Tagen, `[]` für keins. Ohne Angabe gilt das Skonto des Kontakts, sonst das aus den Firmendaten, ohne Stufen über das Zahlungsziel hinaus; bei Fremdwährung keins (siehe [Skonto](rechnungen-zahlung.md#skonto)).

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

1. Neue Bestellungen von der Plattform holen (Trigger oder Zeitplan).
2. `GET /kontakte?q=<E-Mail>`; ist `total` 0, den Kontakt mit `POST /kontakte` anlegen.
3. `POST /rechnungen` mit `contactId`, `externalSource`, `externalId` und den Positionen. Läuft der Abruf doppelt, kommt `200` mit der vorhandenen Rechnung statt eines Duplikats.
4. In Haben die Entwürfe prüfen und festschreiben, dann wie gewohnt versenden.

## Leistungen und Zeiterfassung

Ein Zeiterfassungsprogramm wie Kimai oder Toggl schickt seine Zeiteinträge mit `POST /leistungen` an Haben; sie stehen dort unter [Leistungen](leistungen.md). Der Eintrag gehört einem Kunden (`contactId`), hat einen Arbeitstag (`workedOn`), eine Dauer in ganzen Minuten (`minutes`, 1 bis 1440) und optional `description`, `hourlyRateCents`, `project` (freier Text), `billableMinutes` (abrechenbare Dauer, wenn sie von der erfassten abweicht) und `nonBillable` (`true`: erfasst, kommt aber nie in einen Rechnungsentwurf). Der Kontakt muss ein Kunde und darf nicht archiviert sein, sonst `422`. Ohne Stundensatz nimmt Haben den des Kunden; er bleibt als Kopie am Eintrag. Den Satz am Kunden setzt `PATCH /kontakte/{id}` mit `hourlyRateCents`.

Mit `source` und `externalId` ist der Aufruf wiederholbar: Die Kennung der Zeile in der Quelle steht in `externalId`, der Name der Quelle in `source`. Gibt es die Kennung schon, antwortet Haben mit `200` und dem aktualisierten Eintrag, sonst mit `201`. Fehlen Stundensatz, `project`, `billableMinutes` oder `nonBillable` im Aufruf, behält ein vorhandener Eintrag seine Werte; `billableMinutes: null` nimmt eine abrechenbare Dauer zurück. Den Stundensatz des Kunden liefert `GET /kontakte/{id}` als `hourlyRateCents`.

```sh
curl -X POST "$HABEN/leistungen" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"contactId":"<Kunden-ID>","workedOn":"2026-03-02","minutes":90,"description":"Konzept Datenmodell","source":"kimai","externalId":"4711"}'
```

Gelöscht wird mit `DELETE /leistungen/{id}`, gelesen mit `GET /leistungen/{id}`; `GET /leistungen` mit `contactId`, `from`, `to` und `status` (`offen`, `abgerechnet`, `nicht-abrechenbar`) listet. Jeder Eintrag trägt `invoiceId`, `invoiceNumber` und `invoiceStatus` (`draft` oder `final`) der Rechnung, auf der er steht; `null` heißt offen, auch nach dem Storno der Rechnung. Ein Eintrag auf einer Rechnung lässt sich nicht löschen (`422`), und ein erneutes `POST` mit seiner Kennung ändert ihn nicht. Abgerechnet wird in Haben unter [Leistungen](leistungen.md#abrechnen).

### Zeitbuchungen aus Kimai holen

Kimai hat eine eigene [REST-API](https://www.kimai.org/documentation/rest-api.html): Anmeldung mit `Authorization: Bearer <Kimai-Token>` (das Token aus dem Profil in Kimai, nicht das Passwort), Basis `https://<deine Kimai-Adresse>/api`, die vollständige Beschreibung unter `/api/doc` der eigenen Installation. Die Zeitbuchungen holt `GET /api/timesheets`; laut Quelltext von Kimai nimmt die Liste unter anderem `begin` und `end` (lokale Zeit, `JJJJ-MM-TTThh:mm:ss`), `customer`, `project`, `exported` (0 oder 1), `billable` (0 oder 1), `active` (0 = beendet), `modified_after` (UTC), `size` (höchstens 500) und `page`; `full=1` liefert Kunde und Projekt mit Namen statt nur mit ID.

Ein Skript ruft regelmäßig die beendeten, noch nicht exportierten Zeitbuchungen ab und schickt jede an Haben:

| Kimai | Haben (`POST /api/v1/leistungen`) |
| --- | --- |
| `id` der Zeitbuchung | `externalId`, dazu `source`: `kimai` |
| Kunde der Zeitbuchung | `contactId`: der Kontakt in Haben, den das Skript über `GET /kontakte?q=<Name oder Kundennummer>` findet |
| Datum von `begin` | `workedOn` |
| `duration` (Sekunden) | `minutes`: auf ganze Minuten gerundet, mindestens 1 |
| `description` | `description` |
| Projekt (mit `full=1` der Name) | `project` |
| `billable` ist `false` | `nonBillable`: `true` |

`hourlyRateCents` lässt das Skript weg: Dann gilt der Satz des Kunden in Haben. Weil die Kennung der Zeitbuchung `externalId` ist, ändert ein erneuter Abruf, etwa nach `modified_after`, vorhandene Einträge statt neue anzulegen. Wer eine Zeitbuchung in Kimai nachträglich ändert, schickt sie noch einmal.

Kimai merkt sich, was schon abgerechnet ist, mit dem Kennzeichen `exported` (`PATCH /api/timesheets/{id}/export` schaltet es um). Setzen soll es der Abgleich, sobald Haben die Einträge zu einer Rechnung gemacht hat; das kommt mit dem Abrechnen, einem späteren Teil von [#417](https://github.com/firsttris/haben/issues/417).

> [!NOTE]
> Diese Zuordnung folgt der Kimai-Dokumentation und dem Quelltext von Kimai. Sie ist noch nicht gegen eine laufende Kimai-Installation ausprobiert; welche Felder die Antwort genau enthält, zeigt `/api/doc` der eigenen Installation.

## Belege

Ein Dokumentenarchiv, ein Scanner mit eigenem Skript oder ein Werkzeug, das Rechnungen aus einem Postfach oder Kundenportal holt, schickt Eingangsbelege mit `POST /belege` an Haben. Der Beleg geht denselben Weg wie ein Upload unter **Belege**:

- **Formate und Größe** wie beim Upload: PDF, JPEG, PNG, WebP, HEIC und E-Rechnungs-XML (XRechnung, ZUGFeRD), höchstens 20 MB. Haben erkennt das Format am Inhalt, nicht am Dateinamen. Genau eine Datei je Anfrage, im Feld `datei` oder `file` (für Werkzeuge mit festem Feldnamen wie [Paperless-ngx](#paperless-ngx)); beide zugleich lehnt die API mit `400` ab.
- **Auslesen:** Eine E-Rechnung liest Haben sofort, die Antwort enthält dann schon Lieferant, Nummer, Datum und Beträge. Andere PDFs und Fotos liest die [KI-Auslesung](belege.md#ki-auslesung) im Hintergrund, wenn sie eingerichtet ist; bis dahin steht `extractionStatus` auf `laeuft`.
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

`status` ist `neu` („Zu prüfen“) oder `gebucht`, `booked` und `bookedAt` sagen dasselbe als Wahrheitswert und Zeitpunkt. Ein stornierter Beleg bleibt `gebucht`; `cancelledOn` nennt dann das Datum der Gegenbuchung (sonst `null`; siehe [Stornieren](belege.md#stornieren-und-neu-erfassen)), und in der Einzelansicht zeigt `replacedById` auf seine Neuerfassung, `replacesId` umgekehrt von der Neuerfassung auf den stornierten Beleg ([Stornieren und neu erfassen](belege.md#stornieren-und-neu-erfassen)). Ein gebuchter Beleg ist gesperrt und versiegelt, mit seiner Referenz ([Hash-Kette und Siegel](buchhaltung.md#manipulationserkennung-hash-kette-und-siegel)); dieselbe Referenz liefert dann weiter diesen Beleg. Löschst du einen ungebuchten Beleg in Haben, ist seine Referenz wieder frei. Die Datei selbst gibt die API nicht heraus, und ändern oder löschen lässt sich ein Beleg nur in Haben.

### Paperless-ngx

Paperless-ngx schickt neue Dokumente mit einem Workflow ohne eigenen Code an Haben. Die Workflow-Aktion „Webhook“ hängt die Datei fest im Feld `file` an (`execute_webhook_action` in `src/documents/workflows/actions.py` von Paperless-ngx); Haben nimmt sie dort wie im Feld `datei` an.

- **Auslöser:** „Dokument hinzugefügt“, gefiltert etwa auf einen Tag oder Dokumenttyp wie „Eingangsrechnung“.
- **Aktion „Webhook“:** URL `https://<haben>/api/v1/belege`, Header `Authorization: Bearer <Token>` (Token mit `belege:anlegen`), Parameter statt JSON-Body, „Dokument anhängen“ an.
- **Parameter:** `externalSource` = `paperless`, `externalId` = `{{ doc_id }}`, `note` = `Paperless: {{ doc_title }} ({{ correspondent }}) {{ doc_url }}`. Die Platzhalter rendert Paperless mit Jinja, also in doppelten geschweiften Klammern.

Über `externalSource` und `externalId` legt ein doppelt ausgelöster Workflow nichts doppelt an (siehe oben). Die Platzhalter im Header ersetzt Paperless nicht; das Token steht dort im Klartext, also nur ein Token mit `belege:anlegen`.

## Sicherheit

- Der Zugang ist standardmäßig aus. Tokens laufen nach 30, 90 oder 365 Tagen ab und lassen sich einzeln widerrufen. Gespeichert ist nur ihr SHA-256-Hash.
- Jedes Token hat nur die Rechte, die du ihm gibst. Keines kann buchen, festschreiben, stornieren, versenden oder etwas an ELSTER schicken, und keines sieht Zertifikat, Passwörter, API-Schlüssel oder Steuer-ID. Ein Token mit `belege:anlegen` kann Belege nur hinzufügen, nicht ändern, löschen oder herunterladen.
- Die API meldet sich nur mit dem Token an, nie mit dem Sitzungscookie. Eine fremde Webseite, die du im selben Browser öffnest, kann sie deshalb nicht in deinem Namen aufrufen.
- Ein Token ist so viel wert wie seine Rechte. Halte es in den Zugangsdaten deines Werkzeugs, nicht im Klartext in Skripten oder Workflows, und erreichst du Haben aus dem Internet, dann nur über HTTPS.
- Im SSO-Modus hat jedes Token einen verantwortlichen Inhaber; verliert er die Inhaberrolle, deaktiviert Haben seine Tokens, siehe [Tokens nach Gruppenentzug](installation-sso.md#tokens-nach-gruppenentzug).

[Zurück zur Übersicht](ueberblick.md)
