-- Custom SQL migration file, put your code below! --
-- Zeilen-Trigger feuern bei TRUNCATE nicht: Ohne eigenen Trigger leerte TRUNCATE (auch per CASCADE von einer anderen
-- Tabelle aus) festgeschriebene und nur anhängbare Tabellen ohne Fehler und ohne Eintrag im Audit-Log. Geschützt wird
-- jede Tabelle, deren Zeilen ein Trigger vor DELETE schützt, darunter alle versiegelten; audit_log, audit_chain, seals
-- und external_imports haben ihren Trigger schon (0001, 0063, 0198). Eigene Funktion statt haben_append_only, weil
-- Entwürfe in gesperrten Tabellen wie invoices löschbar bleiben und „darf nur ergänzt werden“ dort nicht stimmt.
CREATE FUNCTION haben_reject_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% darf nicht geleert werden: TRUNCATE umgeht die Sperre der Zeilen und das Audit-Log', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER allocations_no_truncate BEFORE TRUNCATE ON allocations
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER annual_submissions_no_truncate BEFORE TRUNCATE ON annual_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER archive_files_no_truncate BEFORE TRUNCATE ON archive_files
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER asset_depreciations_no_truncate BEFORE TRUNCATE ON asset_depreciations
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER assets_no_truncate BEFORE TRUNCATE ON assets
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER bank_imports_no_truncate BEFORE TRUNCATE ON bank_imports
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER bank_neutralizations_no_truncate BEFORE TRUNCATE ON bank_neutralizations
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER bank_transactions_no_truncate BEFORE TRUNCATE ON bank_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER brm_requests_no_truncate BEFORE TRUNCATE ON brm_requests
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER cash_entries_no_truncate BEFORE TRUNCATE ON cash_entries
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER contact_versions_no_truncate BEFORE TRUNCATE ON contact_versions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER contacts_no_truncate BEFORE TRUNCATE ON contacts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER datev_bookings_no_truncate BEFORE TRUNCATE ON datev_bookings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER datev_personenkonten_no_truncate BEFORE TRUNCATE ON datev_personenkonten
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER dividends_no_truncate BEFORE TRUNCATE ON dividends
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER document_amounts_no_truncate BEFORE TRUNCATE ON document_amounts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER document_cancellations_no_truncate BEFORE TRUNCATE ON document_cancellations
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER document_iban_decisions_no_truncate BEFORE TRUNCATE ON document_iban_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER document_splits_no_truncate BEFORE TRUNCATE ON document_splits
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER documents_no_truncate BEFORE TRUNCATE ON documents
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER dunnings_no_truncate BEFORE TRUNCATE ON dunnings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER elster_messages_no_truncate BEFORE TRUNCATE ON elster_messages
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER inbox_messages_no_truncate BEFORE TRUNCATE ON inbox_messages
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER invitations_no_truncate BEFORE TRUNCATE ON invitations
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER invoice_attachments_no_truncate BEFORE TRUNCATE ON invoice_attachments
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER invoice_lines_no_truncate BEFORE TRUNCATE ON invoice_lines
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER invoice_number_counters_no_truncate BEFORE TRUNCATE ON invoice_number_counters
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER invoice_taxes_no_truncate BEFORE TRUNCATE ON invoice_taxes
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON invoices
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER kapest_submissions_no_truncate BEFORE TRUNCATE ON kapest_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER legacy_order_documents_no_truncate BEFORE TRUNCATE ON legacy_order_documents
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER legacy_order_files_no_truncate BEFORE TRUNCATE ON legacy_order_files
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER legacy_order_pdf_attempts_no_truncate BEFORE TRUNCATE ON legacy_order_pdf_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER legacy_voucher_payments_no_truncate BEFORE TRUNCATE ON legacy_voucher_payments
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER lexoffice_voucher_files_no_truncate BEFORE TRUNCATE ON lexoffice_voucher_files
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER lexoffice_vouchers_no_truncate BEFORE TRUNCATE ON lexoffice_vouchers
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER local_owner_recoveries_no_truncate BEFORE TRUNCATE ON local_owner_recoveries
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER lsta_submissions_no_truncate BEFORE TRUNCATE ON lsta_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER lstb_submissions_no_truncate BEFORE TRUNCATE ON lstb_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER mail_log_no_truncate BEFORE TRUNCATE ON mail_log
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER pauschalen_no_truncate BEFORE TRUNCATE ON pauschalen
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER payslip_cancellations_no_truncate BEFORE TRUNCATE ON payslip_cancellations
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER payslips_no_truncate BEFORE TRUNCATE ON payslips
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER postfach_documents_no_truncate BEFORE TRUNCATE ON postfach_documents
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER postfach_requests_no_truncate BEFORE TRUNCATE ON postfach_requests
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER quote_attachments_no_truncate BEFORE TRUNCATE ON quote_attachments
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER quote_choices_no_truncate BEFORE TRUNCATE ON quote_choices
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER quote_lines_no_truncate BEFORE TRUNCATE ON quote_lines
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER quote_number_counters_no_truncate BEFORE TRUNCATE ON quote_number_counters
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER quotes_no_truncate BEFORE TRUNCATE ON quotes
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sepa_direct_debit_items_no_truncate BEFORE TRUNCATE ON sepa_direct_debit_items
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sepa_direct_debits_no_truncate BEFORE TRUNCATE ON sepa_direct_debits
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sepa_mandate_files_no_truncate BEFORE TRUNCATE ON sepa_mandate_files
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sepa_mandate_revocations_no_truncate BEFORE TRUNCATE ON sepa_mandate_revocations
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sepa_mandates_no_truncate BEFORE TRUNCATE ON sepa_mandates
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sepa_transfer_items_no_truncate BEFORE TRUNCATE ON sepa_transfer_items
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sepa_transfers_no_truncate BEFORE TRUNCATE ON sepa_transfers
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sso_issuers_no_truncate BEFORE TRUNCATE ON sso_issuers
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sso_takeovers_no_truncate BEFORE TRUNCATE ON sso_takeovers
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER store_payouts_no_truncate BEFORE TRUNCATE ON store_payouts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER store_reports_no_truncate BEFORE TRUNCATE ON store_reports
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sv_portal_filings_no_truncate BEFORE TRUNCATE ON sv_portal_filings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER token_events_no_truncate BEFORE TRUNCATE ON token_events
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER user_logins_no_truncate BEFORE TRUNCATE ON user_logins
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vast_belege_no_truncate BEFORE TRUNCATE ON vast_belege
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vast_requests_no_truncate BEFORE TRUNCATE ON vast_requests
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vat_extension_submissions_no_truncate BEFORE TRUNCATE ON vat_extension_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vat_items_since_no_truncate BEFORE TRUNCATE ON vat_items_since
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vat_return_filings_no_truncate BEFORE TRUNCATE ON vat_return_filings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vat_return_submissions_no_truncate BEFORE TRUNCATE ON vat_return_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vat_returns_no_truncate BEFORE TRUNCATE ON vat_returns
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER write_offs_no_truncate BEFORE TRUNCATE ON write_offs
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER year_closings_no_truncate BEFORE TRUNCATE ON year_closings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER zm_submissions_no_truncate BEFORE TRUNCATE ON zm_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
-- Tabellen mit Audit-Trigger, deren Zeilen gelöscht werden dürfen: DELETE steht im Audit-Log, TRUNCATE nicht. Damit das
-- Log lückenlos bleibt, lehnen auch sie TRUNCATE ab; DELETE bleibt erlaubt und wird wie bisher protokolliert.
CREATE TRIGGER articles_no_truncate BEFORE TRUNCATE ON articles
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER bank_accounts_no_truncate BEFORE TRUNCATE ON bank_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER beleg_layouts_no_truncate BEFORE TRUNCATE ON beleg_layouts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER bank_connections_no_truncate BEFORE TRUNCATE ON bank_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER company_no_truncate BEFORE TRUNCATE ON company
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER company_logo_no_truncate BEFORE TRUNCATE ON company_logo
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER corporate_tax_inputs_no_truncate BEFORE TRUNCATE ON corporate_tax_inputs
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER custom_pages_no_truncate BEFORE TRUNCATE ON custom_pages
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER elster_certificates_no_truncate BEFORE TRUNCATE ON elster_certificates
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER employees_no_truncate BEFORE TRUNCATE ON employees
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER enable_banking_settings_no_truncate BEFORE TRUNCATE ON enable_banking_settings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER exchange_rates_no_truncate BEFORE TRUNCATE ON exchange_rates
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER inbox_settings_no_truncate BEFORE TRUNCATE ON inbox_settings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER income_tax_inputs_no_truncate BEFORE TRUNCATE ON income_tax_inputs
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER letterhead_background_no_truncate BEFORE TRUNCATE ON letterhead_background
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER letterhead_profiles_no_truncate BEFORE TRUNCATE ON letterhead_profiles
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER lexoffice_connection_no_truncate BEFORE TRUNCATE ON lexoffice_connection
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER loans_no_truncate BEFORE TRUNCATE ON loans
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER lsta_turnus_no_truncate BEFORE TRUNCATE ON lsta_turnus
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER mail_settings_no_truncate BEFORE TRUNCATE ON mail_settings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER payroll_runs_no_truncate BEFORE TRUNCATE ON payroll_runs
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER quote_default_attachments_no_truncate BEFORE TRUNCATE ON quote_default_attachments
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER recurring_documents_no_truncate BEFORE TRUNCATE ON recurring_documents
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER recurring_invoices_no_truncate BEFORE TRUNCATE ON recurring_invoices
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER residual_terms_no_truncate BEFORE TRUNCATE ON residual_terms
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sevdesk_connection_no_truncate BEFORE TRUNCATE ON sevdesk_connection
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER sso_roles_no_truncate BEFORE TRUNCATE ON sso_roles
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER store_connections_no_truncate BEFORE TRUNCATE ON store_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER text_blocks_no_truncate BEFORE TRUNCATE ON text_blocks
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER user_no_truncate BEFORE TRUNCATE ON "user"
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vat_extensions_no_truncate BEFORE TRUNCATE ON vat_extensions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER vat_frequencies_no_truncate BEFORE TRUNCATE ON vat_frequencies
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
