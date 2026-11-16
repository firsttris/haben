-- #266: Fragen zur Einrichtung und ausgeblendete Bereiche stehen im Audit-Log, wie jede Änderung an den Einstellungen
CREATE TRIGGER einrichtung_audit AFTER INSERT OR UPDATE OR DELETE ON einrichtung
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER einrichtung_no_truncate BEFORE TRUNCATE ON einrichtung
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
