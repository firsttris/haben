-- Der FastBill-Zugang darf sich ändern; jede Änderung ins Audit-Log (die Funktion lässt den Chiffretext weg).
-- fastbill_receipts bekommt keinen Trigger: Sie ist nur ein Zwischenlager vor dem Archiv, und document_url ist ein
-- Link mit eigenem Schlüssel, der nicht ins Protokoll gehört.
CREATE TRIGGER fastbill_connection_audit AFTER INSERT OR UPDATE OR DELETE ON fastbill_connection
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Zeilen-Trigger feuern bei TRUNCATE nicht; ohne diesen Trigger leerte TRUNCATE die Tabelle ohne Eintrag im Audit-Log (wie 0201)
CREATE TRIGGER fastbill_connection_no_truncate BEFORE TRUNCATE ON fastbill_connection
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
