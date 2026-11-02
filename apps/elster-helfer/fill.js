/*
 * Haben für Mein ELSTER: trägt Werte aus Haben in die offene Formularseite ein. Reine Logik ohne Chrome-APIs, damit
 * sie sich in einem Browser ohne Erweiterung testen lässt (apps/web/e2e/elster-helfer.spec.ts).
 *
 * Mein ELSTER benennt seine Eingabefelder nach den amtlichen Feldkennungen, die auch im ERiC-XML stehen:
 *   EÜR 2025: fields[eruEUERBEinUSt_StPflichtSumE6000401]
 *   USt 2025: fields[eruUSt2AUmsaetzeTabelleUms_allgE3003303]
 * Jedes Feld trägt außerdem seinen ERiC-Pfad: data-eru-name="/EUER/BEin/USt_StPflicht/Sum/E6000401".
 *
 * Summenfelder der EÜR sind in Mein ELSTER gesperrt; Mein ELSTER rechnet sie aus Einzelposten (…/Einz/…, Bezeichnung
 * und Betrag), die man mit „Eintrag übernehmen“ hinzufügt. Für eine gesperrte Summe füllt die Erweiterung deshalb die
 * freie Einzelposten-Zeile daneben und markiert den Knopf; übernehmen klickt der Nutzer.
 * Mehrfachzeilen, die Haben selbst mehrfach liefert (Anlagegüter, Kinder), trägt der Nutzer von Hand ein; die
 * Erweiterung zeigt ihre Werte zum Abschreiben.
 *
 * Die Erweiterung klickt nie: Seiten wechseln, prüfen und absenden macht der Nutzer.
 */
(function (root) {
  const FORMAT = "haben-mein-elster";

  /** Feldkennung am Ende des Feldnamens, sonst null */
  function kennungOf(name) {
    const match = /(E\d{7})\]$/.exec(name || "");
    return match ? match[1] : null;
  }

  function istMehrfachzeile(name) {
    return /^mzbs\[/.test(name) || name.includes(".newItem.");
  }

  /** Formular und Jahr aus dem Pfad: /eportal/interpreter/eingabe/euer-2025/… */
  function formularAusPfad(pathname) {
    const match = /\/eportal\/interpreter\/eingabe\/([a-z0-9]+)-(\d{4})(?:\/|$)/.exec(pathname || "");
    return match ? { formular: match[1], jahr: Number(match[2]) } : null;
  }

  /** Prüft die eingefügten Werte aus Haben; Fehlermeldung oder null */
  function pruefeWerte(werte) {
    if (!werte || werte.format !== FORMAT) return "Das sind keine Werte aus Haben („Werte für Mein ELSTER kopieren“).";
    if (werte.version !== 1) return `Version ${werte.version} kennt diese Erweiterung nicht. Bitte die Erweiterung aktualisieren.`;
    if (!Array.isArray(werte.felder) || !/^[a-z0-9]+$/.test(werte.formular) || !Number.isInteger(werte.jahr)) return "Die Werte sind unvollständig.";
    return null;
  }

  function beschriftung(doc, el) {
    const label = el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    return ((label && label.textContent) || el.getAttribute("aria-label") || el.name).trim().replace(/\s+/g, " ");
  }

  function feuern(el, ...typen) {
    for (const typ of typen) el.dispatchEvent(new Event(typ, { bubbles: true }));
  }

  /** Aktueller Wert eines Felds, vergleichbar mit dem Wert aus Haben */
  function vorhanden(doc, el) {
    if (el.type === "radio") {
      const gewaehlt = [...doc.getElementsByName(el.name)].find((r) => r.checked);
      return gewaehlt ? gewaehlt.value : "";
    }
    if (el.type === "checkbox") return el.checked ? "1" : "";
    return el.value.trim();
  }

  /** Setzt den Wert; false, wenn das Feld ihn nicht annehmen kann (z. B. Auswahl ohne passende Option) */
  function setzen(doc, el, wert) {
    if (el.type === "radio") {
      const option = [...doc.getElementsByName(el.name)].find((r) => r.value === wert);
      if (!option) return false;
      option.checked = true;
      feuern(option, "click", "change");
      return true;
    }
    if (el.type === "checkbox") {
      el.checked = wert === "1" || wert === "true" || wert === "X";
      feuern(el, "click", "change");
      return true;
    }
    if (el.tagName === "SELECT") {
      if (![...el.options].some((o) => o.value === wert)) return false;
      el.value = wert;
      feuern(el, "change");
      return true;
    }
    el.focus();
    el.value = wert;
    feuern(el, "input", "change", "blur");
    return true;
  }

  const MARKE = "2px solid #1f6f5c";
  const BEZEICHNUNG = "Laut Haben";

  /**
   * Die freie Einzelposten-Zeile zu einer gesperrten Summe: …/Sum/E6000401 → Felder …/Einz/… (Bezeichnung, Betrag) und
   * der Knopf „Eintrag übernehmen“ ihrer Gruppe. null, wenn es keine passende freie Zeile gibt.
   */
  function einzelposten(doc, summe) {
    const pfad = summe.getAttribute("data-eru-name") || "";
    const match = /^(.*)\/Sum\/E\d{7}$/.exec(pfad);
    if (!match) return null;
    const felder = [...doc.querySelectorAll("input[data-eru-name]")].filter(
      (i) => !i.disabled && i.type !== "hidden" && i.getAttribute("data-eru-name").startsWith(`${match[1]}/Einz/`) && istMehrfachzeile(i.name),
    );
    if (felder.length !== 2 || felder.some((f) => f.value.trim() !== "")) return null;
    const betrag = felder.find((f) => /betrag/i.test(beschriftung(doc, f))) || felder[1];
    const bezeichnung = felder.find((f) => f !== betrag);
    const knopf = gruppenKnopf(betrag);
    return { bezeichnung, betrag, knopf };
  }

  /** Der Knopf „Eintrag übernehmen“ im kleinsten Abschnitt um das Feld, der genau einen solchen Knopf hat */
  function gruppenKnopf(el) {
    for (let box = el.parentElement; box; box = box.parentElement) {
      const knoepfe = [...box.querySelectorAll("button")].filter((b) => /Eintrag übernehmen/.test(b.getAttribute("aria-label") || b.textContent));
      if (knoepfe.length === 1) return knoepfe[0];
      if (knoepfe.length > 1) return null;
    }
    return null;
  }

  /**
   * Trägt alle Werte ein, deren Feld auf dieser Seite steht. Ein Feld, in dem schon etwas anderes steht, bleibt
   * unverändert und wird gemeldet. Liefert, was eingetragen, schon gleich, abweichend oder von Hand einzutragen ist.
   */
  function ausfuellen(doc, werte) {
    const einfach = new Map();
    const mehrfach = new Map();
    for (const feld of werte.felder) {
      const ziel = feld.zeile === null || feld.zeile === undefined ? einfach : mehrfach;
      if (!ziel.has(feld.kennung)) ziel.set(feld.kennung, []);
      ziel.get(feld.kennung).push(feld);
    }
    const ergebnis = { eingetragen: [], uebernehmen: [], gleich: [], abweichend: [], vonHand: [], nichtMoeglich: [], kennungen: [] };
    const gesehen = new Set();
    for (const el of doc.querySelectorAll("input[name], select[name], textarea[name]")) {
      if (el.type === "hidden") continue;
      const kennung = kennungOf(el.name);
      if (!kennung || (el.type === "radio" && gesehen.has(el.name))) continue;
      gesehen.add(el.name);
      const label = beschriftung(doc, el);
      if (istMehrfachzeile(el.name)) {
        for (const feld of [...(mehrfach.get(kennung) || []), ...(einfach.get(kennung) || [])]) {
          ergebnis.vonHand.push({ kennung, wert: feld.wert, zeile: feld.zeile ?? null, label });
        }
        if (mehrfach.has(kennung) || einfach.has(kennung)) ergebnis.kennungen.push(kennung);
        continue;
      }
      const feld = (einfach.get(kennung) || [])[0];
      if (!feld) continue;
      ergebnis.kennungen.push(kennung);
      const jetzt = vorhanden(doc, el);
      if (jetzt === feld.wert) ergebnis.gleich.push({ kennung, wert: feld.wert, label });
      else if (jetzt !== "") ergebnis.abweichend.push({ kennung, wert: feld.wert, vorhanden: jetzt, label });
      else if (el.disabled) {
        // Gesperrte Summe: die Einzelposten-Zeile daneben füllen, übernehmen klickt der Nutzer
        const zeile = einzelposten(doc, el);
        if (zeile && setzen(doc, zeile.bezeichnung, BEZEICHNUNG) && setzen(doc, zeile.betrag, feld.wert)) {
          for (const markiert of [zeile.bezeichnung, zeile.betrag, zeile.knopf]) if (markiert) markiert.style.outline = MARKE;
          ergebnis.uebernehmen.push({ kennung, wert: feld.wert, label, knopf: Boolean(zeile.knopf) });
        } else ergebnis.nichtMoeglich.push({ kennung, wert: feld.wert, label });
      } else if (setzen(doc, el, feld.wert)) {
        ergebnis.eingetragen.push({ kennung, wert: feld.wert, label });
        el.style.outline = MARKE;
      } else ergebnis.nichtMoeglich.push({ kennung, wert: feld.wert, label });
    }
    return ergebnis;
  }

  root.HabenElster = { FORMAT, kennungOf, formularAusPfad, pruefeWerte, ausfuellen };
})(globalThis);
