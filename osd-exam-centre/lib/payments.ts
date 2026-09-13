/**
 * Manual Moniepoint bank-transfer details shown to every candidate. Same
 * design as the LMS's manualBankTransferDetails() (see EasyWay LMS repo,
 * src/lib/exam-payments.ts) for the same reason: no live Monnify/Moniepoint
 * merchant API keys exist yet, so this is "upload a slip, an admin checks
 * the bank app and clicks confirm" rather than an auto-reconciled reserved
 * account. When Monnify API access lands, only this function needs to
 * change — everywhere else just asks "what account do I show/verify".
 */
export function bankTransferDetails(): { bankName: string; accountName: string; accountNumber: string } {
  return {
    bankName: process.env.EXAM_BANK_NAME || "Moniepoint MFB",
    accountName: process.env.EXAM_BANK_ACCOUNT_NAME || "Easyway German Language School",
    accountNumber: process.env.EXAM_BANK_ACCOUNT_NUMBER || "",
  };
}

/**
 * Card payment is a stub. The public booking form only offers bank transfer
 * today; this exists so the "pay by card" button can ship disabled with an
 * honest reason instead of being silently absent, and so wiring up Paystack/
 * Flutterwave later is "fill this in", not "find every place that assumed
 * bank transfer was the only rail".
 */
export function cardPaymentsEnabled(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY);
}
