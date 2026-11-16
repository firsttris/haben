-- Angaben zum Betrieb für die Verfahrensdokumentation (#860): jede Änderung steht im Audit-Log, damit die
-- Änderungshistorie nachvollziehbar bleibt (GoBD, BMF-Schreiben vom 28.11.2019, Rz. 154). TRUNCATE ginge am Protokoll vorbei.
CREATE TRIGGER procedure_details_audit AFTER INSERT OR UPDATE OR DELETE ON procedure_details
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER procedure_details_no_truncate BEFORE TRUNCATE ON procedure_details
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
