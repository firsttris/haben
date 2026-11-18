import { useServerFn } from "@tanstack/react-start";
import {
  allocateDirectDebitBatchFn,
  allocateDirectDebitReturnFn,
  allocateProviderFees,
  allocateTransaction,
  allocateTransactionWithRest,
  markBankTransactionPrivate,
  neutralizeBankTransactions,
  reverseBankNeutralization,
  reverseTransactionAllocation,
  splitTransaction,
  transferBetweenAccounts,
  unmarkBankTransactionPrivate,
} from "../../server/functions/bank.ts";
import { bookAndAllocateDauerbelegFn } from "../../server/functions/dauerbelege.ts";

/** Die Server-Aufrufe, mit denen die Zuordnung eines Bankumsatzes bucht */
export function useZuordnungsAufrufe() {
  return {
    allocateFn: useServerFn(allocateTransaction),
    markPrivatFn: useServerFn(markBankTransactionPrivate),
    unmarkPrivatFn: useServerFn(unmarkBankTransactionPrivate),
    splitFn: useServerFn(splitTransaction),
    restFn: useServerFn(allocateTransactionWithRest),
    feesFn: useServerFn(allocateProviderFees),
    reverseFn: useServerFn(reverseTransactionAllocation),
    transferFn: useServerFn(transferBetweenAccounts),
    dauerbelegFn: useServerFn(bookAndAllocateDauerbelegFn),
    neutralizeFn: useServerFn(neutralizeBankTransactions),
    reverseNeutralizationFn: useServerFn(reverseBankNeutralization),
    batchFn: useServerFn(allocateDirectDebitBatchFn),
    returnFn: useServerFn(allocateDirectDebitReturnFn),
  };
}
