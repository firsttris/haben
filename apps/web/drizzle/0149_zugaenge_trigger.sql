-- Zugänge (Roadmap Platz 10, Stufe 1): Konten, Einladungen und Anmeldungen stehen im Audit-Log, damit jeder Akteur
-- (die Nutzer-ID in audit_log.actor) mit Name, E-Mail und Rolle in derselben Hash-Kette nachzulesen ist.
-- Passwörter und Sitzungstokens liegen in account und session; die bleiben wie bisher draußen.

-- Die Rolle eines Kontos ändert sich nie: aus der Steuerberatung wird kein Inhaber, auch nicht durch einen Fehler im Code
CREATE FUNCTION haben_user_role_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Die Rolle eines Kontos lässt sich nicht ändern' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_role_fixed BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION haben_user_role_fixed();
--> statement-breakpoint
CREATE TRIGGER user_audit AFTER INSERT OR UPDATE OR DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Eine Einladung wird nur einmal eingelöst oder zurückgezogen; Inhalt und Frist bleiben, gelöscht wird nichts
CREATE FUNCTION haben_check_invitation_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Einladungen werden nicht gelöscht, nur zurückgezogen' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.role IS DISTINCT FROM OLD.role OR NEW.label IS DISTINCT FROM OLD.label
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
     OR (OLD.accepted_email IS NOT NULL AND NEW.accepted_email IS DISTINCT FROM OLD.accepted_email)
     OR (OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Einladung % ist schon eingelöst oder zurückgezogen', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invitations_check BEFORE UPDATE OR DELETE ON invitations
  FOR EACH ROW EXECUTE FUNCTION haben_check_invitation_update();
--> statement-breakpoint
CREATE TRIGGER invitations_audit AFTER INSERT OR UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER user_logins_append_only BEFORE UPDATE OR DELETE ON user_logins
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER user_logins_audit AFTER INSERT ON user_logins
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
