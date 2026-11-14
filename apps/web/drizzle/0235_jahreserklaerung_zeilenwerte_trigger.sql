-- Zeilenwerte einer abgegebenen Jahreserklärung (#997): dieselben drei Trigger wie der Vermerk selbst (0226).
-- Die Zeilen beschreiben dieselbe Erklärung wie `annual_submissions`; ohne sie wäre die neue Tabelle der
-- einzige Weg, Steuerdaten unbemerkt zu ändern.
CREATE TRIGGER annual_submission_figures_append_only BEFORE UPDATE OR DELETE ON annual_submission_figures
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER annual_submission_figures_audit AFTER INSERT ON annual_submission_figures
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER annual_submission_figures_no_truncate BEFORE TRUNCATE ON annual_submission_figures
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
