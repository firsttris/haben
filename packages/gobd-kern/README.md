# @firsttris/gobd-kern

Bausteine für unveränderbare Aufbewahrung nach GoBD, aus [Haben](https://github.com/firsttris/haben) herausgelöst, damit auch andere Apps wie [Belegt](https://github.com/firsttris/belegt) sie nutzen. Das Paket kennt keine App.

| Modul | Aufgabe |
| --- | --- |
| `@firsttris/gobd-kern/dateispeicher` | Dateien unter ihrem SHA-256 (`<verzeichnis>/ab/abcdef…`), atomar geschrieben, beim Lesen gegen den Hash geprüft; `pruefen` liest gestreamt und meldet „ok“, „fehlt“ oder „beschädigt“, `pruefenAlle` prüft einen ganzen Bestand nacheinander und zählt die Befunde |
| `@firsttris/gobd-kern/dateityp` | Dateityp am Inhalt erkennen (PDF, JPEG, PNG, WebP, HEIC, XML) |
| `@firsttris/gobd-kern/pruefwert` | Prüfwert der Hash-Kette schreiben und lesen („Nr. 1234 · <SHA-256>“) |
| `@firsttris/gobd-kern/beschreibung` | `index.xml` nach dem Beschreibungsstandard der Finanzverwaltung (Datenträgerüberlassung, § 147 Abs. 6 AO) |
| `@firsttris/gobd-kern/verfahrensdoku` | Bausteine der Verfahrensdokumentation (GoBD Rz. 151 bis 155): Datenmodell mit Lücken, Schema der Angaben zum Betrieb, Texte zu dem, was dieses Paket leistet, und Markdown |
| `@firsttris/gobd-kern/sql` | SQL-Vorlage für Audit-Log als Hash-Kette, Siegel, Sperren gegen Ändern, Löschen und `TRUNCATE` und die Prüfung in Postgres |

```ts
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";

const speicher = dateispeicher({ verzeichnis: () => process.env.DOCUMENTS_DIR ?? "data", bezeichnung: "Belegdatei" });
const hash = await speicher.speichern(bytes);
const original = await speicher.laden(hash); // wirft, wenn die Datei verändert wurde
const { befundAnzahl, befunde } = await speicher.pruefenAlle(alleHashes, { maxBefunde: 100 });
```

## SQL-Vorlage

Ein neues Projekt übernimmt die Vorlage einmal in seine erste Migration (`drizzle-kit generate --custom`); danach gehört das SQL dem Projekt, eine Änderung wird eine neue Migration. Die Unveränderbarkeit hängt so an Triggern in Postgres und greift auch bei Fehlern im Code und bei SQL von Hand.

```ts
import { vorlageSql } from "@firsttris/gobd-kern/sql";

const sql = vorlageSql({ praefix: "belegt" }); // Anweisungen, getrennt mit „--> statement-breakpoint“
```

Danach meldet die Migration ihre Tabellen an:

| Aufruf | Wirkung |
| --- | --- |
| `SELECT belegt_audit_table('notizen', 'ciphertext')` | jede Änderung ins Audit-Log (ohne die genannten Spalten), `TRUNCATE` gesperrt |
| `SELECT belegt_seal_table('belege', 'locked_at')` | Entwurf änderbar; ab dem Setzen von `locked_at` gesperrt und versiegelt |
| `SELECT belegt_seal_table('eingaenge')` | jede Zeile ab dem Einfügen gesperrt und versiegelt |

Eine Transaktion setzt ihren Akteur mit `select set_config('belegt.actor', $1, true)` (`akteurEinstellung("belegt")`). Änderungen mit Eintrag im Audit-Log gehen nur unter READ COMMITTED. `belegt_integrity_problems(100)` liefert alle Befunde zu Kette, Kopf und Siegeln. Versiegelte Tabellen brauchen eine Spalte `id` vom Typ `uuid`; ein Siegel gilt einer Zeile, abhängige Zeilen bekommen ihr eigenes. Eine Anmeldung lässt sich nicht zurücknehmen.

Getrennte Rollen (die App darf Trigger nicht abschalten) richtet das Projekt selbst ein, wie Haben unter [Getrennte Datenbankrollen](https://haben.app/installation-konfiguration.html#getrennte-datenbankrollen).

## Verfahrensdokumentation

Jede App erzeugt ihre Verfahrensdokumentation aus dem eigenen Stand; gleich sind Form, Angaben zum Betrieb und der Teil zur Unveränderbarkeit. Das Dokument ist reines JSON (Titel, Stand mit Datum, Programm und Version, Abschnitte mit Absätzen, Liste und Lücken), eine Druckansicht stellt es direkt dar.

```ts
import { abschnitt, alsMarkdown, angabenAbsaetze, angabenZumBetrieb, kernAbschnitt, tagInDeutschland, verfahrensdoku } from "@firsttris/gobd-kern/verfahrensdoku";

const schema = angabenZumBetrieb.pick({ verantwortlich: true, datensicherung: true }); // was die App speichert
const angaben = schema.parse(eingabe);
const betrieb = angabenAbsaetze(angaben, ["verantwortlich", "datensicherung"]); // Absätze und Lücken
const doku = verfahrensdoku({
  titel: "Verfahrensdokumentation",
  stand: { datum: tagInDeutschland(new Date()), programm: "Archiv", version: "1.2.3" },
  abschnitte: [
    abschnitt("1. Allgemeine Beschreibung", { absaetze: ["…", ...betrieb.absaetze], luecken: betrieb.luecken }),
    kernAbschnitt("2. Unveränderbarkeit", { versiegelt: ["Dokumente ab dem Einfügen"], pruefwert, dateien: true, zugriff }),
  ],
});
doku.vollstaendig; // false, solange eine Lücke offen ist
const markdown = alsMarkdown(doku);
```

| Baustein | Inhalt |
| --- | --- |
| `verfahrensdoku`, `abschnitt` | Dokument zusammensetzen, leere Absätze fallen weg, Lücken werden gezählt |
| `ANGABEN_FELDER`, `angabenZumBetrieb` | Firma, Rechtsform, Anschrift, Verantwortliche, Datensicherung, Ort der Aufbewahrung, Papierbelege und Scannen, Betrieb des Servers, Ablage von Schlüsseln, Ergänzungen: Beschriftung, Hinweis, Lücke, Höchstlänge und Quelle je Feld, dazu das Zod-Schema |
| `fehlendeAngaben`, `angabenAbsaetze` | Lücken der leeren Felder; Angaben als Absätze „Beschriftung: Text“ |
| `KERN_TEXTE`, `kernAbschnitt`, `datenbankRollenText` | Texte zu Sperren, Audit-Log, Hash-Kette, Siegel, Prüfung, Prüfwert und Dateispeicher mit Randziffern der GoBD, nur was dieses Paket zusagt; dazu die wirksamen Rechte der Datenbankanmeldung |
| `alsMarkdown`, `markdownText`, `standText` | Ausgabe als CommonMark, Text aus Angaben maskiert |

Geheimnisse gehören nicht in das Dokument; die App gibt nur Namen, Rollen und Zeitpunkte hinein.

## Installieren

Nicht auf npm, sondern als Datei an den Releases `gobd-kern-vX.Y.Z` von Haben (Actions → *GoBD-Kern als Release*):

```sh
bun add https://github.com/firsttris/haben/releases/download/gobd-kern-v0.2.0/firsttris-gobd-kern-0.2.0.tgz
```

Das Paket enthält TypeScript-Quellen, für Bun und Bundler wie Vite. Ab 0.2.0 braucht es `zod` (Version 4) für das Schema der Angaben.
