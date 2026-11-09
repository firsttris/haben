-- SSO mit Authelia-Gruppen: Einrichtung je Issuer, bestätigte externe Rollen und Übernahmen durch den Betreiber stehen im
-- Audit-Log, damit nachvollziehbar bleibt, wann ein Konto welche Rolle bekam oder verlor und wer es zugeordnet hat.

-- Die Einrichtung je Issuer und die Übernahmen werden nur angehängt, nie geändert oder gelöscht
CREATE TRIGGER sso_issuers_append_only BEFORE UPDATE OR DELETE ON sso_issuers
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sso_issuers_audit AFTER INSERT ON sso_issuers
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER sso_takeovers_append_only BEFORE UPDATE OR DELETE ON sso_takeovers
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sso_takeovers_audit AFTER INSERT ON sso_takeovers
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Jede Bestätigung, Herabstufung und jeder Entzug der Rolle
CREATE TRIGGER sso_roles_audit AFTER INSERT OR UPDATE OR DELETE ON sso_roles
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
