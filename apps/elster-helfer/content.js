/* global chrome, HabenElster */
/*
 * Läuft auf jeder Formularseite von Mein ELSTER. Trägt die Werte aus Haben ein und zeigt eine Leiste: was auf dieser
 * Seite eingetragen wurde, was abweicht, was von Hand einzutragen ist und was auf keiner bisher besuchten Seite stand.
 * Die Werte liegen in chrome.storage.session und sind weg, sobald der Browser geschlossen wird.
 */
(async () => {
  const { werte, gefunden = {} } = await chrome.storage.session.get(["werte", "gefunden"]);
  if (!werte) return;
  const hier = HabenElster.formularAusPfad(location.pathname);
  if (!hier) return;
  const schluessel = `${werte.formular}-${werte.jahr}`;

  if (hier.formular !== werte.formular || hier.jahr !== werte.jahr) {
    leiste(`Geladen sind Werte für ${werte.formular.toUpperCase()} ${werte.jahr}, dies ist ${hier.formular.toUpperCase()} ${hier.jahr}. Nichts eingetragen.`, []);
    return;
  }

  async function eintragen() {
    const ergebnis = HabenElster.ausfuellen(document, werte);
    const bisher = new Set([...(gefunden[schluessel] || []), ...ergebnis.kennungen]);
    gefunden[schluessel] = [...bisher];
    await chrome.storage.session.set({ gefunden });
    const offen = werte.felder.filter((f) => !bisher.has(f.kennung));
    leiste(zusammenfassung(ergebnis, offen.length), abschnitte(ergebnis, offen));
  }

  function zusammenfassung(e, offen) {
    const teile = [`${e.eingetragen.length} eingetragen`];
    if (e.uebernehmen.length) teile.push(`${e.uebernehmen.length} zum Übernehmen`);
    if (e.gleich.length) teile.push(`${e.gleich.length} schon gleich`);
    if (e.abweichend.length) teile.push(`${e.abweichend.length} abweichend`);
    if (e.vonHand.length) teile.push(`${e.vonHand.length} von Hand`);
    teile.push(`${offen} noch auf anderen Seiten`);
    return `${werte.formular.toUpperCase()} ${werte.jahr}: ${teile.join(", ")}.`;
  }

  function abschnitte(e, offen) {
    const zeile = (f) => `${f.label || f.pfad?.join(" › ") || ""} (${f.kennung}${f.zeile ? `, Zeile ${f.zeile}` : ""}): ${f.wert}`;
    return [
      { titel: "Eingetragen (grün umrandet)", eintraege: e.eingetragen.map(zeile) },
      { titel: "Vorbereitet: bei der grün umrandeten Zeile auf „Eintrag übernehmen“ klicken", eintraege: e.uebernehmen.map(zeile) },
      { titel: "Abweichend, nicht überschrieben", eintraege: e.abweichend.map((f) => `${zeile(f)} – im Formular steht ${f.vorhanden}`) },
      { titel: "Von Hand eintragen (erst Zeile anlegen)", eintraege: e.vonHand.map(zeile) },
      { titel: "Ließ sich nicht setzen", eintraege: e.nichtMoeglich.map(zeile) },
      { titel: "Noch auf keiner besuchten Seite gefunden", eintraege: offen.map(zeile) },
    ].filter((a) => a.eintraege.length > 0);
  }

  function leiste(text, teile) {
    document.getElementById("haben-elster-leiste")?.remove();
    const host = document.createElement("div");
    host.id = "haben-elster-leiste";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        aside { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(420px, calc(100vw - 32px));
          max-height: 60vh; overflow: auto; background: #fff; color: #1b1b1b; border: 2px solid #1f6f5c; border-radius: 8px;
          box-shadow: 0 6px 24px rgba(0,0,0,.2); font: 14px/1.4 system-ui, sans-serif; padding: 12px; }
        h2 { font-size: 15px; margin: 0 0 6px; }
        p { margin: 0 0 8px; }
        details { margin: 6px 0; }
        ul { margin: 4px 0 0; padding-left: 18px; }
        li { margin: 2px 0; word-break: break-word; }
        .actions { display: flex; gap: 8px; margin-top: 8px; }
        button { font: inherit; padding: 4px 10px; border: 1px solid #1f6f5c; border-radius: 6px; background: #fff; cursor: pointer; }
        button:focus-visible { outline: 2px solid #1f6f5c; outline-offset: 2px; }
      </style>
      <aside aria-label="Haben für Mein ELSTER">
        <h2>Haben für Mein ELSTER</h2>
        <p></p>
        <div class="teile"></div>
        <p><small>Prüfen und absenden machst du in Mein ELSTER. Die Erweiterung klickt nie.</small></p>
        <div class="actions"><button type="button" class="neu">Erneut eintragen</button><button type="button" class="zu">Schließen</button></div>
      </aside>`;
    shadow.querySelector("p").textContent = text;
    const container = shadow.querySelector(".teile");
    for (const teil of teile) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `${teil.titel} (${teil.eintraege.length})`;
      const ul = document.createElement("ul");
      for (const eintrag of teil.eintraege) {
        const li = document.createElement("li");
        li.textContent = eintrag;
        ul.append(li);
      }
      details.append(summary, ul);
      container.append(details);
    }
    shadow.querySelector(".neu").addEventListener("click", () => void eintragen());
    shadow.querySelector(".zu").addEventListener("click", () => host.remove());
    document.body.append(host);
  }

  await eintragen();
})();
