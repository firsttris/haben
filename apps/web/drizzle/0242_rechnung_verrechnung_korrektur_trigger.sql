-- Verrechnungen mit einer Kundenkorrektur sind Buchungen ohne Geldfluss: nur anhängen, Aufhebung als Gegenzeile
-- (reverses_id), nie ändern.
CREATE TRIGGER invoice_settlements_append_only BEFORE UPDATE OR DELETE ON invoice_settlements
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER invoice_settlements_audit AFTER INSERT ON invoice_settlements
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER invoice_settlements_no_truncate BEFORE TRUNCATE ON invoice_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
