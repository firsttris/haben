"""Adressen mit Schrägstrich für die Doku: haben.app/api/ führt auf haben.app/api.html.

Die Seiten heißen api.html (use_directory_urls: false in mkdocs.yml, wegen der relativen Bildpfade).
GitHub Pages liefert api.html auch unter /api aus, unter /api/ aber die 404-Seite; Browser
ergänzen den Schrägstrich gern aus dem Verlauf. Ein Ordner api/ mit index.html schickt von dort
weiter auf ../api.html, mit Anker.

Aufruf nach dem Build: python scripts/doku-kurzlinks/haben_doku_kurzlinks.py site
"""

import html
import sys
from pathlib import Path

# Keine Weiterleitung für die Startseite (/ gibt es schon) und die 404-Seite
OHNE_KURZLINK = {"index", "404"}


def weiterleitung(ziel: str) -> str:
    """Seite, die sofort auf ziel (relativ, z. B. ../api.html) weiterleitet; der Anker bleibt erhalten."""
    href = html.escape(ziel, quote=True)
    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url={href}">
<title>Weiterleitung</title>
<script>location.replace({ziel!r} + location.hash)</script>
</head>
<body><p>Weiter zu <a href="{href}">{html.escape(ziel.removeprefix("../"))}</a></p></body>
</html>
"""


def kurzlinks_anlegen(site: Path) -> list[str]:
    """Legt für jede Seite site/<name>.html den Ordner site/<name>/ mit Weiterleitung an.

    Ordner, die es schon gibt (z. B. assets/), bleiben unberührt. Gibt die angelegten Namen zurück.
    """
    angelegt = []
    for seite in sorted(site.glob("*.html")):
        ordner = site / seite.stem
        if seite.stem in OHNE_KURZLINK or ordner.exists():
            continue
        ordner.mkdir()
        (ordner / "index.html").write_text(weiterleitung(f"../{seite.name}"), encoding="utf-8")
        angelegt.append(seite.stem)
    return angelegt


if __name__ == "__main__":
    namen = kurzlinks_anlegen(Path(sys.argv[1]))
    print(f"{len(namen)} Kurzlinks: {', '.join(namen)}")
