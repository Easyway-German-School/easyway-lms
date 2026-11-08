export const RETAKE_DISCOUNT_PERCENT = 30;

export type RetakePrice = {
  baseFee: number;
  discountAmount: number;
  fee: number;
};

export function retakePrice(baseFee: number): RetakePrice {
  const base = Math.max(0, Math.round(Number(baseFee) || 0));
  const discountAmount = Math.round((base * RETAKE_DISCOUNT_PERCENT) / 100);
  return {
    baseFee: base,
    discountAmount,
    fee: base - discountAmount,
  };
}
