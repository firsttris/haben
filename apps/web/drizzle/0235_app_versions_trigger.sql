-- Eingesetzte Versionen (#841): nur anhängbar, im Änderungsprotokoll (audit_log) mitgeschnitten, gegen TRUNCATE gesperrt.
CREATE TRIGGER app_versions_append_only BEFORE UPDATE OR DELETE ON app_versions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER app_versions_audit AFTER INSERT ON app_versions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER app_versions_no_truncate BEFORE TRUNCATE ON app_versions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
