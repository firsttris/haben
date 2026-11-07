"""Tests: python -m unittest discover -s scripts/doku-aenderungsdatum (mit requirements-docs.txt installiert)."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import markdown

from haben_doku_aenderungsdatum import format_date, last_commit_date, makeExtension, with_date


class FormatDate(unittest.TestCase):
    def test_deutsches_datum(self):
        self.assertEqual(format_date("2026-11-07"), "7. November 2026")
        self.assertEqual(format_date("2027-03-01"), "1. März 2027")
        self.assertEqual(format_date("2026-12-31"), "31. Dezember 2026")

    def test_anderes_format_ergibt_none(self):
        for value in ["", "2026-11", "2026-13-01", "2026-00-10", "2026-11-32", "07.11.2026", "2026-11-07T10:00"]:
            with self.subTest(value=value):
                self.assertIsNone(format_date(value))


class WithDate(unittest.TestCase):
    def test_haengt_datum_als_html_block_an(self):
        lines = with_date(["# Titel", "Text"], "2026-11-07")
        self.assertEqual(lines[:3], ["# Titel", "Text", ""])
        self.assertIn('<time datetime="2026-11-07">7. November 2026</time>', lines[3])

    def test_datum_nicht_im_suchindex(self):
        # Sonst landet „Letztes Update“ im letzten Abschnitt jeder Seite in search.json, und die Suche nach
        # „Update“ findet jede Seite. Zensical lässt Elemente mit data-search-exclude aus dem Index weg
        # (wie MkDocs Material, https://squidfunk.github.io/mkdocs-material/plugins/search/).
        lines = with_date(["Text"], "2026-11-07")
        self.assertIn("data-search-exclude", lines[-1])

    def test_ohne_datum_unveraendert(self):
        self.assertEqual(with_date(["Text"], None), ["Text"])
        self.assertEqual(with_date(["Text"], "kaputt"), ["Text"])


class LastCommitDate(unittest.TestCase):
    def test_datum_des_letzten_commits_der_datei(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            env = {
                **os.environ,
                "GIT_AUTHOR_NAME": "Test",
                "GIT_AUTHOR_EMAIL": "test@example.org",
                "GIT_COMMITTER_NAME": "Test",
                "GIT_COMMITTER_EMAIL": "test@example.org",
            }

            def git(*args, date):
                subprocess.run(
                    ["git", *args],
                    cwd=repo,
                    check=True,
                    capture_output=True,
                    env={**env, "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date},
                )

            git("init", "-q", date="2026-01-01T12:00:00+01:00")
            (repo / "docs").mkdir()
            (repo / "docs/a.md").write_text("A")
            (repo / "docs/b.md").write_text("B")
            git("add", ".", date="2026-01-01T12:00:00+01:00")
            git("commit", "-q", "-m", "erste", date="2026-01-01T12:00:00+01:00")
            (repo / "docs/b.md").write_text("B2")
            git("commit", "-q", "-am", "zweite", date="2026-11-07T12:00:00+01:00")

            self.assertEqual(last_commit_date(Path("docs/a.md"), repo), "2026-01-01")
            self.assertEqual(last_commit_date(Path("docs/b.md"), repo), "2026-11-07")
            self.assertIsNone(last_commit_date(Path("docs/gibtsnicht.md"), repo))

    def test_ohne_repository_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(last_commit_date(Path("docs/a.md"), Path(tmp)))


class OhneZensical(unittest.TestCase):
    def test_ohne_kontext_der_seite_bleibt_die_seite_unveraendert(self):
        html = markdown.markdown("Text", extensions=[makeExtension()])
        self.assertEqual(html, "<p>Text</p>")


if __name__ == "__main__":
    unittest.main()
