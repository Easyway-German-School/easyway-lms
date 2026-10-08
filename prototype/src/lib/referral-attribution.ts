type ReferralReferrer = {
  id: string;
};

export async function resolveSignupReferralAttribution(
  referralCodeInput: unknown,
  canAttribute: boolean,
  findReferrer: (referralCode: string) => Promise<ReferralReferrer | null>,
): Promise<{ referralCode: string; referrerStudentId: string } | null> {
  const referralCode =
    typeof referralCodeInput === "string" ? referralCodeInput.trim().toUpperCase() : "";
  if (!referralCode || !canAttribute) return null;

  try {
    const referrer = await findReferrer(referralCode);
    return referrer ? { referralCode, referrerStudentId: referrer.id } : null;
  } catch (error) {
    console.error("Referral attribution lookup failed during signup; continuing without attribution:", error);
    return null;
  }
}
