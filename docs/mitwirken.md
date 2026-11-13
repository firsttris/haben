---
title: "Mitwirken an Haben: Branches, Prüfungen, Review"
description: >-
  Wie ein Beitrag zu Haben entsteht: Aufgabe übernehmen, Branches, Titel und Commits, Arbeit mit KI-Agenten,
  automatische Prüfungen der Regeln, Issues, Beiträge annehmen und Review.
---

# Mitwirken

Vor jedem Push dieselben Prüfungen wie in der CI (ohne Bun auf dem Rechner siehe [Prüfungen ohne Bun auf dem Rechner](entwicklung.md#prüfungen-ohne-bun-auf-dem-rechner)):

```sh
bun run lint
bun run typecheck
TEST_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_test bun run test
bun run build
E2E_DATABASE_URL=postgres://haben:haben@localhost:5432/haben_e2e bun run e2e   # ohne Browser von Playwright nur in der CI
zensical build --strict                                                       # wenn docs/ oder mkdocs.yml geändert sind
```

Beide Datenbanken leeren die Tests (siehe [Tests](entwicklung.md#tests)); nie auf einen Server mit echten Daten zeigen lassen. Was übersprungen wurde, gehört in die Beschreibung des Pull Requests.

- Ein Pull Request, ein Thema; er trägt nur seine eigenen Commits.
- Tests für das, was sich ändert: Vitest für Logik, Postgres-Integrationstests neben dem Modul, Playwright in `apps/web/e2e/` für das, was ein Nutzer anklickt. Ein Bugfix beginnt mit einem Test, der fehlschlägt. Änderungen an Buchungen oder Steuerberechnung mit Testfällen für SKR03 und SKR04 sowie Ist und Soll: Jede der vier Angaben kommt in einem Fall vor, das volle Kreuzprodukt mit weiteren Varianten nur, wo sich der Weg durch den Code dabei unterscheidet. Ein Fall gegen Postgres kostet bei jedem Lauf der CI rund eine Sekunde; was ohne Datenbank geht (Konten, Beträge, Fristen), wird ohne Datenbank getestet.
- Die Doku in `docs/`, die das Verhalten beschreibt, im selben Pull Request, kurz und für Menschen; Schritte für Agenten gehören in einen Skill, Interna eines Skripts in seine Kommentare (siehe [Befehle](entwicklung.md#befehle), „Kurz halten“). Das README nur, wenn ein Bereich dazukommt oder wegfällt oder seine einzeilige Beschreibung nicht mehr passt; Details gehören nach `docs/`, die Tabellenzeile bleibt kurz.
- Schemaänderungen mit erzeugter Migration; Trigger in einer eigenen SQL-Migration.
- Texte in der Oberfläche auf Deutsch.
- Änderungen am Aussehen mit Screenshots vorher und nachher in der Beschreibung, hell und dunkel, wo es darauf ankommt auch am Handy; die Bilder für „vorher“ entstehen vor der ersten Änderung. Wer in [`firsttris/haben-bilder`](https://github.com/firsttris/haben-bilder) schreiben darf (Maintainer, Collaborators), legt sie dort ab, je Pull Request ein Ordner `pr-<n>/`; alle anderen hängen sie als Anhang an, nie als Branch im Haupt-Repository (Skill [`pr-screenshots`](https://github.com/firsttris/haben/blob/main/.claude/skills/pr-screenshots/SKILL.md)). Die Bilder in README und Doku erneuert danach [Update screenshots](entwicklung.md#bilder-für-readme-und-doku).

## Etwas übernehmen

Wer mitbauen will, sucht sich eine Aufgabe im [Project „Roadmap“](https://github.com/users/firsttris/projects/2) aus:

1. **Aussuchen:** eine Karte aus „Geplant“, am liebsten weit oben, denn die Reihenfolge ist die Priorität. Für den Einstieg eignen sich Karten mit Aufwand „S“ und Issues mit dem Label [`einstieg`](https://github.com/firsttris/haben/issues?q=is%3Aopen+label%3Aeinstieg). Ein Entwurf ohne Issue bekommt zuerst ein Issue.
2. **Übernehmen:** im Issue eine Zeile `/übernehmen` kommentieren, gern mit einem kurzen Plan darunter. Der Workflow „Übernehmen“ (`.github/workflows/uebernehmen.yml`) weist dir das Issue zu, schiebt die Karte nach „In Arbeit“ und bestätigt es im Issue; Schreibrecht brauchst du dafür nicht. Er lehnt mit Begründung ab, wenn das Issue schon vergeben ist, noch keine Karte hat oder die Karte schon in „Im nächsten Release“ oder „Erledigt“ steht. Eine Karte in „In Arbeit“ ohne Zuweisung, etwa weil ein Pull Request sie vorgezogen hat, lässt sich übernehmen. Wie viele Karten jemand übernimmt, ist nicht begrenzt. Bei Karten aus „Später“ den Umfang am besten erst kurz im Issue klären.
3. **Nachfragen und Freigeben:** Kommt 14 Tage lang weder ein Pull Request mit `Refs` oder `Umgesetzt` noch ein Kommentar von dir, fragt der Workflow im Issue nach; kommt danach sieben Tage nichts, hebt er die Zuweisung auf, und die Karte geht zurück nach „Geplant“. Wer aufhören will, kommentiert `/freigeben`. Ein Maintainer kann eine Zuweisung jederzeit von Hand ändern, etwa wenn der Plan nicht passt.
4. **Bauen:** wie im Folgenden beschrieben, mit `Umgesetzt #…` in der Beschreibung des Pull Requests und vor „Ready for review“ mit der [Selbstprüfung](#beiträge-annehmen). Ein früher Entwurf als Pull Request hilft, wenn du unsicher bist, ob der Weg passt.

## Branches, Titel und Commits

- **Branch:** Wer Schreibrecht hat, legt den Branch direkt in `firsttris/haben` an, alle anderen in ihrem Fork. Direkt auf `main` wird nicht gepusht. Vor jedem Push prüfen, ob der Pull Request des Branches noch offen ist; ist er gemergt, neu von `origin/main` und ein neuer Pull Request. Force-Push nur mit `--force-with-lease` auf den eigenen Branch nach einem Merge.
- **Entwurf:** Ein Pull Request darf als Entwurf beginnen; die CI startet erst mit „Ready for review“. Sie lässt Jobs aus, die die Änderung nicht berührt, bei reinem Markdown alles außer dem Doku-Build (Job `changes` in `ci.yml`); auf `main` und im Release laufen alle.
- **Titel:** `Bereich: was sich ändert (#Issue)`, etwa „Belege: eigene Ausgangsrechnung beim Upload erkennen (#104)“; die Nummer nur, falls es ein Issue gibt. Der Bereich ist ein bis drei Wörter, groß geschrieben (klein nur bei Namen wie „sevDesk“), ohne Punkt am Ende. Pull Requests werden per Squash gemergt; der Titel wird dann der Commit auf `main`. Der Workflow „PR-Regeln“ prüft das, auch für Entwürfe; Pull Requests von Bots wie Renovate behalten ihre eigenen Titel (siehe [Automatische Prüfungen der Regeln](#automatische-prüfungen-der-regeln)).
- **Beschreibung:** Beim Squash wird die Beschreibung des Pull Requests die Nachricht des Commits auf `main` (Einstellung des Repositorys: `PR_BODY`) und bleibt so in der Historie. Sie muss deshalb bis zum Merge zum Stand des Pull Requests passen: Ändert ein weiterer Push, was der Pull Request tut oder wie er geprüft wurde, ändert sich die Beschreibung mit, auch nach Fixes aus dem Review und nach einem Rebase. Sie nennt alles, was der Pull Request ändert, und beschreibt das Ergebnis, nicht den Weg dorthin; Zwischenstände und Antworten auf Reviews gehören in Kommentare.
- **Issues in der Beschreibung:** mit `Umgesetzt #…`, wenn der Pull Request das Issue fertig macht, sonst mit `Refs #…` (ein Teil, ein Bezug). Mehrere gehen als Liste: `Umgesetzt #12, #13`. Nie `Closes` oder `Fixes`: GitHub schlösse das Issue schon beim Merge, die Nutzer haben es aber erst mit dem Release; „PR-Regeln“ meldet es als Fehler.
- **Vom Issue zum Release:** Das [Project „Roadmap“](https://github.com/users/firsttris/projects/2) zieht die Karte mit (Workflows „Board“ und „Übernehmen“, `scripts/board/`), nie zurück:
    - Issue zugewiesen oder Pull Request mit `Refs` oder `Umgesetzt` geöffnet → „In Arbeit“.
    - Pull Request mit `Umgesetzt` gemergt → „Im nächsten Release“.
    - Eine fertige Version (kein Release Candidate) schließt diese Issues mit Link auf das Release (Job `issues-schliessen` in `release.yml`) → „Erledigt“.

    Fehlt danach etwas, kommt es in ein neues Issue mit Verweis auf das alte. Die Workflows brauchen das Secret `PROJECT_TOKEN` (klassisches Token mit Scope `project`). Was die Automatik nicht sieht, also neue Issues einordnen, offene Gespräche und Übernahme-Wünsche finden und aufräumen, erledigt der Skill [`board-pflegen`](https://github.com/firsttris/haben/blob/main/.claude/skills/board-pflegen/SKILL.md); jedes Issue bekommt dabei einen kurzen Kommentar mit dem Ergebnis.
- **Commits im Pull Request:** gern im Stil von [Conventional Commits](https://www.conventionalcommits.org/de/) auf Deutsch, etwa `fix(belege): Fremdwährung in der Rechnungswährung vergleichen` (Empfehlung, keine Prüfung).

## Mit KI-Werkzeugen

Mit KI-Agenten zu arbeiten ist ausdrücklich in Ordnung; ein großer Teil von Haben ist so entstanden. Der Transparenz halber wird es gekennzeichnet, mehr nicht:

- im Commit mit einer Zeile `Co-Authored-By: <Werkzeug oder Modell> <Adresse>`, wie sie die Werkzeuge meist selbst setzen;
- in der Beschreibung des Pull Requests mit einer Zeile wie „🤖 Generated with <Werkzeug>“.

Das ändert nichts am Review. Verantwortlich für den Inhalt bleibt, wer den Pull Request einreicht. Weitere Angaben, etwa ein Link zur Session, sind erlaubt, aber nicht nötig.

<a id="leitplanken-für-agenten"></a>Warum dem Ergebnis trotzdem zu trauen ist und wie der Ablauf an einem Beispiel aussieht, steht unter [Agentic Engineering](agentic-engineering.md#leitplanken-für-agenten).

## Automatische Prüfungen der Regeln

Was sich sicher entscheiden lässt, prüft ein Skript; was nicht, erscheint als Hinweis.

| Regel | Prüfung | Wirkung |
| --- | --- | --- |
| Module nur über `index.ts` importieren | `scripts/modulgrenzen/` in `bun run lint` | Fehler |
| Jede Seite in `e2e/seiten.spec.ts` und `e2e/barrierefreiheit.spec.ts` | `scripts/seitenabdeckung/` in `bun run lint` | Fehler |
| Höchstens 400 Zeilen je Datei, außer den alten in `altdateien.json` | `scripts/dateigroesse/` in `bun run lint` | Fehler |
| Höchstens 80 Zeilen je Funktion ohne Leerzeilen, außer in Tests | Biome-Regel `noExcessiveLinesPerFunction` im Editor und in `bun run lint` | Hinweis |
| Formularfelder über `Field`, kein eigenes Element mit der Klasse `field` (außer `<fieldset className="field">` für eine Gruppe) | `scripts/felder/` (Biome-Regel) in `bun run lint`; dazu der Test „Alle Felder stammen aus der gemeinsamen Komponente“ in `e2e/barrierefreiheit.spec.ts` | Fehler |
| Auswahllisten über `Field`, kein `<select>` außerhalb | `scripts/felder/keine-nackte-auswahl.grit` (Biome-Regel) in `bun run lint`; Ausnahmen mit `// biome-ignore lint/plugin: Grund` | Fehler |
| Alte große Datei wächst um 20 Zeilen oder mehr (außer `schema.ts`) | `scripts/pr-regeln/` | Hinweis |
| Titel `Bereich: was sich ändert`, `(#Issue)` falls es eins gibt | `scripts/pr-regeln/`, Workflow „PR-Regeln“ | Fehler |
| Issues mit `Umgesetzt #…` oder `Refs #…`, nicht `Closes` oder `Fixes` | `scripts/pr-regeln/`, Workflow „PR-Regeln“ | Fehler |
| Doku zum geänderten Verhalten | `scripts/pr-regeln/`: Code unter `apps/web/src` oder `packages/*/src` ohne Änderung in `docs/` | Hinweis |
| Bugfix beginnt mit einem Test | `scripts/pr-regeln/`: `fix`-Commit ohne geänderten Test | Hinweis |
| Selbstprüfung und unabhängiges Review mitbringen ([Beiträge annehmen](#beiträge-annehmen)) | `scripts/pr-regeln/`: Pull Request außerhalb des Entwurfs von jemandem ohne Schreibrecht, nennt `tdd-review` für Code, `doku-pruefen` für Markdown (`docs/`, `mkdocs.yml`, `LICENSE`), bei beidem beide | Hinweis |
| Jedes Feld der Belegvorlagen im Feldvertrag, mit Beschreibung | `layout-schema.test.ts` in `bun run test` | Fehler |
| Kein Feld einer Version fällt weg, wird umbenannt oder wechselt den Typ | `layout-schema.test.ts` gegen `layout-schema.v<n>.json` | Fehler |
| Alte Layouts ergeben mit heutigen Daten ein PDF | `layout-kompatibel.test.ts` mit `templates/kompatibel/` | Fehler |
| Skill `belegvorlage` und Feldtabellen aktuell | `layout-anleitung.test.ts` | Fehler |
| Doku baut ohne Warnung | Workflow „Docs“ auch im Pull Request | Fehler |
| Jede Seite in `docs/` mit `description:` im Front Matter | Workflow „Docs“ (`docs.yml`) | Fehler |
| Jede versiegelte, nur anhängbare oder gegen Löschen gesperrte Tabelle und jede, deren Löschen das Audit-Log aufzeichnet, hat einen Trigger vor `TRUNCATE` | `apps/web/src/server/db/truncate.test.ts` in `bun run test` (mit Postgres) | Fehler |

Was „PR-Regeln“ meldet, steht auch als ein Kommentar im Pull Request, bei jedem Push aktualisiert (Workflow „PR-Regeln Kommentar“; er startet aus der Fassung auf `main`, eine Änderung an ihm wirkt also erst nach dem Merge).

Vor dem Push meldet `bun scripts/pr-regeln/pruefen.ts --titel "…" --beschreibung <datei>` dasselbe wie der Workflow, nur mit git und in unter einer Sekunde; verglichen wird mit `origin/main` (`--basis` für einen anderen Stand). Den Hinweis auf Selbstprüfung und Review gibt es nur im Workflow.

### Wenn eine Prüfung anschlägt

Titel, Issue-Verweise, Dateigröße und Selbstprüfung sagen in der Meldung selbst, was zu tun ist. Sonst:

- **Modulgrenzen:** den fehlenden Namen in der `index.ts` des anderen Moduls ergänzen.
- **Seitenabdeckung:** die neue Seite in beide Spec-Dateien aufnehmen, nicht in `scripts/seitenabdeckung/ausnahmen.ts`; dort stehen nur Seiten mit Grund, etwa reine Weiterleitungen. Wer eine mit „noch offen“ markierte Seite in die Spec aufnimmt, streicht ihre Ausnahme.
- **Funktionslänge:** in neuem Code einen Teil in eine eigene Funktion mit Namen auslagern; ältere lange Funktionen werden nur in einem eigenen Pull Request geteilt.
- **Felder und Auswahllisten:** das Feld in `Field` setzen; eine bewusst allein stehende Liste bekommt `// biome-ignore lint/plugin: Grund`.
- **Alte große Datei wächst, Code ohne Doku, Fix ohne Test:** beheben, oder der Grund steht in der Beschreibung (bleibt in der Datei, weil …; Refactor ohne neues Verhalten; Fix an nichts Testbarem wie der CI).

Wie die Prüfungen im Einzelnen entscheiden und wo sie nicht hinsehen, steht in den Kommentaren der Skripte.

## Issues schreiben

Für neue Issues gibt es Formulare unter **Issues → New issue** (`.github/ISSUE_TEMPLATE/`), jedes mit nur einem Pflichtfeld; ein leeres Issue bleibt möglich. In keinem Issue stehen echte Belegdaten, Steuernummern, IBANs, Zugangsdaten oder Zertifikate; Beispiele nutzen erfundene Beträge, Dateien nur anonymisiert.

Größere Vorhaben und Issues von Agenten folgen dieser Gliederung:

| Abschnitt | Inhalt |
| --- | --- |
| Anlass | Was soll möglich sein, und warum? Ein Alltagsbeispiel mit erfundenen Beträgen. Bei Fehlern: Schritte, erwartet und tatsächlich, Meldung im Wortlaut, Haben-Version. |
| Stand in Haben | Was Haben heute tut, **auf dem aktuellen `main` geprüft**, mit Commit und Links auf Doku oder Code. Nicht aus dem Gedächtnis. |
| Vorschlag | Was sich ändern soll, bei Bedarf in Stufen. Grenzen nennen: was ausdrücklich nicht dazugehört. |
| Akzeptanzkriterien | Drei bis sechs prüfbare Punkte als `- [ ]`, zu denen ein Test oder ein Blick in die Oberfläche Ja oder Nein sagt. Bei Buchungen und Steuer: SKR03 und SKR04, Ist und Soll. |
| Bezug | Verwandte Issues und Pull Requests, Karte im [Project „Roadmap“](https://github.com/users/firsttris/projects/2), Primärquellen mit Link (Gesetz, BMF-Schreiben, Formularanleitung, Formatbeschreibung), bei Fremdprogrammen die Hilfe-Seite. Quellen aus früheren Pull Requests dürfen mit Link auf den Pull Request übernommen werden. |

Ein Issue behandelt ein Thema und passt auf ein bis zwei Bildschirme; Quellcode steht als Link. Fachliche Aussagen belegt eine Quelle, kein Ratgeber; was unsicher ist oder die Steuerberatung entscheiden muss, steht ausdrücklich darin. Der Titel nennt das Ergebnis, nicht den Anlass. Agenten legen Issues nur auf Anweisung an und kennzeichnen sie; die Schritte stehen im Skill `issue-schreiben`. Beim Anlegen kommt der Typ als Label dazu (`fehler`, `wunsch`, `steuer`, `umzug`, `frage`, `technik`, `doku`); fehlt er, ergänzt ihn `board-pflegen` zusammen mit Themen-Labels und dem Platz in der Roadmap, nach OK des Maintainers.

Neben dem Typ gibt es diese Labels:

| Label | Bedeutung |
| --- | --- |
| `oberfläche` | Bedienung, Layout, Handy-Ansicht |
| `buchung` | Konten, Buchungsabläufe, offene Posten, DATEV-Konten |
| `schnittstelle` | REST-API, MCP, Connectoren, laufende Importe |
| `technik` | Abhängigkeiten, CI, Werkzeuge fürs Projekt |
| `doku` | Dokumentation (`docs/`, Website) |
| `sammlung` | Sammel-Issue zum Nachverfolgen |
| `einstieg` | Klein und abgegrenzt, gut für den Einstieg (siehe [Etwas übernehmen](#etwas-übernehmen)) |
| `jahreswerte` | Befund des Workflows „Jahreswerte prüfen“ |

## Beiträge annehmen

Bevor ein Pull Request ins [Review](#review) geht, egal von wem, beantwortet ein Maintainer oder Collaborator, der ihn nicht geschrieben hat, vier Fragen. Ein Befund braucht hier keinen roten Test, aber einen Beleg: eine Stelle im Diff, einen Satz aus der Quelle oder eine Regel.

1. **Wollen wir das?** Es passt zu Haben (Buchhaltung für Freiberufler und kleine GmbHs, nichts aus [Bewusst nicht](roadmap.md#bewusst-nicht), nichts, was ohne Zertifizierung nicht geht), hat ein Issue, am besten eine zugewiesene Karte ([Etwas übernehmen](#etwas-übernehmen)); ohne Issue entscheidet der Maintainer zuerst, ob er die Änderung will. Es gibt sie noch nicht, und sie wurde nicht mit Grund abgelehnt. Der Nutzen ist größer als die dauerhafte Last: Jede Einstellung, Abhängigkeit, Tabelle, externe Verbindung und jeder Sonderfall muss gepflegt werden, eine Migration bleibt für immer; eine neue Abhängigkeit braucht eine zur AGPL-3.0 passende Lizenz und Pflege. Ein Thema je Pull Request; vorhandene Daten bleiben beim Update richtig, geänderte Schnittstellen nennt die Beschreibung; jedes Akzeptanzkriterium ist erfüllt, sonst `Refs #…`.
2. **Nach den Quellen gebaut und fachlich richtig?** Jedes fachliche Detail steht mit Primärquelle im Kommentar und in der Commit-Nachricht ([Konventionen](entwicklung.md#konventionen)). Wer prüft, liest die Quelle selbst, für SKR03 und SKR04, Ist und Soll, Einzelunternehmen und GmbH und den richtigen Rechtsstand, und rechnet einen typischen und einen Randfall gegen die Erwartungen der Tests nach: Ein Test mit derselben falschen Annahme wie der Code ist trotzdem grün. Was die Quelle nicht eindeutig entscheidet, bleibt eine offene Frage. In voller Tiefe gilt das, wo sich ändern kann, was gebucht, versteuert, gemeldet oder festgeschrieben wird.
3. **Die einfachste Lösung?** Jeder Teil des Diffs dient einem Akzeptanzkriterium; keine Abstraktion mit einem Nutzer, keine Einstellung auf Vorrat, keine zweite Lösung für ein gelöstes Problem; wer den Verlauf des Autors nicht kennt, versteht den Code in einem Durchgang. Eine Regel für alle Wege steht an der Stelle, durch die alle laufen. Befund ist das, wenn sich die einfachere Lösung oder die gemeinsame Stelle konkret benennen lässt.
4. **Nach unseren Regeln?** [Konventionen](entwicklung.md#konventionen), [Mitwirken](mitwirken.md) und [`DESIGN.md`](https://github.com/firsttris/haben/blob/main/DESIGN.md). Was ein Skript prüft, meldet „PR-Regeln“; der Rest von Hand.

**Selbstprüfung:** Beitragende beantworten die vier Fragen vor „Ready for review“ selbst, in einem frischen Agenten oder durch jemand anderen, bessern nach und posten das Ergebnis mit Belegen und offenen Fragen als Kommentar. Sie läuft einmal; was danach nachgebessert wird, kommt als Nachtrag mit den Commits in denselben Kommentar, eine neue braucht erst ein geänderter Umfang oder Ansatz. Dann prüft der Maintainer nur nach; ob die Änderung gewollt ist, entscheidet er weiter selbst, und bei fachlich heiklen Änderungen liest er mindestens eine Quelle selbst und rechnet einen Fall gegen. Bringt ein Beitrag auch ein unabhängiges Review mit ([Review](#review), Punkt 1), reviewen wir nicht noch einmal. Fehlt beides, wartet der Pull Request länger.

**Ergebnis:** Nicht gewollt oder offene Grundsatzfrage: Der Maintainer entscheidet, ein grundsätzlich abgelehntes Thema kommt nach [Bewusst nicht](roadmap.md#bewusst-nicht). Gewollt, aber unvollständig: Kleinigkeiten ergänzen wir selbst; fehlt mehr, darf der Beitragende zwei Tage lang selbst nachbessern, danach machen wir es fertig. Dann Review und Merge bei grüner CI; fachlich heikle Änderungen (auch Migrationen auf bestehenden Daten) erst nach einem „OK“ des Maintainers auf eine kurze Zusammenfassung mit Quelle und Gegenrechnung.

Rückmeldungen folgen dem [Verhaltenskodex](https://github.com/firsttris/haben/blob/main/CODE_OF_CONDUCT.md) und trennen, was vor dem Merge nötig ist, von Vorschlägen. Mit Claude Code führt der Skill `beitrag-pruefen` durch.

## Review

Jeder Pull Request mit Code bekommt vor dem Merge ein unabhängiges **TDD-Review**, jeder mit Markdown eine [Doku-Prüfung](#doku-prüfung); ändert er beides, laufen beide nebeneinander, von zwei Prüfern. Mit Claude Code führt der Skill `tdd-review` durch.

1. **Unabhängig:** Wer den Code geschrieben hat, reviewt ihn nicht selbst. Ein KI-Agent, der mitgeschrieben hat, startet dafür einen neuen Agenten ohne diesen Verlauf; der ist unabhängig, auch wenn ihn der Autor gestartet hat. Ein mitgebrachtes Review dieser Art (Schritte 2 bis 5 im Pull Request erkennbar) zählt, außer wir haben selbst Commits ergänzt oder ein fachlicher Zweifel bleibt.
2. **Nur mit rotem Test:** Jeder Verdacht wird ein Test im bestehenden Framework. Nur ein Test, der auf dem Stand des Pull Requests fehlschlägt, ist ein Befund. Stil und Namen sind keiner.
3. **Im Pull Request:** Befunde mit Testname und Ausgabe als Kommentar, auch wenn es keine gibt.
4. **Red → Green:** Test und Fix als eigene Commits obendrauf, direkt auf den Branch des Pull Requests (im Fork mit „Allow edits by maintainers“, um das wir sonst bitten; ein eigener Pull Request ist der letzte Ausweg). Keine Tests abschwächen, keine Sperren lockern, keine Commits von Beitragenden umschreiben. Ein Branch, der nur hinter `main` liegt, braucht vor dem Merge kein Update.
5. **Grün:** Lokal gezielt, was der Pull Request berührt; die volle Suite muss in der CI grün sein. Dann ein Abschlusskommentar mit den behobenen Befunden und dem, was lokal lief.
6. **Merge:** durch einen Maintainer oder, mit dessen Zustimmung, einen Collaborator, immer per **Squash** des Pull Requests selbst; vorher passen Titel und Beschreibung zum Stand. Bei einem Ersatz-Pull-Request steht `Co-authored-by:` mit dem Beitragenden in der Beschreibung, und sein Pull Request wird mit Link auf den Ersatz geschlossen.

**Runden:** Eine; eine zweite nur, wenn die erste Fixes am Code gebracht hat, denn die hat sonst niemand geprüft. Ein Codex- oder anderes KI-Review zählt zur selben Runde und prüft denselben Stand. Weitere Runden nur nach einem schweren Befund (Sicherheit, falsche Buchung oder Steuer, GoBD, Datenverlust), und nur für den Fix; höchstens vier Runden. Bleibt danach ein schwerer Befund offen, wird nicht gemergt, und der Maintainer entscheidet, ob der Pull Request geteilt oder neu angesetzt wird. Befunde, die nur mit konstruierten Eingaben auftreten, werden notiert, nicht behoben, außer bei Sicherheit.

Haben steht unter der AGPL-3.0.

### Doku-Prüfung

Für Markdown (Doku, Skills, `CLAUDE.md`, `AGENTS.md`, `DESIGN.md`) gibt es keinen roten Test. Die Markdown-Dateien eines Pull Requests prüft deshalb jemand, der den Text nicht geschrieben hat. Ein Befund braucht ein Zitat und den Beleg dagegen: Code, Quelle oder die andere Stelle. Mit Claude Code führt der Skill `doku-pruefen` durch.

- **Stimmt:** mit dem Code und mit der genannten Quelle.
- **Kurz:** „Kurz halten“ unter [Befehle](entwicklung.md#befehle).
- **Einmal:** jede Regel an einem Ort, die anderen verweisen; was wohin gehört, steht unter „Kurz halten“.
- **Nichts Erzeugtes von Hand**, etwa `docs/belegvorlagen.md` aus dem Feldvertrag.
- **Skills, `CLAUDE.md` und `AGENTS.md`** weichen keine Regel unter „Never“ in `CLAUDE.md` auf.

Befunde behebt der Prüfer mit eigenen Commits; gemergt wird nach einer Runde bei grüner CI.
