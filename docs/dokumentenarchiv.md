---
title: "Rechnungen im Dokumentenarchiv ablegen"
description: >-
  Festgeschriebene Rechnungen schickt Haben als Kopie an ein Dokumentenarchiv wie Paperless-ngx oder Belegt;
  Belege aus dem Archiv kommen über die REST-API.
---

# Dokumentenarchiv

Wer alle Geschäftsunterlagen in einem Dokumentenarchiv sammelt, bekommt die eigenen Ausgangsrechnungen dort ohne Handgriff hinein: Haben schickt jede festgeschriebene Rechnung, Stornorechnung und Rechnungskorrektur einmal als Kopie an eine Adresse. Das Original bleibt in Haben, versiegelt und mit seinem SHA-256 ([Was beim Festschreiben passiert](rechnungen.md#was-beim-festschreiben-passiert)); das Archiv hat eine zweite Kopie.

Den umgekehrten Weg, Eingangsrechnungen aus dem Archiv nach Haben, geht das Archiv über die [REST-API](api.md#belege). Für jedes Archiv gilt dasselbe, keines bekommt eine eigene Anbindung ([Bewusst nicht](roadmap.md#bewusst-nicht)).

## Einrichten

Unter **Einstellungen › Export › Ablage im Dokumentenarchiv**:

| Feld | Bedeutung |
| --- | --- |
| Adresse | Die Adresse, an die das Archiv neue Dokumente annimmt, mit `https://` (oder `http://` im eigenen Netz) |
| Feld für die Datei | Name des Formularfelds mit der Datei, wie ihn das Archiv erwartet |
| Kopfzeile, Wert der Kopfzeile | Die Anmeldung, meist `Authorization` mit einem Token. Leer gelassen bleibt der gespeicherte Wert ([Sicherheit](#sicherheit)) |
| Zusatzfelder | Feste Felder, die mitgehen, etwa ein Titel. Im Wert ersetzt Haben `{nummer}`, `{art}` (Rechnung, Stornorechnung, …), `{datum}` (Rechnungsdatum als JJJJ-MM-TT), `{kunde}` und `{dateiname}` |
| Datei | **E-Rechnung im Original**: das ZUGFeRD-PDF bzw. bei XRechnung das XML. **Immer das PDF**: für Archive, die kein XML annehmen |
| Link zum Dokument | Optional. Antwortet das Archiv mit JSON und einer `id`, setzt Haben sie für `{id}` ein und zeigt an der Rechnung **Im Archiv öffnen** |

Übertragen wird, was ab dem Einschalten festgeschrieben wird, nicht der Bestand davor. Eine neue Adresse beginnt ebenso neu. Rechnungen, die ein Umzug aus einem anderen Programm übernommen hat, liegen schon dort und gehen nicht mit.

### Paperless-ngx

| Feld | Wert |
| --- | --- |
| Adresse | `https://paperless.example/api/documents/post_document/` (mit dem Schrägstrich am Ende, sonst leitet Paperless weiter) |
| Feld für die Datei | `document` |
| Kopfzeile | `Authorization`, Wert `Token <Token>` (das API-Token aus dem Profil des Kontos in Paperless; das Konto braucht das Recht, Dokumente hinzuzufügen) |
| Zusatzfelder | `title` = `{art} {nummer} · {kunde}` |
| Datei | Immer das PDF: Paperless-ngx nimmt kein XML an |
| Link zum Dokument | leer lassen |

Paperless verarbeitet ein Dokument erst nach der Annahme und antwortet nur mit der Kennung dieser Aufgabe (`PostDocumentView` in `src/documents/views.py`). Haben zeigt deshalb „Übertragen“ ohne Link; ob Paperless das Dokument danach angelegt hat, steht in dessen Liste der Aufgaben.

### Belegt

| Feld | Wert |
| --- | --- |
| Adresse | `https://belegt.example/api/dokumente` |
| Feld für die Datei | `datei` |
| Kopfzeile | `Authorization`, Wert `Bearer belegt_…`; ein Token mit dem Recht „schreiben“ unter **Quellen und Schnittstellen** in Belegt |
| Datei | E-Rechnung im Original |
| Link zum Dokument | `https://belegt.example/dokumente/{id}` |

Belegt antwortet mit dem neuen Dokument samt `id`, an der Rechnung steht dann der Link.

## Wann und wie oft

Haben überträgt gleich nach dem Festschreiben oder Stornieren im Hintergrund und danach stündlich, was noch fehlt, auch wiederkehrende Rechnungen. Erfolg ist jede Antwort mit einem Status 2xx; danach geht die Rechnung nicht noch einmal an dieselbe Adresse. Schlägt es fehl, versucht Haben es stündlich erneut, höchstens 24-mal; **Jetzt übertragen** versucht es sofort, auch darüber hinaus, und **Speichern** setzt die Zählung zurück, etwa nach einem neuen Token.

An der Rechnung steht unter **Archiv**, ob sie übertragen ist, mit Zeitpunkt, HTTP-Status und gegebenenfalls Link, oder warum es fehlschlug, mit dem HTTP-Status und dem Anfang der Antwort. Die letzten Fehlschläge stehen auch in den Einstellungen.

## Sicherheit

- Die Kopfzeile geht nur an die eingestellte Adresse. Einer Weiterleitung folgt Haben nicht, sie zählt als Fehler.
- Ein Token gehört in die Kopfzeile, nicht in die Adresse: Die Adresse steht im Klartext im Änderungsprotokoll.
- Der Wert der Kopfzeile liegt verschlüsselt in der Datenbank und erscheint weder in der Oberfläche noch im Änderungsprotokoll noch in der [Verfahrensdokumentation](verfahrensdokumentation.md); diese nennt nur den Server des Archivs.
- Geht nach der Übertragung die Antwort verloren, etwa durch einen Abbruch der Verbindung, wiederholt Haben die Übertragung, und das Archiv kann die Rechnung zweimal haben.

[Zurück zur Übersicht](ueberblick.md)
