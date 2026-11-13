-- Eigene Sachkonten (#270): Nummer, Kontenrahmen und Elternkategorie ändern sich nie, denn Buchungen und Auswertungen
-- lösen das Konto darüber auf; nur der Name ist änderbar. Jeder Stand steht im Audit-Log (Hash-Kette), auch das
-- Löschen; deshalb steht, wie bei jeder Tabelle mit aufgezeichnetem Löschen, eine Sperre gegen TRUNCATE davor (0201,
-- truncate.test.ts). Ob ein Konto noch gelöscht werden darf, weil nichts darauf zeigt, kommt mit den Spalten, die darauf
-- zeigen.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE FUNCTION haben_own_accounts_fest() RETURNS trigger AS $$
BEGIN
  IF NEW.kontenrahmen <> OLD.kontenrahmen OR NEW.account <> OLD.account OR NEW.parent_category <> OLD.parent_category THEN
    RAISE EXCEPTION 'Nummer, Kontenrahmen und Elternkategorie eines eigenen Kontos ändern sich nicht; bitte das Konto löschen und neu anlegen'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER own_accounts_fest BEFORE UPDATE ON own_accounts
  FOR EACH ROW EXECUTE FUNCTION haben_own_accounts_fest();
--> statement-breakpoint
CREATE TRIGGER own_accounts_no_truncate BEFORE TRUNCATE ON own_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER own_accounts_audit AFTER INSERT OR UPDATE OR DELETE ON own_accounts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
