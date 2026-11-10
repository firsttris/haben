-- Übernommene Auszahlungen der App-Stores sind unveränderlich und stehen im Audit-Log

CREATE TRIGGER store_payouts_append_only BEFORE UPDATE OR DELETE ON store_payouts
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER store_payouts_audit AFTER INSERT ON store_payouts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
