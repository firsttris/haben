-- Kindzeilen festgeschriebener Buchungen und gebuchter Belege: bei UPDATE auch den alten Elternschlüssel
-- prüfen, sonst lassen sie sich per UPDATE … SET entry_id = <andere Buchung> herausziehen.
CREATE OR REPLACE FUNCTION haben_reject_locked_journal_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  locked uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM journal_entries WHERE id = OLD.entry_id AND locked_at IS NOT NULL) THEN
    locked := OLD.entry_id;
  ELSIF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM journal_entries WHERE id = NEW.entry_id AND locked_at IS NOT NULL) THEN
    locked := NEW.entry_id;
  END IF;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'Buchung % ist festgeschrieben', locked USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_reject_locked_document_amount() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  locked uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id AND locked_at IS NOT NULL) THEN
    locked := OLD.document_id;
  ELSIF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND locked_at IS NOT NULL) THEN
    locked := NEW.document_id;
  END IF;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'Beleg % ist gebucht, Beträge sind unveränderlich', locked USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Soll = Haben wird beim Festschreiben geprüft. Eine Buchung, die schon festgeschrieben eingefügt wird, hätte
-- noch keine Zeilen und entginge der Prüfung: Festschreiben geht nur per UPDATE nach den Zeilen.
CREATE OR REPLACE FUNCTION haben_check_journal_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  diff bigint;
  n integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Buchung % erst nach ihren Zeilen festschreiben', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.locked_at IS NOT NULL AND OLD.locked_at IS NULL THEN
    SELECT coalesce(sum(debit) - sum(credit), 0), count(*) INTO diff, n
      FROM journal_lines WHERE entry_id = NEW.id;
    IF n = 0 OR diff <> 0 THEN
      RAISE EXCEPTION 'Buchung % ist nicht ausgeglichen (Differenz %, % Zeilen)', NEW.id, diff, n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_insert_unlocked BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION haben_check_journal_balance();
--> statement-breakpoint
-- Audit: auch die ELSTER-Nachrichten (Request, Antwort, Serverantwort, VaSt-Abholung) weglassen; sie stehen
-- unveränderlich in ihrer eigenen Tabelle. row_id auch für Tabellen mit dem Jahr als Schlüssel.
CREATE OR REPLACE FUNCTION haben_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_json jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_json jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  omit text[] := ARRAY['ciphertext', 'pin_ciphertext', 'protocol_pdf', 'pdf', 'xml', 'logo',
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
