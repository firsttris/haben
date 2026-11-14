# @firsttris/gobd-kern

Bausteine für unveränderbare Aufbewahrung nach GoBD, aus [Haben](https://github.com/firsttris/haben) herausgelöst, damit auch andere Apps wie [Belegt](https://github.com/firsttris/belegt) sie nutzen. Das Paket kennt keine App.

| Modul | Aufgabe |
| --- | --- |
| `@firsttris/gobd-kern/dateispeicher` | Dateien unter ihrem SHA-256 (`<verzeichnis>/ab/abcdef…`), atomar geschrieben, beim Lesen gegen den Hash geprüft |
| `@firsttris/gobd-kern/dateityp` | Dateityp am Inhalt erkennen (PDF, JPEG, PNG, WebP, HEIC, XML) |
| `@firsttris/gobd-kern/pruefwert` | Prüfwert der Hash-Kette schreiben und lesen („Nr. 1234 · <SHA-256>“) |
| `@firsttris/gobd-kern/beschreibung` | `index.xml` nach dem Beschreibungsstandard der Finanzverwaltung (Datenträgerüberlassung, § 147 Abs. 6 AO) |

```ts
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";

const speicher = dateispeicher({ verzeichnis: () => process.env.DOCUMENTS_DIR ?? "data", bezeichnung: "Belegdatei" });
const hash = await speicher.speichern(bytes);
const original = await speicher.laden(hash); // wirft, wenn die Datei verändert wurde
```

Hash-Kette, Siegel und die Sperren in Postgres folgen als SQL-Vorlage ([#935](https://github.com/firsttris/haben/issues/935)). Noch nicht auf npm veröffentlicht.
