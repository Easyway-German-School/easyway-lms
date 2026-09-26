import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export const metadata = { title: "Examination Terms — Easyway ÖSD Examination Centre" };

/**
 * The school's own candidate terms (Easyway ÖSD Candidate Document Pack,
 * Document G), plus the payment terms printed on its examination invoice.
 * Document A links here, and the Operations Manual (§11) lists "examination
 * terms" among what every candidate must receive at registration.
 */
export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Examination Terms</h1>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">Easyway German Language School — ÖSD Examination Centre, Lagos.</p>

        <p className="mt-6 text-sm leading-relaxed text-[var(--ink-soft)]">
          By registering for an ÖSD examination at Easyway German Language School, the candidate confirms that they
          have been informed about the examination requirements, the examination procedure, these terms, the current
          ÖSD Examination Regulations, the applicable examination instructions, the examination security requirements
          and the result communication procedures. The candidate agrees to comply with the applicable rules.
        </p>

        <Section title="Candidate responsibility">
          <List items={[
            "providing correct personal information — your name and details must match your valid identification document;",
            "providing valid identification;",
            "declaring any special examination needs during registration;",
            "paying the applicable examination fee;",
            "arriving on time — 60 minutes before the examination starts, unless your admission letter says otherwise;",
            "following examination instructions;",
            "working independently;",
            "protecting examination confidentiality.",
          ]} />
        </Section>

        <Section title="Payment">
          <p>
            Pay the examination fee only into the account shown on your invoice, quoting the payment reference on it.
            Never pay a personal account or a member of staff. Reserved examination seats cannot be reversed,
            cancelled or transferred, and all payments are strictly non-refundable. A screenshot is not confirmation
            of payment — your payment is confirmed only when Easyway has verified it.
          </p>
          <p className="mt-2">
            The one exception: if you pay by international card and the sitting fills up in the moments before your
            payment is confirmed, a refund is requested automatically. If that automatic refund fails, our office is
            notified and will refund you directly.
          </p>
        </Section>

        <Section title="Examination admission">
          <p>
            Payment alone does not guarantee admission. Final admission is subject to Easyway confirming that the
            candidate has satisfied the applicable registration and examination requirements — including verified
            payment, correct details and a valid identification document.
          </p>
        </Section>

        <Section title="Identity">
          <p>
            Candidates must present valid identification as required. If the candidate&apos;s identity cannot be
            satisfactorily verified, admission may be refused according to the applicable examination rules.
          </p>
        </Section>

        <Section title="Examination security">
          <p>Candidates must not:</p>
          <List items={[
            "photograph, copy, record or share examination material or content;",
            "communicate with other candidates;",
            "use unauthorised materials or unauthorised electronic devices (this includes mobile phones and smartwatches);",
            "impersonate another person;",
            "receive unauthorised assistance;",
            "submit work that is not independently produced.",
          ]} />
        </Section>

        <Section title="Irregularities">
          <p>
            Where an examination irregularity is suspected, Easyway will document the incident and follow the
            applicable ÖSD procedure. Easyway does not independently promise a particular sanction or result.
          </p>
        </Section>

        <Section title="Results">
          <p>Only official results released through the applicable ÖSD process will be communicated as official results.</p>
        </Section>

        <Section title="Special needs">
          <p>
            Candidates requiring special examination arrangements must notify Easyway during registration. Any
            accommodation is subject to the applicable approval process.
          </p>
        </Section>

        <Section title="Data protection">
          <p>
            Candidate information will be processed for legitimate examination and administrative purposes and handled
            confidentially in accordance with applicable requirements. See our{" "}
            <a href="/privacy" className="underline">Privacy Policy</a>.
          </p>
        </Section>

        <Section title="Acceptance">
          <p>
            By completing registration, the candidate confirms that they have read and accepted these terms and the
            applicable ÖSD Examination Regulations.
          </p>
        </Section>
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

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {items.map((i) => <li key={i}>{i}</li>)}
    </ul>
  );
}
