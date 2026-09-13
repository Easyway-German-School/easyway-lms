import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export const metadata = { title: "Privacy Policy — Easyway ÖSD Examination Centre" };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Privacy Policy</h1>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          Placeholder text — Easyway's management should review and replace this with counsel-approved wording
          before this site takes real bookings. Written here to describe exactly what the code actually does,
          not as a substitute for legal review.
        </p>

        <Section title="What we collect">
          <p>
            To register you for an ÖSD examination we collect: your full name, email address, phone number,
            postal address, date and place of birth, the exam modules you book, a photograph of your face, and
            your international passport's data page. If you pay by bank transfer we also keep the payment slip
            you upload; if you pay by card, our payment processor (Flutterwave) handles your card details
            directly — we never see or store your card number.
          </p>
        </Section>

        <Section title="Why we collect it">
          <p>
            Solely to register you for the examination, confirm your identity on the day, issue your seat and
            certificate, and communicate with you about your booking. Your name, date of birth, and exam results
            are shared with ÖSD (the Austrian examination board) as part of registering and certifying you — that
            sharing is inherent to what an ÖSD examination centre does, not an optional use of your data.
          </p>
        </Section>

        <Section title="What we don't do with it">
          <p>
            We do not sell your data. We do send you a small number of emails about your own booking — a
            confirmation, a payment receipt, reminders as your exam approaches, and (separately, and clearly
            marked) information about optional exam-preparation classes. You can ask us to stop the preparation
            emails at any time without affecting your booking.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            For as long as is reasonably necessary to administer your examination, resolve any dispute about it,
            and meet any record-keeping ÖSD itself requires of an examination centre.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            You can ask what data we hold about you, ask us to correct it, or ask what would need to happen to
            delete it (bearing in mind some of it exists because an examination board requires it of a centre
            it accredits). Use "Need help?" on your booking page, or the site footer, to ask.
          </p>
        </Section>

        <p className="mt-8 text-xs text-[var(--ink-soft)]">Last updated: this document was drafted alongside the booking system it describes.</p>
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
