"""Änderungsdatum unter jeder Seite der Doku, aus dem letzten Commit ihrer Datei.

Unter MkDocs Material schrieb das Plugin git-revision-date-localized das Datum unter jede Seite. Zensical 0.1.0
kann das noch nicht, es steht in der Kompatibilitätsliste unter „Planned“
(https://zensical.org/docs/compatibility/mkdocs/plugins/). Diese Markdown-Erweiterung holt den Pfad der Seite
aus dem Kontext, den Zensical jeder Seite mitgibt (zensical.extensions.context), und hängt das Datum an.
Sobald Zensical das Datum selbst kann, fällt sie weg.
"""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from functools import cache
from pathlib import Path

from markdown import Extension, Markdown
from markdown.preprocessors import Preprocessor

MONTHS = (
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
)

DateLookup = Callable[[Path], "str | None"]


def format_date(iso: str) -> str | None:
    """JJJJ-MM-TT als deutsches Datum („7. November 2026“), None bei jedem anderen Format."""
    parts = iso.split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return None
    year, month, day = (int(part) for part in parts)
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    return f"{day}. {MONTHS[month - 1]} {year}"


def with_date(lines: list[str], iso: str | None) -> list[str]:
    """Die Zeilen der Seite mit dem Datum am Ende; ohne gültiges Datum unverändert."""
    text = format_date(iso) if iso else None
    if text is None:
        return lines
    return [
        *lines,
        "",
        f'<p class="aenderungsdatum"><small>Letztes Update: <time datetime="{iso}">{text}</time></small></p>',
    ]


def last_commit_date(path: Path, cwd: Path | None = None) -> str | None:
    """Datum des letzten Commits, der die Datei geändert hat (JJJJ-MM-TT), oder None ohne git oder Historie."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", str(path)],
            capture_output=True,
            text=True,
            check=True,
            cwd=cwd,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def page_path(md: Markdown) -> str | None:
    """Pfad der Seite relativ zu docs_dir aus dem Kontext von Zensical; None außerhalb von Zensical."""
    try:
        from zensical.extensions.context import ContextPreprocessor
    except ImportError:
        return None
    context = ContextPreprocessor.from_markdown(md)
    return context.page.path if context else None


class _DatePreprocessor(Preprocessor):
    def __init__(self, md: Markdown, docs_dir: str, lookup: DateLookup):
        super().__init__(md)
        self.docs_dir = docs_dir
        self.lookup = lookup

    def run(self, lines: list[str]) -> list[str]:
        path = page_path(self.md)
        if path is None:
            return lines
        return with_date(lines, self.lookup(Path(self.docs_dir) / path))


class AenderungsdatumExtension(Extension):
    def __init__(self, **kwargs):
        self.config = {"docs_dir": ["docs", "Verzeichnis der Doku relativ zum Arbeitsverzeichnis"]}
        super().__init__(**kwargs)

    def extendMarkdown(self, md: Markdown) -> None:
        # Vor html_block (20), damit die angehängte Zeile als HTML-Block gilt, und nach der Normalisierung (30)
        lookup = cache(last_commit_date)
        md.preprocessors.register(_DatePreprocessor(md, self.getConfig("docs_dir"), lookup), "aenderungsdatum", 25)


def makeExtension(**kwargs) -> AenderungsdatumExtension:
    return AenderungsdatumExtension(**kwargs)
