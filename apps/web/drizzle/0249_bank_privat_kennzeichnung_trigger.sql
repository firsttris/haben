-- Kennzeichnung „privat, kein Betriebsvorgang“ (#1088): Kennzeichnen und Aufheben stehen im Audit-Log, damit
-- nachvollziehbar bleibt, wer einen Umsatz wann aus den offenen Posten genommen hat. TRUNCATE umginge den
-- Zeilen-Trigger und wird deshalb abgelehnt (docs/entwicklung.md, Konventionen).
CREATE TRIGGER bank_private_marks_audit AFTER INSERT OR UPDATE OR DELETE ON bank_private_marks
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER bank_private_marks_no_truncate BEFORE TRUNCATE ON bank_private_marks
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
