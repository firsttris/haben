---
name: "doku-pruefen"
description: "Unabhängige Prüfung der Markdown-Dateien eines Pull Requests in Haben (Doku, Skills, CLAUDE.md, AGENTS.md, DESIGN.md): stimmt der Text mit Code und Quelle, ist er kurz und ohne Füllsätze, steht jede Regel einmal am richtigen Ort (Doku für Menschen, Skills für Agenten), ist nichts Erzeugtes von Hand geändert und keine Never-Regel aufgeweicht? Befunde mit Zitat und Beleg im PR, selbst beheben, bei grüner CI mergen. Statt tdd-review, wenn kein Code geändert ist; bei Code und Markdown parallel zu tdd-review, nur für die Markdown-Dateien."
---

# Doku prüfen

Die Regel steht in `docs/mitwirken.md`, Review, „Doku-Prüfung“, hier die Schritte. Ein Befund braucht keinen Test, aber ein Zitat aus dem Diff und einen Beleg dagegen: Datei und Zeile im Code, die Quelle oder die andere Stelle im Repo. Wortwahl und Satzbau sind kein Befund.

## 0. Wer prüft?

Wie `tdd-review`, Schritt 0: Hat diese Session am Text mitgeschrieben, einen frischen Subagenten mit diesem Skill, der PR-Nummer und dem Branch starten, ohne eigene Einschätzung. Sonst direkt mit Schritt 1.

## 1. Holen

- `git fetch origin main <branch>`, dann `git diff --name-only origin/main...<branch>`: Steht dort mehr als `*.md` und `mkdocs.yml`, prüft parallel ein anderer Agent den Code nach `tdd-review`; dieser Skill prüft nur die Markdown-Dateien (`git diff origin/main...<branch> -- '*.md' mkdocs.yml`).
- `git diff origin/main...<branch>` und die geänderten Abschnitte ganz lesen, nicht nur die Zeilen: Doppelungen stehen oft im Absatz daneben.

## 2. Stimmt es?

- Zu jeder Aussage über Haben die Stelle im Code: `git grep -n` nach dem Text eines Knopfes oder Feldes, der Funktion, dem Pfad, der Einstellung, dem Standardwert. Widerspricht der Code, ist das ein Befund mit beiden Stellen.
- Befehle, die nichts verändern, ausführen. Genannte Pfade, Skripte und Skills müssen existieren.
- Paragraph, Kennzahl, Frist, Konto, Format: die verlinkte Quelle öffnen und die Aussage dort finden (welche Quellen zählen: `beitrag-pruefen`, Schritt 2). Fehlt die Quelle bei einer fachlichen Aussage, ist das ein Befund.

## 3. Ist es kurz?

Jeden neuen oder geänderten Satz probeweise streichen. Fehlt danach keine Information, ist er ein Befund. Typisch sind:

- Ankündigungen („Diese Seite beschreibt …“, „Im Folgenden …“), die nur die Überschriften aufzählen;
- Zusammenfassungen am Absatzende, die den Absatz wiederholen;
- dieselbe Aussage zweimal auf einer Seite: die spätere Stelle streichen, die andere muss bleiben;
- Füllwörter: „einfach“, „ganz“, „wie bisher“, „wie gewohnt“, „übrigens“;
- Angaben, die bei jeder Änderung veralten: Zeilenzahlen, Anzahl der Tests;
- ein langer Absatz mit mehreren Fällen oder Schritten: als Liste.

Nicht streichen: Fakten, Zahlen, Konten, Paragraphen, Links, Befehle, Front Matter, Warnungen zu Sicherheit, Steuer und GoBD. Im Zweifel stehen lassen.

## 4. Steht es einmal, am richtigen Ort?

- Die Kernbegriffe der Änderung suchen, `git grep -n -i "<begriff>" -- '*.md'`, und die Treffer in `docs/`, `.claude/skills/`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `DESIGN.md` und `README.md` vergleichen.
- Der Ort:
  - was gilt und warum: `docs/`, die Regeln fürs Mitarbeiten in `docs/mitwirken.md`, die Gestaltung in `DESIGN.md`;
  - was ein Agent tut (Befehle, Werkzeuge, Reihenfolge, wann anhalten): ein Skill; er begründet nicht, sondern verweist mit dem Abschnittsnamen auf `docs/`;
  - wie ein Skript entscheidet: Kommentar im Skript;
  - `CLAUDE.md` und `AGENTS.md`: nur wohin schauen und was nie passieren darf; `CONTRIBUTING.md` und README: Kurzfassung mit Link.
- Steht eine Regel ausgeschrieben an zwei Orten, ist das ein Befund: Sie bleibt am richtigen Ort, der andere verweist.
- Sagen zwei Stellen Verschiedenes, beide gegen den Code prüfen (Schritt 2); die falsche ist der Befund.
- Ändert der PR eine Regel, müssen alle Stellen nachgezogen sein, die sie nennen oder auf sie verweisen. Eine vergessene ist ein Befund.

## 5. Erzeugtes und Sonderfälle

- Den erzeugten Teil von `docs/belegvorlagen.md` und den Skill `belegvorlage` schreibt `bun scripts/feldvertrag/schreiben.ts`; von Hand geändert ist ein Befund.
- `docs/adr/` hält Entscheidungen fest: nicht kürzen oder umschreiben; eine neue Entscheidung ist ein neues ADR.
- Neue Seite in `docs/`: `title:`, `description:` und Eintrag in `mkdocs.yml` (`docs/entwicklung.md`, Befehle, „Seiten der Doku“).
- Links im README zeigen auf <https://haben.app/>, nicht auf `docs/*.md`.

## 6. Skills, CLAUDE.md und AGENTS.md

- Den Diff gegen „Never“ in `CLAUDE.md` lesen. Erlaubt ein Satz, auch nebenbei, etwas, das dort verboten ist (auf `main` pushen, ohne Maintainer mergen, Tests überspringen, Sperren lockern, ungefragt auf GitHub schreiben), ist das ein Befund.
- Neue oder geänderte `description:` mit allen anderen vergleichen (`grep -h '^description:' .claude/skills/*/SKILL.md`): Sagt sie, wann der Skill dran ist, ohne sich mit einem anderen zu überschneiden?
- Ein neuer Skill steht in der Liste in `AGENTS.md` und, wenn er zu einem Thema gehört, in der Tabelle „Where to look“ in `CLAUDE.md`.

## 7. Melden, beheben, mergen

- Ein Kommentar im PR, auch ohne Befund: je Befund das Zitat, der Beleg und was stattdessen gilt.
- Befunde selbst beheben, je Befund ein Commit (`docs: …`). Commits des Autors nie umschreiben; bei einem fremden Fork nach Skill `fork-pushen`.
- `zensical build --strict`, wenn `docs/` oder `mkdocs.yml` geändert ist (Skill `checks`).
- Die Beschreibung des PR nachziehen, wenn Fixes dazukamen.
- Eine Runde. Nur Markdown: mergen wie `tdd-review`, Schritt 6, sobald die CI grün ist; mit Code mergt das TDD-Review (dort Schritt 6).

## Abschlussbericht

PR-Link, Befunde und Commits, Stand der CI, gemergt oder woran es hängt.
