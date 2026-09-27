import { BankIcon, CardIcon, FormIcon, SeatIcon, UploadIcon } from "@/components/icons";
import { cardPaymentsEnabled } from "@/lib/payments";

export default function HowItWorks() {
  const cards = cardPaymentsEnabled();
  const STEPS = [
    {
      n: "01",
      Icon: FormIcon,
      title: "Register",
      body: "Enter your details exactly as they appear on your international passport.",
    },
    {
      n: "02",
      Icon: cards ? CardIcon : BankIcon,
      title: "Pay",
      body: cards
        ? "Transfer the fee to the centre's account and upload your receipt — or pay by international card from abroad."
        : "Transfer the fee to the centre's account and upload your receipt.",
    },
    {
      n: "03",
      Icon: UploadIcon,
      title: "Upload documents",
      body: "A passport photograph and your passport's data page — reviewed by our office.",
    },
    {
      n: "04",
      Icon: SeatIcon,
      title: "Get your seat",
      body: "Once payment is confirmed your seat is reserved automatically — print your admission slip.",
    },
  ];

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-[var(--paper)] via-[#f3efe2] to-[var(--paper)] px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="reveal mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gold)]">Your route</p>
          <h2 className="font-serif-display mt-4 text-balance text-3xl font-semibold leading-tight text-[var(--navy)] sm:text-5xl">
            Four steps to your seat
          </h2>
        </div>

        <ol className="relative mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {/* Flight path linking the steps on wide screens. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-[12%] right-[12%] top-8 hidden border-t-2 border-dashed border-[var(--gold)]/50 lg:block"
          />
          {STEPS.map(({ n, Icon, title, body }) => (
            <li key={n} className="reveal card-lift relative rounded-2xl border border-[var(--line)] bg-white p-6 pt-10 shadow-sm">
              <span className="absolute -top-7 left-6 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[var(--navy)] to-[#12325c] text-[var(--gold-bright)] shadow-lg shadow-[var(--navy)]/30 ring-4 ring-[var(--paper)]">
                <Icon className="h-6 w-6" />
              </span>
              <p className="font-serif-display text-4xl font-semibold text-[var(--gold)]/40">{n}</p>
              <h3 className="mt-2 text-lg font-semibold text-[var(--navy)]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
