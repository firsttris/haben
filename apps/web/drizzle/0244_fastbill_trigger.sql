-- Der FastBill-Zugang darf sich ändern; jede Änderung ins Audit-Log (die Funktion lässt den Chiffretext weg).
CREATE TRIGGER fastbill_connection_audit AFTER INSERT OR UPDATE OR DELETE ON fastbill_connection
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Zeilen-Trigger feuern bei TRUNCATE nicht; ohne diesen Trigger leerte TRUNCATE die Tabelle ohne Eintrag im Audit-Log (wie 0201)
CREATE TRIGGER fastbill_connection_no_truncate BEFORE TRUNCATE ON fastbill_connection
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
-- Das Zwischenlager der Ausgabenbelege hält fest, wer eine Ausgabe „ohne Beleg“ freigegeben oder ihren Beleg bereitgelegt
-- hat; die DOCUMENT_URL steht in ciphertext und damit nicht im Audit-Log.
CREATE TRIGGER fastbill_receipts_audit AFTER INSERT OR UPDATE OR DELETE ON fastbill_receipts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER fastbill_receipts_no_truncate BEFORE TRUNCATE ON fastbill_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
