-- Standardanhänge für Angebote (#415): Einstellung, frei änderbar; jede Änderung steht im Audit-Log. Gesperrt sind
-- erst die Kopien an festgeschriebenen Angeboten (quote_attachments_locked, 0164).

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER quote_default_attachments_audit AFTER INSERT OR UPDATE OR DELETE ON quote_default_attachments
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
