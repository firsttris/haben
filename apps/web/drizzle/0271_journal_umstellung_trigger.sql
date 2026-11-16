-- #1116: Ergebnis der Prüfung beim Update, nur anhängbar, im Änderungsprotokoll (audit_log), gegen TRUNCATE gesperrt (wie app_versions)
CREATE TRIGGER journal_umstellung_append_only BEFORE UPDATE OR DELETE ON journal_umstellung
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER journal_umstellung_audit AFTER INSERT ON journal_umstellung
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER journal_umstellung_no_truncate BEFORE TRUNCATE ON journal_umstellung
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
-- Das Stichjahr aus den Firmendaten übernehmen, die Spalte bleibt für die bisherige Version. Offen bleibt die Umstellung
-- nur mit Buchungen vor dem Stichjahr; sie prüft der Start (modules/umstellung, docs/adr/journal-als-quelle.md).
INSERT INTO journal_umstellung (stichjahr_vorher, ergebnis)
SELECT c.journal_ab,
  CASE WHEN EXISTS (SELECT 1 FROM journal_entries e WHERE extract(year from e.date) < c.journal_ab) THEN 'offen' ELSE 'bestanden' END
FROM (SELECT (SELECT journal_ab FROM company LIMIT 1) AS journal_ab) c;
