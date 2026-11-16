import { formatEuro } from "@haben/core";
import type { DunningDocument } from "./dunning.ts";
import { accountHolder, formatDate, formatIban } from "./format.ts";

export const dunningRate = (basisPoints: number) =>
  `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(basisPoints / 100)} %`;

/** Nur formatieren: Forderungsstand und Kosten kommen aus der bestehenden Mahnberechnung. */
export function dunningLayoutData({ seller, invoice, amounts, date, dueDate, payments = [] }: DunningDocument) {
  return {
    paymentDetails: {
      amount: formatEuro(amounts.total),
      dueDate: formatDate(dueDate),
      reference: `Rechnung ${invoice.number}`,
      accountHolder: accountHolder(seller),
      bank: seller.bank ?? "",
      iban: seller.iban ? formatIban(seller.iban) : "",
      bic: seller.bic ?? "",
    },
    paymentHistory: payments.map((payment) => ({
      date: formatDate(payment.date),
      amount: formatEuro(payment.amount),
      effect: payment.reversed ? null : formatEuro(-payment.amount),
      method: payment.via === "bank" ? "Bank" : "Bar",
      note: payment.text,
      reversed: payment.reversed,
    })),
    claimDetails: {
      originalAmount: invoice.gross === undefined ? null : formatEuro(invoice.gross),
      openAmount: formatEuro(amounts.open),
      fee: amounts.fee ? formatEuro(amounts.fee) : null,
      flatFee: amounts.flatFee ? formatEuro(amounts.flatFee) : null,
      interest: amounts.interest ? formatEuro(amounts.interest) : null,
      interestRate: amounts.interest ? dunningRate(amounts.interestRate) : null,
      interestDays: String(amounts.interestDays),
      invoiceDueDate: formatDate(invoice.dueDate),
      calculatedOn: formatDate(date),
    },
  };
}
