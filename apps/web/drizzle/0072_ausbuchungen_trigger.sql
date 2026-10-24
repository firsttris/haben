-- Ausbuchungen sind wie Zuordnungen unveränderlich; aufgehoben wird per Gegenzeile. Jede Änderung ins Audit-Log.
CREATE TRIGGER write_offs_append_only BEFORE UPDATE OR DELETE ON write_offs
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER write_offs_audit AFTER INSERT ON write_offs
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
