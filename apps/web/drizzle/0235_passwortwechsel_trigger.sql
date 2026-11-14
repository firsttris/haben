-- Custom SQL migration file, put your code below! --
CREATE TRIGGER password_changes_append_only BEFORE UPDATE OR DELETE ON password_changes
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER password_changes_audit AFTER INSERT ON password_changes
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER password_changes_no_truncate BEFORE TRUNCATE ON password_changes
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
