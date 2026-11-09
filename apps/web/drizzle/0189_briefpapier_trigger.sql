-- Briefpapier (#113). Das Bild ist Binärdatei wie Logo, PDF und XML: Im Protokoll steht nur, dass und wann es sich geändert hat.
CREATE OR REPLACE FUNCTION haben_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_json jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_json jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  omit text[] := ARRAY['ciphertext', 'pin_ciphertext', 'protocol_pdf', 'pdf', 'xml', 'logo', 'background',
                       'request_xml', 'response_xml', 'server_response_xml', 'abholung'];
BEGIN
  old_json := old_json - omit;
  new_json := new_json - omit;
  INSERT INTO audit_log (actor, table_name, row_id, action, old_value, new_value)
  VALUES (
    nullif(current_setting('haben.actor', true), ''),
    TG_TABLE_NAME,
    coalesce(new_json ->> 'id', old_json ->> 'id', new_json ->> 'year', old_json ->> 'year'),
    TG_OP,
    old_json,
    new_json
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER letterhead_background_audit AFTER INSERT OR UPDATE OR DELETE ON letterhead_background
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
