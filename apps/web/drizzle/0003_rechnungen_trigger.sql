-- Rechnungen, Kontakte und Buchungen: Festschreibung, Versionierung, Audit.

-- PDF und XML nicht ins Audit-Log kopieren
CREATE OR REPLACE FUNCTION haben_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_json jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_json jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  -- Binärdaten nicht ins Protokoll kopieren
  old_json := old_json - 'ciphertext' - 'protocol_pdf' - 'pdf' - 'xml';
  new_json := new_json - 'ciphertext' - 'protocol_pdf' - 'pdf' - 'xml';
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

CREATE FUNCTION haben_reject_locked_invoice_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id = parent AND locked_at IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND locked_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Rechnung % ist festgeschrieben, Positionen sind unveränderlich', parent
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_reject_locked_journal_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entries WHERE id = parent AND locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Buchung % ist festgeschrieben', parent USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Beim Festschreiben muss Soll = Haben sein.
CREATE FUNCTION haben_check_journal_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  diff bigint;
  n integer;
BEGIN
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
CREATE FUNCTION haben_contact_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_contact_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO contact_versions (contact_id, version, data) VALUES (NEW.id, NEW.version, to_jsonb(NEW));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_counter_monotonic() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.last < OLD.last THEN
    RAISE EXCEPTION 'Rechnungsnummern dürfen nicht zurückgesetzt werden' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_locked BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked();
--> statement-breakpoint
CREATE TRIGGER invoice_lines_locked BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_invoice_line();
--> statement-breakpoint
CREATE TRIGGER journal_entries_locked BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked();
--> statement-breakpoint
CREATE TRIGGER journal_entries_balance BEFORE UPDATE OF locked_at ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION haben_check_journal_balance();
--> statement-breakpoint
CREATE TRIGGER journal_lines_locked BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_journal_line();
--> statement-breakpoint
CREATE TRIGGER contacts_version BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION haben_contact_version();
--> statement-breakpoint
CREATE TRIGGER contacts_snapshot AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION haben_contact_snapshot();
--> statement-breakpoint
CREATE TRIGGER contacts_no_delete BEFORE DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER contact_versions_append_only BEFORE UPDATE OR DELETE ON contact_versions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER invoice_number_counters_monotonic BEFORE UPDATE OR DELETE ON invoice_number_counters
  FOR EACH ROW EXECUTE FUNCTION haben_counter_monotonic();
--> statement-breakpoint
CREATE TRIGGER contacts_audit AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER invoices_audit AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER journal_entries_audit AFTER INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER invoice_number_counters_audit AFTER INSERT OR UPDATE ON invoice_number_counters
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
