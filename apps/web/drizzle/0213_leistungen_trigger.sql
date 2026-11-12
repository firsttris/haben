-- Abrechenbare Leistungen (#417): Ein Eintrag ist änderbar und, solange er nicht abgerechnet ist, löschbar. Jeder
-- Stand steht im Audit-Log (Hash-Kette), auch das Löschen; deshalb steht, wie bei jeder Tabelle mit aufgezeichnetem
-- Löschen, eine Sperre gegen TRUNCATE davor (0201, truncate.test.ts).

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER service_entries_audit AFTER INSERT OR UPDATE OR DELETE ON service_entries
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER service_entries_no_truncate BEFORE TRUNCATE ON service_entries
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
