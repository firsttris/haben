-- Ansprechpartner am Kontakt (#424): Eine Person ist änderbar (ein Tippfehler im Namen), aber nicht löschbar, denn sie
-- kann an Entwürfen und, als Stand im Käufer, an festgeschriebenen Belegen hängen. Wer nicht mehr dabei ist, wird
-- deaktiviert (deactivated_at). Wie contacts: Audit bei Anlegen und Ändern, die Hash-Kette hält jeden Stand. Die Sperre
-- gegen TRUNCATE steht wie bei jeder Tabelle mit Löschsperre (0201, truncate.test.ts).

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER contact_persons_no_delete BEFORE DELETE ON contact_persons
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER contact_persons_no_truncate BEFORE TRUNCATE ON contact_persons
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER contact_persons_audit AFTER INSERT OR UPDATE ON contact_persons
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
