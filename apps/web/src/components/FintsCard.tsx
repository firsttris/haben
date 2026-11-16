import { FINTS_ANLEITUNG } from "./FintsAbruf.tsx";

/**
 * Einstellungen › Bank: ob der Abruf über FinTS (#654) eingerichtet ist. Die Registrierungsnummer setzt nur der
 * Betreiber (FINTS_PRODUKT_ID), deshalb gibt es hier kein Feld und die Nummer erscheint nicht.
 */
export function FintsCard({ configured }: { configured: boolean }) {
  return (
    <section className="card" aria-labelledby="fints-heading">
      <h2 id="fints-heading">Kontoabruf über FinTS</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Über FinTS (früher HBCI) holt Haben die Umsätze direkt bei deiner Bank, ohne Enable Banking. Dafür braucht jede Installation eine eigene
        Registrierungsnummer der Deutschen Kreditwirtschaft; Haben bringt keine mit. Wer Haben betreibt, trägt sie als <code>FINTS_PRODUKT_ID</code> ein.{" "}
        <a href={FINTS_ANLEITUNG} target="_blank" rel="noreferrer">
          Anleitung
        </a>
      </p>
      {configured ? (
        <div className="banner banner-ok" role="status">
          Eingerichtet. Unter Bank verbindest du deine Bank mit „Über FinTS verbinden“.
        </div>
      ) : (
        <div className="banner banner-info" role="status">
          Nicht eingerichtet: <code>FINTS_PRODUKT_ID</code> ist nicht gesetzt.
        </div>
      )}
    </section>
  );
}
