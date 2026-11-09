"""Tests: python -m unittest discover -s scripts/doku-kurzlinks"""

import tempfile
import unittest
from pathlib import Path

from haben_doku_kurzlinks import kurzlinks_anlegen


class Kurzlinks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.site = Path(self.tmp.name)
        for name in ("index.html", "404.html", "api.html", "gmbh.html", "assets.html"):
            (self.site / name).write_text("<html></html>", encoding="utf-8")
        (self.site / "assets").mkdir()
        (self.site / "assets" / "icon.svg").write_text("<svg/>", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_ordner_mit_weiterleitung_je_seite(self):
        self.assertEqual(kurzlinks_anlegen(self.site), ["api", "gmbh"])
        seite = (self.site / "api" / "index.html").read_text(encoding="utf-8")
        self.assertIn('content="0; url=../api.html"', seite)
        self.assertIn('href="../api.html"', seite)
        # Der Anker (/api#abschnitt) geht beim Weiterleiten nicht verloren
        self.assertIn("location.replace('../api.html' + location.hash)", seite)
        self.assertIn('name="robots" content="noindex"', seite)

    def test_startseite_404_und_bestehende_ordner_bleiben(self):
        kurzlinks_anlegen(self.site)
        self.assertFalse((self.site / "index").exists())
        self.assertFalse((self.site / "404").exists())
        self.assertEqual([p.name for p in (self.site / "assets").iterdir()], ["icon.svg"])

    def test_zweiter_lauf_aendert_nichts(self):
        kurzlinks_anlegen(self.site)
        self.assertEqual(kurzlinks_anlegen(self.site), [])


if __name__ == "__main__":
    unittest.main()
