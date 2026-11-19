-- Nummernkreis je Kunde (#1426): die Zählerzeilen der Kundenkreise bekommen den Kontakt in die row_id
-- („2026:<contact_id>“); der gemeinsame Kreis behält seine bisherige row_id, die Historie läuft durch.
-- Stand wie in 0189, nur die year-Alternativen hängen den Kontakt an, wenn die Zeile einen trägt.
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
    coalesce(
      new_json ->> 'id', old_json ->> 'id',
      (new_json ->> 'year') || coalesce(':' || (new_json ->> 'contact_id'), ''),
      (old_json ->> 'year') || coalesce(':' || (old_json ->> 'contact_id'), '')
    ),
    TG_OP,
    old_json,
    new_json
  );
  RETURN NULL;
END;
$$;
