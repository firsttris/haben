"""Startseite der Doku unter https://haben.app/ statt https://haben.app/index.html.

Mit use_directory_urls: false (mkdocs.yml) heißt die Startseite index.html, und Zensical schreibt
diese Adresse in den Canonical-Link, in og:url und in die Sitemap. Links von außen zeigen aber auf
https://haben.app/; Google wählt dann / als kanonisch und meldet index.html in der Search Console
als „Duplikat – Google hat eine andere Seite als der Nutzer als kanonische Seite bestimmt“.
Das Theme setzt den Canonical-Link außerhalb eines eigenen Blocks, darum hier nach dem Build.

Aufruf nach dem Build: python scripts/doku-startseite/haben_doku_startseite.py site https://haben.app/
"""

import sys
from pathlib import Path


def startseite_umstellen(site: Path, site_url: str) -> int:
    """Ersetzt site_url + "index.html" durch site_url in index.html und sitemap.xml.

    Nur die ganze Adresse in Anführungszeichen oder im <loc>-Element; andere Seiten bleiben, wie sie
    sind. Gibt die Zahl der Ersetzungen zurück.
    """
    alt = f"{site_url}index.html"
    ersetzungen = (
        (site / "index.html", (f'"{alt}"', f'"{site_url}"')),
        (site / "sitemap.xml", (f"<loc>{alt}</loc>", f"<loc>{site_url}</loc>")),
    )
    anzahl = 0
    for datei, (vorher, nachher) in ersetzungen:
        text = datei.read_text(encoding="utf-8")
        anzahl += text.count(vorher)
        datei.write_text(text.replace(vorher, nachher), encoding="utf-8")
    return anzahl


if __name__ == "__main__":
    print(f"{startseite_umstellen(Path(sys.argv[1]), sys.argv[2])} Adressen der Startseite auf {sys.argv[2]}")
