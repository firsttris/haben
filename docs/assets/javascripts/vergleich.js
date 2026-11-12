// Schieberegler hell/dunkel auf der Startseite (index.md, .theme-vergleich): Ziehen an der H-Kachel oder an der
// Linie, Pfeiltasten, Pos1 und Ende auf der Kachel. Ohne Skript bleibt die Teilung in der Mitte stehen.
// Zensical lädt Seiten mit navigation.instant ohne Neuladen nach; document$ meldet jede geladene Seite.
(() => {
  const einrichten = () => {
    for (const box of document.querySelectorAll(".theme-vergleich:not([data-bereit])")) {
      box.dataset.bereit = "";
      const griff = box.querySelector(".theme-vergleich-griff");
      const linie = box.querySelector(".theme-vergleich-linie");
      let pos = 50;
      const setzen = (wert) => {
        pos = Math.min(100, Math.max(0, wert));
        box.style.setProperty("--pos", `${pos}%`);
        griff.setAttribute("aria-valuenow", String(Math.round(pos)));
        griff.setAttribute("aria-valuetext", `${Math.round(pos)} % hell`);
      };
      const ziehen = (start) => {
        start.preventDefault();
        const ziel = start.currentTarget;
        ziel.setPointerCapture(start.pointerId);
        box.classList.add("zieht");
        const bewegen = (e) => {
          const rect = box.getBoundingClientRect();
          setzen(((e.clientX - rect.left) / rect.width) * 100);
        };
        const ende = () => {
          box.classList.remove("zieht");
          ziel.removeEventListener("pointermove", bewegen);
          ziel.removeEventListener("pointerup", ende);
          ziel.removeEventListener("pointercancel", ende);
        };
        ziel.addEventListener("pointermove", bewegen);
        ziel.addEventListener("pointerup", ende);
        ziel.addEventListener("pointercancel", ende);
      };
      griff.addEventListener("pointerdown", ziehen);
      linie.addEventListener("pointerdown", ziehen);
      griff.addEventListener("keydown", (e) => {
        const schritt = e.shiftKey ? 10 : 2;
        const tasten = { ArrowLeft: pos - schritt, ArrowDown: pos - schritt, ArrowRight: pos + schritt, ArrowUp: pos + schritt, Home: 0, End: 100 };
        if (e.key in tasten) {
          e.preventDefault();
          setzen(tasten[e.key]);
        }
      });
      setzen(50);
    }
  };
  if (typeof document$ !== "undefined") document$.subscribe(einrichten);
  else document.addEventListener("DOMContentLoaded", einrichten);
})();
