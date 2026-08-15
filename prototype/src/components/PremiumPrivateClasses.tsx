"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { SparklesIcon, ArrowRightIcon } from "@/components/icons";
import { PRIVATE_CLASS_UPGRADE_PRICE } from "@/lib/payment";

/**
 * Premium upsell card for private one-to-one classes.
 * Shows pricing, benefits, and upgrade path.
 * Only visible to group class students; hidden if already private.
 */

type StudentInfo = {
  classType: string;
  level?: string;
  branchName?: string;
};

export default function PremiumPrivateClasses({ student }: { student: StudentInfo }) {
  const { data: session } = useSession();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState("");

  // Only show if student is in group class
  if (student.classType === "private") {
    return null;
  }

  async function initiateUpgrade() {
    if (!session?.user?.id) return;

    setIsProcessing(true);
    setMessage("");

    try {
      // Initialize payment for private class upgrade
      const res = await fetch("/api/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "private_class_upgrade",
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        setMessage(error.error || "Failed to initiate payment");
        return;
      }

      const data = await res.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
    } catch (error) {
      console.error("Upgrade failed:", error);
      setMessage("Unable to process upgrade. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="rounded-3xl border-2 border-[var(--accent)] bg-gradient-to-br from-[var(--accent)]/10 to-transparent p-6 shadow-md">
      <div className="flex items-start gap-4">
        <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/20">
          <SparklesIcon className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-[var(--foreground)]">Premium: One-to-One Classes</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Get personalized attention from a dedicated tutor. Flexible scheduling, faster progress.
          </p>

          {/* Benefits */}
          <ul className="mt-4 space-y-2 text-sm">
            {[
              "Personalized learning plan",
              "Flexible class times",
              "Direct tutor access",
              "Faster progress guarantee",
            ].map((benefit) => (
              <li key={benefit} className="flex items-center gap-2 text-[var(--foreground)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                {benefit}
              </li>
            ))}
          </ul>

          {/* Pricing & CTA */}
          <div className="mt-6 flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                One-time payment
              </p>
              <p className="mt-1 text-2xl font-bold text-[var(--accent)]">
                ₦{PRIVATE_CLASS_UPGRADE_PRICE.toLocaleString("en-NG")}
              </p>
            </div>
            <button
              onClick={initiateUpgrade}
              disabled={isProcessing}
              className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-6 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {isProcessing ? "Processing..." : "Upgrade Now"}
              {!isProcessing && <ArrowRightIcon className="h-4 w-4" />}
            </button>
          </div>

          {message && (
            <p className="mt-3 text-sm text-red-600">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
