-- #654: Verbindungen für den FinTS-Abruf ändern sich (Status, letzter Abruf, Konten); jede Änderung ins Protokoll.
-- PIN und Bankdaten (BPD, UPD, Kundensystem-ID) liegen verschlüsselt in ciphertext und bleiben draußen (haben_audit).
CREATE TRIGGER fints_connections_audit AFTER INSERT OR UPDATE OR DELETE ON fints_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER fints_connections_no_truncate BEFORE TRUNCATE ON fints_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
