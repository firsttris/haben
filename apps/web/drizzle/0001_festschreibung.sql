-- GoBD: festgeschriebene Zeilen sind unveränderlich, Protokolle nur anhängen.

CREATE FUNCTION haben_reject_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION '% % ist festgeschrieben und kann nicht geändert werden', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% darf nur ergänzt werden', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_json jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_json jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  -- Binärdaten nicht ins Protokoll kopieren
  old_json := old_json - 'ciphertext' - 'protocol_pdf';
  new_json := new_json - 'ciphertext' - 'protocol_pdf';
  INSERT INTO audit_log (actor, table_name, row_id, action, old_value, new_value)
  VALUES (
    nullif(current_setting('haben.actor', true), ''),
    TG_TABLE_NAME,
    coalesce(new_json ->> 'id', old_json ->> 'id'),
    TG_OP,
    old_json,
    new_json
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER vat_returns_locked
  BEFORE UPDATE OR DELETE ON vat_returns
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked();
--> statement-breakpoint
CREATE TRIGGER vat_return_submissions_append_only
  BEFORE UPDATE OR DELETE ON vat_return_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER company_audit
  AFTER INSERT OR UPDATE OR DELETE ON company
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER elster_certificates_audit
  AFTER INSERT OR UPDATE OR DELETE ON elster_certificates
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER vat_returns_audit
  AFTER INSERT OR UPDATE OR DELETE ON vat_returns
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER vat_return_submissions_audit
  AFTER INSERT ON vat_return_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
