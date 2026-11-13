---
title: "Agentic Engineering in der Praxis: wie Haben mit KI-Agenten entsteht"
description: >-
  Wie ein Open-Source-Projekt mit KI-Agenten gebaut wird: Board und Issues, Skills für Claude Code und
  andere Coding-Agenten, TDD-Review mit rotem Test, Doku-Prüfung und Merge durch einen Menschen, an einem
  echten Pull Request.
---

<div class="showcase-hero" markdown>

<p class="showcase-kicker">So entsteht Haben</p>

# Agentic Engineering in der Praxis

<p class="showcase-claim">Agenten schreiben den Code. Frische Agenten prüfen ihn und dürfen nur melden, was ein
fehlschlagender Test belegt. Ein Mensch entscheidet, was nach <code>main</code> kommt.</p>

[Ein echtes Beispiel](#beispiel){ .md-button .md-button--primary } [Etwas übernehmen](mitwirken.md#etwas-übernehmen){ .md-button } [Zum Board](https://github.com/users/firsttris/projects/2){ .md-button }

</div>

<div class="showcase-cards showcase-cards--drei" markdown>
<div class="rolle rolle--mensch" markdown>
**🧑 Mensch entscheidet**

Was gebaut wird, offene fachliche Fragen, den Merge und das Release.
</div>
<div class="rolle rolle--agent" markdown>
**🤖 Agent baut und prüft**

Issues, Code mit rotem Test zuerst, Selbstprüfung, Review, Doku-Prüfung.
</div>
<div class="rolle rolle--auto" markdown>
**⚙️ Automatik hält Regeln**

Board, Zuweisung, PR-Regeln, CI und das Schließen der Issues mit dem Release.
</div>
</div>

## Der Ablauf

```mermaid
flowchart TB
  subgraph Planen
    direction LR
    Issue["Issue<br/>Fehler, Wunsch oder<br/>Befund aus einem Review"] --> Board["board-pflegen<br/>prüft, ordnet ein"]
    Board --> Wollen{"Wollen<br/>wir das?"}
    Wollen -->|nein| Nicht["Bewusst nicht"]
    Wollen -->|ja| Geplant["Karte „Geplant“"]
  end
  subgraph Bauen
    direction LR
    Uebernehmen["/übernehmen"] --> Zuweisen["Workflow „Übernehmen“<br/>Karte „In Arbeit“"]
    Zuweisen --> Code["Agent baut<br/>roter Test, Code, Doku"]
    Code --> PR["beitrag<br/>Entwurf, PR-Regeln"]
  end
  subgraph Prüfen
    direction LR
    Selbst["beitrag-pruefen<br/>frischer Agent"] --> Review["tdd-review ∥ doku-pruefen<br/>frischer Agent"]
    Review -->|Befund| Fix["roter Test, Fix"]
    Fix --> CI
    Review -->|keiner| CI["CI grün"]
    CI --> Merge{"Merge<br/>per Squash"}
  end
  subgraph Ausliefern
    direction LR
    Naechstes["Karte „Im nächsten<br/>Release“"] --> Release["release<br/>nach OK auslösen"]
    Release --> Erledigt["Issues geschlossen<br/>Karte „Erledigt“"]
  end
  Planen --> Bauen --> Prüfen --> Ausliefern

  classDef mensch fill:#f59e0b33,stroke:#d97706
  classDef agent fill:#6366f133,stroke:#6366f1
  classDef auto fill:#10b98133,stroke:#059669
  class Wollen,Uebernehmen,Merge,Nicht mensch
  class Board,Code,PR,Selbst,Review,Fix,Release agent
  class Issue,Geplant,Zuweisen,CI,Naechstes,Erledigt auto
```

Die Farben sind dieselben wie bei den Karten oben. „Frisch“ heißt: ein neuer Agent ohne den Verlauf dessen, der den Code geschrieben hat. Er kennt nur den Pull Request und das Repository und prüft deshalb, was dasteht. Was gemeint war, weiß er nicht.

| Schritt | Wer | Regel | Skill |
| --- | --- | --- | --- |
| Issue schreiben und einordnen | Agent, Maintainer entscheidet | [Issues schreiben](mitwirken.md#issues-schreiben) | `issue-schreiben`, `board-pflegen` |
| Übernehmen | wer mitbauen will | [Etwas übernehmen](mitwirken.md#etwas-übernehmen) | |
| Bauen | Agent | [Konventionen](entwicklung.md#konventionen), [Tests](entwicklung.md#tests) | `checks` |
| Pull Request | Agent | [Branches, Titel und Commits](mitwirken.md#branches-titel-und-commits) | `beitrag`, `pr-screenshots` |
| Selbstprüfung | frischer Agent | [Beiträge annehmen](mitwirken.md#beiträge-annehmen) | `beitrag-pruefen` |
| Review | frischer Agent, je einer für Code und Markdown | [Review](mitwirken.md#review), [Doku-Prüfung](mitwirken.md#doku-prüfung) | `tdd-review`, `doku-pruefen` |
| Fixes im Fork einer anderen Person | Agent | [Review](mitwirken.md#review), Punkt 4 | `fork-pushen` |
| Merge | Maintainer oder Collaborator mit Zustimmung | [Review](mitwirken.md#review), Punkt 6 | |
| Release | Agent schlägt vor, Maintainer gibt frei | [Veröffentlichen](entwicklung.md#veröffentlichen) | `release` |
| Amtliche Jahreswerte | Workflow öffnet ein Issue, Agent zieht nach | [Jahreswerte](entwicklung.md#jahreswerte) | `jahreswerte` |

Dazu kommt `belegvorlage`. Mit diesem Skill schreiben Nutzer ihr eigenes Rechnungslayout, ohne das Repository zu brauchen ([Eigene Belegvorlagen](belegvorlagen.md#mit-einem-ki-agenten)).

## Doku für Menschen, Skills für Agenten

<div class="showcase-cards showcase-cards--drei" markdown>
<div markdown>
**📖 Doku: was gilt und warum**

`docs/` und `DESIGN.md`, kurz und auf Deutsch. Menschen und Agenten lesen dieselben Regeln, jede steht nur an einer Stelle.
</div>
<div markdown>
**🛠️ Skills: was zu tun ist**

`.claude/skills/`, Schritt für Schritt je Aufgabe. Ein Skill verweist auf die Regel, statt sie zu wiederholen.
</div>
<div markdown>
**✅ Skripte: was sich sicher prüfen lässt**

`scripts/` und `.github/workflows/`. Ob ein Agent die Regel gelesen hat, spielt dann keine Rolle mehr.
</div>
</div>

`CLAUDE.md` und `AGENTS.md` sind nur der Einstieg: wo eine Regel steht und was nie passieren darf. Die Workflows halten Board und Pull Requests auf Stand:

| Workflow | Läuft bei | Tut |
| --- | --- | --- |
| Übernehmen | Kommentar `/übernehmen` oder `/freigeben`, täglich | weist zu, schiebt die Karte nach „In Arbeit“, fragt nach 14 Tagen nach, gibt nach weiteren sieben frei |
| Board | Issue zugewiesen, Pull Request geöffnet oder gemergt | zieht die Karte nach `Refs` und `Umgesetzt` mit |
| PR-Regeln, PR-Regeln Kommentar | jeder Push auf einen Pull Request, geänderter Titel oder Beschreibung | prüft Titel und Issue-Verweise, warnt bei gewachsenen Dateien und fehlender Doku, erinnert an Selbstprüfung und Review, schreibt das Ergebnis als einen Kommentar |
| CI | Pull Request außerhalb des Entwurfs, `main` | lint, Typen, Vitest mit Postgres, Playwright, KoSIT, ZUGFeRD, Container |
| Docs | Pull Request, `main` | baut diese Seiten, auf `main` auch veröffentlichen |
| Bump version, Release | Maintainer löst aus | Version, Image, GitHub-Release, schließt die umgesetzten Issues |
| Jahreswerte prüfen | montags | öffnet je neuem amtlichem Wert, neuer ERiC-Version oder geänderter Norm ein Issue |

Was die Automatik nicht sieht, also neue Issues einordnen, offene Gespräche finden und Karten aufräumen, übernimmt `board-pflegen`. Seine Vorschläge setzt es erst nach dem OK des Maintainers um.

## Ein Beispiel: der Satz auf dem Storno { #beispiel }

Issue [#716](https://github.com/firsttris/haben/issues/716) mit den Pull Requests [#814](https://github.com/firsttris/haben/pull/814) und [#821](https://github.com/firsttris/haben/pull/821), vom `/übernehmen` bis zum letzten Merge in gut acht Stunden.

```mermaid
sequenceDiagram
  autonumber
  participant N as Nutzer
  participant M as Maintainer
  participant B as Board
  participant C as Collaborator + Agent
  participant P as Frische Agenten
  participant CI as CI
  N->>M: Issue #35;716
  M->>B: nachgestellt, „Geplant“
  C->>B: /übernehmen
  B-->>C: zugewiesen, „In Arbeit“
  C->>P: PR #35;814 nach Zahlstand
  P-->>C: Selbstprüfung, TDD-Review: kein Befund
  M->>B: Merge, „Im nächsten Release“
  C->>P: PR #35;821 mit Saldo-Satz
  P-->>C: TDD-Review: kein Befund
  C->>M: Beitragsprüfung
  M-->>C: so nicht, neutraler Satz
  C->>C: Umbau, roter Test zuerst
  C->>P: Selbstprüfung, neu
  par Code
    P-->>C: tdd-review: kein Befund
  and Markdown
    P-->>C: doku-pruefen: kein Befund
  end
  C->>CI: neuer Stand
  CI-->>M: grün
  M->>C: Merge per Squash
```

1. **Issue:** Ein Nutzer meldet, dass das Storno einer unbezahlten Rechnung über 1 € verspricht: „Der Betrag wird Ihnen erstattet.“ Der Maintainer stellt den Fehler nach und setzt die Karte nach „Geplant“.
2. **Übernehmen:** Ein Collaborator kommentiert `/übernehmen` mit einem kurzen Plan. Sekunden später ist das Issue ihm zugewiesen und die Karte steht in „In Arbeit“.
3. **Erster Pull Request:** #814 richtet den Satz am Zahlstand aus, ohne Zahlung sagt das Storno keine Erstattung mehr zu. Zuerst kommen rote Tests, dann der Fix; Selbstprüfung und TDD-Review finden nichts. Der Maintainer prüft nach und merged. Wegen `Umgesetzt #716` wandert die Karte nach „Im nächsten Release“.
4. **Zweite Fassung:** Danach soll das Storno auch den Saldo des Kundenkontos nennen. Der Agent baut in #821 einen Satz dafür („Ihr Kundenkonto weist ein Guthaben i. H. v. … aus“), wieder mit roten Tests zuerst. Zwei Runden TDD-Review durch frische Agenten finden nichts. Für jeden Verdacht schrieben sie einen eigenen Test, und jeder blieb grün.
5. **Der Mensch entscheidet:** In der Beitragsprüfung rechnet der Maintainer den Saldo selbst nach. Er stimmt. Gemergt wird trotzdem nicht: Das Storno wird festgeschrieben und geht an den Kunden. Der Saldo stimmt aber nur, wenn der Bankabgleich vollständig ist. Bei einer eingegangenen, noch nicht zugeordneten Zahlung würde Haben dem Kunden schriftlich eine Forderung bescheinigen, die es nicht gibt. Sein Vorschlag lautet deshalb: nur „Die ursprüngliche Rechnung wird storniert.“
6. **Umbau:** Wieder kommt der rote Test zuerst, dann der Fix. Die Berechnung des Saldos fällt ganz weg. Weil sich der Ansatz geändert hat, läuft die Selbstprüfung neu.
7. **Code und Markdown getrennt geprüft:** `tdd-review` und `doku-pruefen` laufen nebeneinander, je in einem frischen Agenten. Das TDD-Review schreibt 25 eigene Tests für Grenzfälle und ältere Belege, die Doku-Prüfung gleicht `docs/rechnungen.md` mit Code und Entscheidung ab. Keiner findet einen Befund.
8. **Merge:** Die CI ist grün, der Maintainer merged per Squash. #821 verweist nur mit `Refs #716`, umgesetzt war das Issue schon mit #814. Es bleibt offen, bis das nächste Release es schließt.

> [!IMPORTANT]
> **Alle Tests grün, und trotzdem falsch.** Code und Tests der Saldo-Fassung waren richtig. Falsch war die fachliche Annahme, dass Haben auf einem festgeschriebenen Beleg über den Kontostand sprechen darf. Das prüft kein Test, das musste ein Mensch entscheiden.

## Leitplanken für Agenten

Dass kein ungeprüfter Code nach `main` kommt, hängt nicht davon ab, ob ein Agent die Regeln kennt, sondern davon, dass ein Fehler vor dem Merge auffällt.

<div class="showcase-cards" markdown>
<div markdown>
**🧱 Fehlerklassen ausgeschlossen**

Geld in Cent statt Gleitkomma; Postgres-Trigger und Hashkette schützen Festgeschriebenes auch vor fehlerhaftem Code ([Konventionen](entwicklung.md#konventionen)).
</div>
<div markdown>
**🧪 Tests für jede Änderung**

Keiner abgeschwächt, Übersprungenes genannt ([Mitwirken](mitwirken.md)).
</div>
<div markdown>
**📏 Fremde Maßstäbe**

[KoSIT-Validator](entwicklung.md#kosit-validator), [SEPA-Schemas](entwicklung.md#schemas-der-sepa-überweisung-und--lastschrift), WCAG 2.2 AA; fachliche Details nach der Primärquelle im Code.
</div>
<div markdown>
**🤖 Regeln als Skript**

Wo sie sich sicher entscheiden lassen ([Automatische Prüfungen der Regeln](mitwirken.md#automatische-prüfungen-der-regeln)).
</div>
<div markdown>
**🔴 Review mit rotem Test**

Unabhängig, ein Befund nur mit Test, der fehlschlägt ([Review](mitwirken.md#review)).
</div>
<div markdown>
**🧑 Ein Mensch merged**

Bei Steuer, Buchung, ELSTER und GoBD erst nach seinem OK.
</div>
</div>

> [!WARNING]
> **Was das nicht leistet:** Die Leitplanken fangen Fehler, die ein Test zeigen kann. Ist die fachliche Annahme selbst falsch, etwa bei einer Steuerregel, sind Code und Test gemeinsam falsch und trotzdem grün. Dagegen helfen nur die Primärquelle im Code, Rückmeldungen aus echten Abgaben und die Prüfung durch eine Steuerberatung. Ein unabhängiges Audit der Software oder ihrer Fachlogik gibt es bisher nicht.

<div class="showcase-hero" markdown>

## Mitmachen

<p class="showcase-claim">Eine Karte aus dem Board aussuchen, im Issue <code>/übernehmen</code> kommentieren und
mit dem Agenten deiner Wahl loslegen. Die Skills liegen im Repository und gelten für jeden Agenten.</p>

[Etwas übernehmen](mitwirken.md#etwas-übernehmen){ .md-button .md-button--primary } [Einstiegs-Issues](https://github.com/firsttris/haben/issues?q=is%3Aopen+label%3Aeinstieg){ .md-button }

</div>
