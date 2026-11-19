/** Einstellungen und Stammdaten als Datei für eine neue Instanz (#488, Einstellungen › Export) */
export function SettingsExportCard() {
  return (
    <section className="card" aria-labelledby="settings-export-heading">
      <h2 id="settings-export-heading">Einstellungen exportieren</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Firmendaten, persönliche Angaben, Beleggestaltung, Textbausteine, E-Mail-Vorlagen, Nummernformate, eigene Konten, Artikel und Kontakte als ZIP-Datei,
        etwa um nach dem Testen mit einer neuen Instanz zu beginnen. Zugangsdaten (Bank, ELSTER-Zertifikat, E-Mail-Versand, KI und API), Zählerstände der
        Rechnungs- und Angebotsnummern und alles Gebuchte gehen nicht mit.
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        Die Datei enthält Steuernummer, Steuer-ID und Bankverbindung: so sicher aufbewahren wie ein Backup.
      </p>
      <div className="actions">
        <a className="btn" href="/api/einstellungen/export" download>
          Datei herunterladen
        </a>
      </div>
    </section>
  );
}
