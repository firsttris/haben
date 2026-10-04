-- Kassenbuch: nur anhängen, jede Zeile im Protokoll
CREATE TRIGGER cash_entries_append_only BEFORE UPDATE OR DELETE ON cash_entries FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER cash_entries_audit AFTER INSERT ON cash_entries FOR EACH ROW EXECUTE FUNCTION haben_audit();
