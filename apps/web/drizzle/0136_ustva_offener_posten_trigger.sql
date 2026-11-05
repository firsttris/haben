-- Voranmeldung als offener Posten. Der Abgabevermerk einer außerhalb von Haben abgegebenen Voranmeldung ist wie die
-- Übermittlungen nur anhängbar und steht im Audit-Log; das Protokoll-PDF liegt im Dokumentenspeicher unter seinem
-- SHA-256. Ein Vermerk gilt nur zusammen mit der Festschreibung der Anmeldung in derselben Transaktion (geprüft beim
-- Commit) und gehört zu ihrem Siegel, wie die Anhänge zum Siegel der Rechnung (0125); eine Zahlung mit Bezug geht nur
-- auf eine abgegebene Voranmeldung.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER vat_return_filings_append_only BEFORE UPDATE OR DELETE ON vat_return_filings
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER vat_return_filings_audit AFTER INSERT ON vat_return_filings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE FUNCTION haben_vat_return_filed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Festgeschrieben in dieser Transaktion (locked_at = now(), der Beginn der Transaktion), mit Ticket und Kz 83 des
  -- Vermerks: Nachträglich, etwa zu einer über ERiC gesendeten Anmeldung, verschöbe er Tag der Abgabe und Fälligkeit
  IF NOT EXISTS (SELECT 1 FROM vat_returns
                  WHERE id = NEW.vat_return_id AND status = 'sent' AND locked_at = now()
                    AND transfer_ticket = NEW.transfer_ticket AND kz83 = NEW.kz83) THEN
    RAISE EXCEPTION 'Abgabevermerk % ohne festgeschriebene Voranmeldung', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER vat_return_filings_sent AFTER INSERT ON vat_return_filings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION haben_vat_return_filed();
--> statement-breakpoint
CREATE FUNCTION haben_allocation_vat_return() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vat_returns WHERE id = NEW.vat_return_id AND status = 'sent') THEN
    RAISE EXCEPTION 'Zahlung zur Voranmeldung %, die nicht abgegeben ist', NEW.vat_return_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER allocations_vat_return BEFORE INSERT ON allocations
  FOR EACH ROW WHEN (NEW.vat_return_id IS NOT NULL) EXECUTE FUNCTION haben_allocation_vat_return();
--> statement-breakpoint
-- Siegel-Funktionen wie in 0129_beleg_aufteilung_trigger, für Voranmeldungen um den Abgabevermerk erweitert. Das Siegel
-- entsteht beim Festschreiben (vat_returns_seal), nach dem Einfügen des Vermerks in derselben Transaktion.
CREATE OR REPLACE FUNCTION haben_seal_columns(tbl text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE tbl
    WHEN 'journal_entries' THEN jsonb_build_object(
      'journal_entries', haben_columns('journal_entries'), 'journal_lines', haben_columns('journal_lines'))
    WHEN 'invoices' THEN jsonb_build_object(
      'invoices', haben_columns('invoices'), 'invoice_lines', haben_columns('invoice_lines'),
      'invoice_taxes', haben_columns('invoice_taxes'), 'invoice_attachments', haben_columns('invoice_attachments'))
    WHEN 'documents' THEN jsonb_build_object(
      'documents', haben_columns('documents'), 'document_amounts', haben_columns('document_amounts'),
      'document_splits', haben_columns('document_splits'))
    WHEN 'vat_returns' THEN jsonb_build_object(
      'vat_returns', haben_columns('vat_returns'), 'vat_return_filings', haben_columns('vat_return_filings'))
    WHEN 'cash_entries' THEN jsonb_build_object('cash_entries', haben_columns('cash_entries'))
    WHEN 'allocations' THEN jsonb_build_object('allocations', haben_columns('allocations'))
    WHEN 'pauschalen' THEN jsonb_build_object('pauschalen', haben_columns('pauschalen'))
    WHEN 'asset_depreciations' THEN jsonb_build_object('asset_depreciations', haben_columns('asset_depreciations'))
    WHEN 'document_cancellations' THEN jsonb_build_object('document_cancellations', haben_columns('document_cancellations'))
    WHEN 'payslips' THEN jsonb_build_object('payslips', haben_columns('payslips'))
    WHEN 'payslip_cancellations' THEN jsonb_build_object('payslip_cancellations', haben_columns('payslip_cancellations'))
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_seal_digest(tbl text, rid uuid, cols jsonb) RETURNS text
LANGUAGE plpgsql STABLE
SET TimeZone = 'UTC' SET bytea_output = 'hex' SET IntervalStyle = 'postgres' SET extra_float_digits = 1
AS $$
DECLARE
  content jsonb;
BEGIN
  CASE tbl
    WHEN 'journal_entries' THEN
      content := jsonb_build_object(
        'journal_entries', (SELECT haben_pick(to_jsonb(e), cols -> 'journal_entries') FROM journal_entries e WHERE e.id = rid),
        'journal_lines', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(l), cols -> 'journal_lines') ORDER BY l.id), '[]'::jsonb)
                            FROM journal_lines l WHERE l.entry_id = rid));
    WHEN 'invoices' THEN
      content := jsonb_build_object(
        'invoices', (SELECT haben_pick(to_jsonb(i), cols -> 'invoices') FROM invoices i WHERE i.id = rid),
        'invoice_lines', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(l), cols -> 'invoice_lines') ORDER BY l.id), '[]'::jsonb)
                            FROM invoice_lines l WHERE l.invoice_id = rid),
        'invoice_taxes', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(t), cols -> 'invoice_taxes') ORDER BY t.rate), '[]'::jsonb)
                            FROM invoice_taxes t WHERE t.invoice_id = rid))
        -- Nur Siegel ab 0125 kennen die Anhänge; ältere Siegel ergeben so denselben Inhalt wie bisher
        || CASE WHEN cols ? 'invoice_attachments' THEN jsonb_build_object(
             'invoice_attachments', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(a), cols -> 'invoice_attachments') ORDER BY a.id), '[]'::jsonb)
                                       FROM invoice_attachments a WHERE a.invoice_id = rid))
           ELSE '{}'::jsonb END;
    WHEN 'documents' THEN
      content := jsonb_build_object(
        'documents', (SELECT haben_pick(to_jsonb(d), cols -> 'documents') FROM documents d WHERE d.id = rid),
        'document_amounts', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(a), cols -> 'document_amounts') ORDER BY a.id), '[]'::jsonb)
                               FROM document_amounts a WHERE a.document_id = rid));
      -- Aufteilung (#271) nur in Siegeln, deren Spaltenliste sie nennt: Ältere Siegel behalten ihren Hash
      IF cols ? 'document_splits' THEN
        content := content || jsonb_build_object(
          'document_splits', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(s), cols -> 'document_splits') ORDER BY s.position), '[]'::jsonb)
                                FROM document_splits s WHERE s.document_id = rid));
      END IF;
    WHEN 'vat_returns' THEN
      content := jsonb_build_object(
        'vat_returns', (SELECT haben_pick(to_jsonb(v), cols -> 'vat_returns') FROM vat_returns v WHERE v.id = rid));
      -- Abgabevermerk nur in Siegeln, deren Spaltenliste ihn nennt: Ältere Siegel behalten ihren Hash
      IF cols ? 'vat_return_filings' THEN
        content := content || jsonb_build_object(
          'vat_return_filings', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(f), cols -> 'vat_return_filings') ORDER BY f.id), '[]'::jsonb)
                                   FROM vat_return_filings f WHERE f.vat_return_id = rid));
      END IF;
    WHEN 'cash_entries' THEN
      content := jsonb_build_object(
        'cash_entries', (SELECT haben_pick(to_jsonb(c), cols -> 'cash_entries') FROM cash_entries c WHERE c.id = rid));
    WHEN 'allocations' THEN
      content := jsonb_build_object(
        'allocations', (SELECT haben_pick(to_jsonb(a), cols -> 'allocations') FROM allocations a WHERE a.id = rid));
    WHEN 'pauschalen' THEN
      content := jsonb_build_object(
        'pauschalen', (SELECT haben_pick(to_jsonb(p), cols -> 'pauschalen') FROM pauschalen p WHERE p.id = rid));
    WHEN 'asset_depreciations' THEN
      content := jsonb_build_object(
        'asset_depreciations', (SELECT haben_pick(to_jsonb(d), cols -> 'asset_depreciations') FROM asset_depreciations d WHERE d.id = rid));
    WHEN 'document_cancellations' THEN
      content := jsonb_build_object(
        'document_cancellations', (SELECT haben_pick(to_jsonb(c), cols -> 'document_cancellations') FROM document_cancellations c WHERE c.id = rid));
    WHEN 'payslips' THEN
      content := jsonb_build_object(
        'payslips', (SELECT haben_pick(to_jsonb(p), cols -> 'payslips') FROM payslips p WHERE p.id = rid));
    WHEN 'payslip_cancellations' THEN
      content := jsonb_build_object(
        'payslip_cancellations', (SELECT haben_pick(to_jsonb(c), cols -> 'payslip_cancellations') FROM payslip_cancellations c WHERE c.id = rid));
    ELSE
      RAISE EXCEPTION 'Für % gibt es kein Siegel', tbl;
  END CASE;
  RETURN encode(sha256(convert_to(content::text, 'UTF8')), 'hex');
END;
$$;
--> statement-breakpoint
SELECT set_config('haben.actor', '', true);
