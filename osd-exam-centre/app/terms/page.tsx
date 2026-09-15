import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export const metadata = { title: "Terms — Easyway ÖSD Examination Centre" };

export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Terms of Booking</h1>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          Placeholder text — Easyway's management should review and replace this with counsel-approved wording
          before this site takes real bookings. Written here to state plainly what the booking flow already
          tells candidates at each step, not as a substitute for legal review.
        </p>

        <Section title="Accuracy of your details">
          <p>
            The name, date of birth, and other personal details you register with must match your international
            passport exactly — this is what prints on your certificate. Easyway is not responsible for a
            certificate issued incorrectly because of details a candidate entered wrongly.
          </p>
        </Section>

        <Section title="Payment">
          <p>
            A booking is not reversible or refundable once payment is confirmed, except: if your sitting fills
            up between you starting a card payment and it being confirmed, you have not been charged for
            nothing — see the automatic-refund note below. Payment by bank transfer must come from a commercial
            bank account, not a mobile-money or wallet app.
          </p>
        </Section>

        <Section title="If a card payment cannot be confirmed">
          <p>
            In the rare case a sitting fills up in the moments between you starting a card payment and
            Flutterwave confirming it, a refund is requested automatically. If that automatic refund itself
            fails, our office is notified and will refund you directly — use "Need help?" if you don't see it
            resolved within a reasonable time.
          </p>
        </Section>

        <Section title="Documents">
          <p>
            Your passport photograph and passport data page are reviewed by our office before your registration
            is treated as complete. We may ask you to re-upload either if it is unclear or doesn't match what
            the exam requires.
          </p>
        </Section>

        <Section title="Exam-day conduct">
          <p>
            Arrive at least 30 minutes before your sitting. Bring this admission slip and your passport's data
            page. Latecomers may not be admitted. Mobile phones and smart watches must be off and out of reach
            for the duration of the exam — being found with one may be treated as an attempt to cheat.
          </p>
        </Section>

        <p className="mt-8 text-xs text-[var(--ink-soft)]">
          See also our <a href="/privacy" className="underline">Privacy Policy</a>. Last updated: this document
          was drafted alongside the booking system it describes.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--navy)]">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{children}</div>
    </section>
  );
}
