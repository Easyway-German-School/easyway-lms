const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
  "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion"];

function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) {
    // British/Nigerian style, as on the school's invoice: "Two Hundred and Ten Thousand".
    if (hundreds) parts.push("and");
    parts.push(rest < 20 ? ONES[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ""}`);
  }
  return parts.join(" ");
}

/**
 * 210000 → "Two Hundred and Ten Thousand Naira Only" — the "Amount due in
 * words" line on the examination invoice. Whole naira only: fees here are
 * never kobo, and a fractional amount is a bug upstream, not something to
 * paper over with rounding.
 */
export function nairaInWords(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`nairaInWords needs a whole, non-negative amount, got ${amount}`);
  if (amount === 0) return "Zero Naira Only";

  const groups: string[] = [];
  let remaining = amount;
  for (let scale = 0; remaining > 0; scale++) {
    const chunk = remaining % 1000;
    remaining = Math.floor(remaining / 1000);
    if (chunk) groups.unshift(`${underThousand(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ""}`);
  }
  // "and" before a trailing sub-hundred group: 1,050 → "One Thousand and Fifty".
  const last = amount % 1000;
  const words = groups.join(" ");
  const needsAnd = last > 0 && last < 100 && amount >= 1000;
  if (needsAnd) {
    const tail = underThousand(last);
    return `${words.slice(0, words.length - tail.length).trimEnd()} and ${tail} Naira Only`;
  }
  return `${words} Naira Only`;
}

/** 210000 → "210,000" (the invoice's fee columns carry no currency symbol). */
export function formatAmount(amount: number): string {
  return amount.toLocaleString("en-NG");
}

/** 210000 → "₦210,000" (email copy, admin screens). */
export function formatNaira(amount: number): string {
  return `₦${formatAmount(amount)}`;
}
