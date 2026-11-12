"""Tests: python -m unittest discover -s scripts/doku-startseite"""

import tempfile
import unittest
from pathlib import Path

from haben_doku_startseite import startseite_umstellen

URL = "https://haben.app/"


class Startseite(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.site = Path(self.tmp.name)
        (self.site / "index.html").write_text(
            '<link rel="canonical" href="https://haben.app/index.html">\n'
            '<meta property="og:url" content="https://haben.app/index.html">\n'
            '<a href="./index.html">Start</a>\n',
            encoding="utf-8",
        )
        (self.site / "sitemap.xml").write_text(
            "<url><loc>https://haben.app/bank.html</loc></url>\n"
            "<url><loc>https://haben.app/index.html</loc></url>\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.tmp.cleanup()

    def lies(self, name):
        return (self.site / name).read_text(encoding="utf-8")

    def test_canonical_og_url_und_sitemap_zeigen_auf_die_wurzel(self):
        self.assertEqual(startseite_umstellen(self.site, URL), 3)
        self.assertIn('<link rel="canonical" href="https://haben.app/">', self.lies("index.html"))
        self.assertIn('<meta property="og:url" content="https://haben.app/">', self.lies("index.html"))
        self.assertIn("<loc>https://haben.app/</loc>", self.lies("sitemap.xml"))
        self.assertNotIn("index.html", self.lies("sitemap.xml"))

    def test_andere_seiten_und_relative_links_bleiben(self):
        startseite_umstellen(self.site, URL)
        self.assertIn('<a href="./index.html">Start</a>', self.lies("index.html"))
        self.assertIn("<loc>https://haben.app/bank.html</loc>", self.lies("sitemap.xml"))

    def test_zweiter_lauf_aendert_nichts(self):
        startseite_umstellen(self.site, URL)
        self.assertEqual(startseite_umstellen(self.site, URL), 0)
