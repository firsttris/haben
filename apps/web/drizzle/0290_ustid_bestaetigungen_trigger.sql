-- Bestätigungen ausländischer USt-IdNrn. beim BZSt (#1385): Nachweis nach UStAE 18e.1 Abs. 2 Sätze 3 bis 5, deshalb nur anhängbar wie
-- zm_submissions, jede Zeile im Änderungsprotokoll (audit_log) und gegen TRUNCATE gesperrt
CREATE TRIGGER ustid_bestaetigungen_append_only BEFORE UPDATE OR DELETE ON ustid_bestaetigungen
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER ustid_bestaetigungen_audit AFTER INSERT ON ustid_bestaetigungen
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER ustid_bestaetigungen_no_truncate BEFORE TRUNCATE ON ustid_bestaetigungen
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
