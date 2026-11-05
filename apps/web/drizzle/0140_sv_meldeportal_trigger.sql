-- SV-Meldeportal (docs/lohn-plan.md, PR 6): Vermerke „im Portal abgegeben“ sind nur anhängbar und stehen im Audit-Log.
-- Eine Rücknahme ist eine neue Zeile, die auf einen Vermerk desselben Gegenstands zeigt; eine Rücknahme selbst lässt
-- sich nicht zurücknehmen, und je Vermerk gibt es höchstens eine (eindeutiger Index aus 0139).
CREATE FUNCTION haben_check_sv_portal_filing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revokes_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sv_portal_filings f
     WHERE f.id = NEW.revokes_id AND f.gegenstand = NEW.gegenstand AND f.revokes_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Vermerk % ist kein Vermerk zu %', NEW.revokes_id, NEW.gegenstand
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sv_portal_filings_check BEFORE INSERT ON sv_portal_filings
  FOR EACH ROW EXECUTE FUNCTION haben_check_sv_portal_filing();
--> statement-breakpoint
CREATE TRIGGER sv_portal_filings_append_only BEFORE UPDATE OR DELETE ON sv_portal_filings
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sv_portal_filings_audit AFTER INSERT ON sv_portal_filings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
