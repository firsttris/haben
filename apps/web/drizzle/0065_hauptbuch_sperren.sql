-- Hauptbuch (#81): Die App schreibt das Journal nur über ledger.post. Diese Trigger sichern dasselbe in der Datenbank ab,
-- auch für Schreiber an Haben vorbei:
--   1. Eine Buchung ist beim Commit festgeschrieben, sonst wird die Transaktion abgelehnt.
--   2. Eine Buchung trägt den Kontenrahmen aus den Firmendaten.
--   3. Kontenrahmen, Versteuerung und das Einschalten von § 19 UStG gehen nicht, sobald im laufenden Jahr gebucht ist.
-- 2 und 3 nehmen vor der Prüfung die Sperre der Hash-Kette (0063). Jede Transaktion, die bucht, hält sie ab dem ersten
-- Audit-Eintrag bis zum Commit; eine Änderung der Firmendaten wartet also auf laufende Buchungen und sieht sie danach,
-- eine Buchung wartet auf eine laufende Änderung der Firmendaten. Die Reihenfolge der Sperren bleibt wie bisher
-- (Zeile, dann Kette), neue Verklemmungen entstehen so nicht.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
-- Sperre der Hash-Kette, wie in haben_audit_chain
CREATE FUNCTION haben_lock_audit_chain() RETURNS void
LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(hashtext('haben.audit_chain')) $$;
--> statement-breakpoint
-- 1. Beim Commit: jede neue Buchung ist festgeschrieben (oder in derselben Transaktion wieder gelöscht)
CREATE FUNCTION haben_require_locked_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entries WHERE id = NEW.id AND locked_at IS NULL) THEN
    RAISE EXCEPTION 'Buchung % ist nicht festgeschrieben. Buchungen entstehen nur über das Hauptbuch und werden in derselben Transaktion festgeschrieben.', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_locked_at_commit AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION haben_require_locked_entry();
--> statement-breakpoint
-- 2. Kontenrahmen der Buchung = Kontenrahmen der Firmendaten (gibt es noch keine Firmendaten, ist nichts zu prüfen)
CREATE FUNCTION haben_check_entry_kontenrahmen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  company_kr kontenrahmen;
BEGIN
  PERFORM haben_lock_audit_chain();
  SELECT kontenrahmen INTO company_kr FROM company WHERE id = 1;
  IF FOUND AND NEW.kontenrahmen IS DISTINCT FROM company_kr THEN
    RAISE EXCEPTION 'Buchung im Kontenrahmen %, die Firmendaten stehen auf %', NEW.kontenrahmen, company_kr
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_kontenrahmen BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION haben_check_entry_kontenrahmen();
--> statement-breakpoint
-- 3. Jahressperre der Firmendaten. Die App prüft mehr (offene Rechnungen, noch nicht Gebuchtes im Vorjahr,
-- settings-guard.ts); hier steht der Kern, der ohne Anwendungslogik feststeht. Das Jahr nach deutscher Zeit, wie today().
CREATE FUNCTION haben_check_company_settings() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  this_year integer;
BEGIN
  IF NEW.kontenrahmen IS NOT DISTINCT FROM OLD.kontenrahmen
     AND NEW.versteuerung IS NOT DISTINCT FROM OLD.versteuerung
     AND NOT (NEW.kleinunternehmer AND NOT OLD.kleinunternehmer) THEN
    RETURN NEW;
  END IF;
  PERFORM haben_lock_audit_chain();
  this_year := extract(year FROM (now() AT TIME ZONE 'Europe/Berlin'))::integer;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE date >= make_date(this_year, 1, 1)) THEN
    RAISE EXCEPTION 'Im Jahr % gibt es schon Buchungen. Kontenrahmen, Versteuerung und Kleinunternehmer lassen sich nur zum Jahreswechsel umstellen, bevor im neuen Jahr gebucht wird.', this_year
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_settings_lock BEFORE UPDATE ON company
  FOR EACH ROW EXECUTE FUNCTION haben_check_company_settings();
--> statement-breakpoint
SELECT set_config('haben.actor', '', true);
