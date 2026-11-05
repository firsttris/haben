-- Dauerbelege (Roadmap Platz 8): Die Vorlagen bleiben änderbar, jede Änderung steht im Audit-Log. Die daraus angelegten
-- Belege sind gewöhnliche Belege: gesperrt ab dem Buchen (documents_locked aus 0005) und versiegelt mit allen Spalten,
-- also auch recurring_document_id und recurring_period; die Siegel-Funktionen bleiben unverändert.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER recurring_documents_audit AFTER INSERT OR UPDATE OR DELETE ON recurring_documents
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
SELECT set_config('haben.actor', '', true);
