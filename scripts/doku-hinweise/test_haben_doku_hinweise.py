"""Tests: python -m unittest discover -s scripts/doku-hinweise (mit requirements-docs.txt installiert)."""

import unittest
import xml.etree.ElementTree as etree

import markdown

from haben_doku_hinweise import TITLES, makeExtension


def render(text: str, *, ours_first: bool = False) -> etree.Element:
    """Wie in mkdocs.yml: Hinweise im GitHub-Stil über pymdownx.quotes, dazu admonition."""
    quotes = ("pymdownx.quotes", {"callouts": True})
    ours = ("haben_doku_hinweise", {})
    order = [ours, quotes] if ours_first else [quotes, ours]
    extensions = ["admonition", *(name for name, _ in order)]
    configs = {name: config for name, config in order}
    html = markdown.markdown(text, extensions=extensions, extension_configs=configs)
    return etree.fromstring(f"<root>{html}</root>")


def admonition(root: etree.Element) -> tuple[list[str], str]:
    box = root.find("div")
    assert box is not None, etree.tostring(root, encoding="unicode")
    title = box.find("p[@class='admonition-title']")
    assert title is not None
    return box.get("class", "").split(), title.text or ""


class GithubHinweise(unittest.TestCase):
    def test_alle_fuenf_typen_mit_deutschem_titel(self):
        # Die fünf Typen von GitHub (https://docs.github.com/de/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts)
        expected = {"NOTE": "Hinweis", "TIP": "Tipp", "IMPORTANT": "Wichtig", "WARNING": "Warnung", "CAUTION": "Vorsicht"}
        for marker, title in expected.items():
            with self.subTest(marker=marker):
                classes, text = admonition(render(f"> [!{marker}]\n> Text"))
                self.assertIn("admonition", classes)
                self.assertIn(marker.lower(), classes)
                self.assertEqual(text, title)

    def test_inhalt_bleibt_mit_mehreren_absaetzen(self):
        root = render("> [!WARNING]\n> Erster Absatz.\n>\n> Zweiter Absatz.")
        paragraphs = [p.text for p in root.find("div").findall("p")]
        self.assertEqual(paragraphs, ["Warnung", "Erster Absatz.", "Zweiter Absatz."])

    def test_eigener_titel_bleibt(self):
        _, text = admonition(render("> [!NOTE] Gut zu wissen\n> Text"))
        self.assertEqual(text, "Gut zu wissen")

    def test_reihenfolge_in_der_konfiguration_egal(self):
        _, text = admonition(render("> [!IMPORTANT]\n> Text", ours_first=True))
        self.assertEqual(text, "Wichtig")

    def test_normales_zitat_bleibt_zitat(self):
        root = render("> Nur ein Zitat.")
        self.assertIsNone(root.find("div"))
        self.assertEqual(root.find("blockquote/p").text, "Nur ein Zitat.")


class AdmonitionOhneTitel(unittest.TestCase):
    def test_admonition_syntax_ebenfalls_deutsch(self):
        _, text = admonition(render("!!! warning\n    Text"))
        self.assertEqual(text, "Warnung")

    def test_typ_ohne_uebersetzung_bleibt(self):
        _, text = admonition(render("!!! example\n    Text"))
        self.assertEqual(text, "Example")


class Titel(unittest.TestCase):
    def test_jeder_github_typ_hat_einen_titel(self):
        self.assertEqual(set(TITLES), {"note", "tip", "important", "warning", "caution"})


if __name__ == "__main__":
    unittest.main()
