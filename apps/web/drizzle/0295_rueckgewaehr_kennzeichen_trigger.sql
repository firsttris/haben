-- #853: Storno und Korrektur bekommen beim Festschreiben das Kennzeichen „rueckgewaehr“ (Minderung bereits
-- vereinnahmter Steuer erst mit der Rückzahlung, § 17 UStG, UStAE 17.1 Abs. 2 Satz 3). Leer heißt bisheriges Verfahren;
-- ein vergessener Schreibweg (REST, MCP, Storno der Korrekturen) fiele sonst nie auf. Bereits festgeschriebene Zeilen
-- trifft der Trigger nicht, sie bleiben durch invoices_locked unverändert. Muster: invoices_advance_rechtsform (0224).
-- Entscheidung: https://github.com/firsttris/haben/pull/1228#issuecomment-6940857265
CREATE FUNCTION haben_check_reduction_rule() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reduction_rule IS NULL THEN
    RAISE EXCEPTION 'Storno und Rechnungskorrektur brauchen beim Festschreiben das Kennzeichen der Rückgewähr.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_reduction_rule BEFORE UPDATE OF locked_at ON invoices
  FOR EACH ROW WHEN (
    OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL AND NEW.kind IN ('storno', 'korrektur')
  ) EXECUTE FUNCTION haben_check_reduction_rule();
--> statement-breakpoint
CREATE TRIGGER invoices_reduction_rule_insert BEFORE INSERT ON invoices
  FOR EACH ROW WHEN (
    NEW.locked_at IS NOT NULL AND NEW.kind IN ('storno', 'korrektur')
  ) EXECUTE FUNCTION haben_check_reduction_rule();
