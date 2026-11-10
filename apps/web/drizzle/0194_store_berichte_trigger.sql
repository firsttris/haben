-- Abgerufene Finanzberichte der App-Stores sind unveränderlich; Zugänge (ohne den verschlüsselten Schlüssel) und Berichte ins Audit-Log

CREATE TRIGGER store_reports_append_only BEFORE UPDATE OR DELETE ON store_reports
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER store_reports_audit AFTER INSERT ON store_reports
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER store_connections_audit AFTER INSERT OR UPDATE OR DELETE ON store_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();

--> statement-breakpoint
-- Übernommene Auszahlungen der App-Stores sind unveränderlich und stehen im Audit-Log

CREATE TRIGGER store_payouts_append_only BEFORE UPDATE OR DELETE ON store_payouts
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER store_payouts_audit AFTER INSERT ON store_payouts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
