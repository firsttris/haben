/*
 * Bank und Kasse: Kontoauszüge, Zuordnung von Zahlungen samt Gegenbuchung, Kontoabruf und Kassenbuch.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  callbackUrl,
  completeConnection,
  deleteEnableBankingSettings,
  enableBankingConfigured,
  enableBankingSettingsSchema,
  enableBankingSettingsSummary,
  listBanks,
  listConnections,
  removeConnection,
  runDueBankSyncs,
  saveEnableBankingSettings,
  startConnection,
  syncConnection,
} from "./bank-sync.ts";
export { fintsVerbinden, fintsVerbindenSchema, listFintsConnections, removeFintsConnection } from "./fints.ts";
export { fintsAbrufen, runDueFintsSyncs } from "./fints-abruf.ts";
export { fintsConfigured } from "./fints-produkt.ts";
export { type FintsSchritt, vorgangFortsetzen as fintsFortsetzen, vorgangVerwerfen as fintsVerwerfen } from "./fints-vorgang.ts";
export { BankError } from "./bank-error.ts";
export {
  accountSchema,
  accountSettingsSchema,
  createAccount,
  createProviderAccount,
  listAccounts,
  ownAccounts,
  providerAccountSchema,
  updateAccount,
} from "./accounts.ts";
export { importStatement, type ImportResult, storeStatement, UnbekannteCsvError } from "./statement-import.ts";
export { listTransactions } from "./transaction-list.ts";
export { transactionDetail } from "./transaction-detail.ts";
export { openItems } from "./offene-posten.ts";
export { learnedDirectSuggestions } from "./learned-suggestions.ts";
export { allocateTransfer, allocateTransferIn, transferSchema } from "./transfers.ts";
export { allocate, allocateExchangeDifferenceIn, allocateIn, allocateSplit, allocationSchema, splitSchema } from "./allocation.ts";
export { gemeldeteVoranmeldungen, reverseAllocation, reverseAllocationIn } from "./allocation-reversal.ts";
export { allocateWithRest, restSchema } from "./allocation-rest.ts";
export { listWriteOffs, reverseWriteOff, writeOff, writeOffSchema } from "./write-offs.ts";
export { allocateFeesToDocument, feesSchema } from "./sammelzuordnung.ts";
export { allocatePaymentWithFee, zahlungMitGebuehrSchema } from "./zahlung-gebuehr.ts";
export { documentBankAllocations } from "./document-allocations.ts";
export { umsatzauswahl } from "./umsatzauswahl.ts";
export { bestaetigeVorschlaege } from "./bestaetigen.ts";
export {
  nachStatusSortieren,
  SORTIERRICHTUNGEN,
  UMSATZ_SORTIERFELDER,
  type UmsatzHinweis,
  type UmsatzSortierung,
} from "./umsatzliste.ts";
export { excludeAccount, excludeBlocker, includeAccount, listExcludedAccounts } from "./konto-ausschliessen.ts";
export { hebePrivatAuf, markierePrivat } from "./privat.ts";
export { decideDocumentIban, documentIbanCheck, ibanDecisionSchema, type IbanDecisionInput } from "./iban-entscheidung.ts";
export { decideDuplicate, duplicateDecisionSchema, type DuplicateDecisionInput } from "./duplicate-review.ts";
export {
  createSepaTransfer,
  documentSepaTransfers,
  listSepaTransfers,
  sepaTransferFile,
  sepaTransferSchema,
  transferCandidates,
  type SepaTransferInput,
  type TransferCandidate,
} from "./sepa-transfers.ts";
export {
  cashInvoiceCandidates,
  cashInvoiceInputSchema,
  createCashInvoiceEntry,
  invoicePaymentList,
  type CashInvoiceCandidate,
  type CashInvoiceInput,
  type InvoicePayment,
} from "./cash-invoice.ts";
export {
  addDocumentCashEntry,
  addImportedCashEntries,
  cashBook,
  cashBookCsv,
  cashInputSchema,
  checkCashReversal,
  createCashEntry,
  lockCash,
  reverseCashEntry,
  reverseDocumentCashEntry,
  type ImportedCashEntry,
} from "./cash.ts";
export { createLoan, DarlehenError, listLoans, loanSchema } from "./darlehen.ts";
export {
  searchBank,
  type BankTransactionHit,
  type CashEntryHit,
  type LoanHit,
} from "./search.ts";
export {
  neutralizationView,
  neutralizeSchema,
  neutralizeTransactions,
  NeutralizationError,
  reverseNeutralization,
  type NeutralizationView,
  type NeutralizeInput,
} from "./neutralisierung.ts";
export { cashIncomeInputSchema, createCashIncome, type CashIncomeInput } from "./cash-income.ts";
export {
  createDirectDebitFile,
  directDebitCandidates,
  directDebitFile,
  directDebitFileSchema,
  listDirectDebitFiles,
  type DirectDebitCandidate,
  type DirectDebitFileInput,
} from "./sepa-lastschriften.ts";
export {
  allocateDirectDebitBatch,
  allocateDirectDebitReturn,
  collectedDirectDebits,
  directDebitMatch,
  type DirectDebitMatch,
} from "./lastschrift-abgleich.ts";

export {
  listSettlements,
  openAmount,
  reversalSchema,
  reverseSettlement,
  SettlementError,
  settleDocuments,
  settlementCandidates,
  settlementSchema,
  type SettlementInput,
} from "./verrechnung.ts";
export { bankCsvMappingSchema, csvZuordnungSchema, importCsvZuordnung, importStatementFile, type CsvImportResult } from "./csv-zuordnung.ts";
export { klaerungView, openConflicts, recordRefusedBatch, resolveConflict, resolveConflictSchema } from "./import-konflikt.ts";
export { cutoverDates } from "./andere-importe.ts";
export { storeBatch, type BatchResult, type StoreBatchInput } from "./import-batch.ts";
export { runExistingDuplicateCheck } from "./duplicate-scan.ts";
