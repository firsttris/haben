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

--> statement-breakpoint
-- Nach der Schema-Migration regulär als Custom-Migration erzeugen.
-- Unbekannte alte Verantwortlichkeit nicht erfinden: vorhandene Geheimnisse erhalten, explizite Übernahme verlangen.
UPDATE mcp_tokens SET disabled_at=now(), disabled_reason='verantwortung-unbekannt' WHERE responsible_id IS NULL;
--> statement-breakpoint
UPDATE company SET calendar_token_disabled_at=now(), calendar_token_disabled_reason='verantwortung-unbekannt' WHERE calendar_token_hash IS NOT NULL AND calendar_token_responsible_id IS NULL;
--> statement-breakpoint
CREATE TRIGGER token_events_append_only BEFORE UPDATE OR DELETE ON token_events FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER token_events_audit AFTER INSERT ON token_events FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER local_owner_recoveries_append_only BEFORE UPDATE OR DELETE ON local_owner_recoveries FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER local_owner_recoveries_audit AFTER INSERT ON local_owner_recoveries FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_user_role_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role = 'inhaber'
       AND current_setting('haben.actor', true) = 'system:local-owner-recovery'
       AND EXISTS (SELECT 1 FROM local_owner_recoveries WHERE user_id=NEW.id AND transaction_id=pg_current_xact_id()::text)
    THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Die Rolle eines Kontos lässt sich nicht ändern' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_prepare_local_owner(target_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(114767471930881) THEN
    RAISE EXCEPTION 'Haben läuft noch. Alle Instanzen stoppen';
  END IF;
  IF current_setting('haben.actor', true) IS DISTINCT FROM 'system:local-owner-recovery' THEN
    RAISE EXCEPTION 'Lokale Vorbereitung verlangt den Betreiberkontext';
  END IF;
  PERFORM 1 FROM "user" WHERE id=target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Konto nicht gefunden'; END IF;
  IF EXISTS (SELECT 1 FROM "user" WHERE role='inhaber' AND id<>target_id) THEN
    RAISE EXCEPTION 'Anderen lokalen Inhaber nicht ersetzen';
  END IF;
  INSERT INTO local_owner_recoveries(user_id,transaction_id) VALUES(target_id,pg_current_xact_id()::text);
  UPDATE "user" SET role='inhaber', locked_at=NULL WHERE id=target_id;
END;
$$;
