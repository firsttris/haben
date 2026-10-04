-- Das Logo ist Binärdatei wie PDF und XML: im Protokoll steht nur, dass und wann es sich geändert hat (mit SHA-256).
CREATE OR REPLACE FUNCTION haben_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_json jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_json jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  -- Binärdaten und Geheimnisse nicht ins Protokoll kopieren
  old_json := old_json - 'ciphertext' - 'pin_ciphertext' - 'protocol_pdf' - 'pdf' - 'xml' - 'logo';
  new_json := new_json - 'ciphertext' - 'pin_ciphertext' - 'protocol_pdf' - 'pdf' - 'xml' - 'logo';
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
CREATE TRIGGER company_logo_audit AFTER INSERT OR UPDATE OR DELETE ON company_logo
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
