import { BanIcon, ClockIcon, PassportIcon, PenIcon, PhoneOffIcon } from "@/components/icons";

// The same five rules the booking wizard makes candidates acknowledge — kept
// word-for-word in spirit so the landing page never promises something the
// wizard doesn't.
const ESSENTIALS = [
  { Icon: ClockIcon, title: "Arrive early", body: "Do not arrive late — latecomers may not be admitted to the exam room." },
  { Icon: PenIcon, title: "Ballpoint pen", body: "Bring a normal ballpoint pen. No pencils, no correction fluid." },
  { Icon: PassportIcon, title: "Your documents", body: "Bring your international passport's data page and your printed admission slip." },
  { Icon: PhoneOffIcon, title: "Phones off", body: "Mobile phones and smart watches must be off and out of reach during the exam." },
  { Icon: BanIcon, title: "No refunds", body: "A booking is not reversible or refundable once payment is confirmed." },
];

export default function ExamDayEssentials() {
  return (
    <section className="px-5 pb-20 sm:px-6 sm:pb-24">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--gold-soft)] via-[#fbf6e6] to-white px-6 py-12 ring-1 ring-[var(--gold)]/20 sm:px-12 sm:py-14">
        <div className="reveal max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gold)]">Before you fly</p>
          <h2 className="font-serif-display mt-3 text-3xl font-semibold text-[var(--navy)] sm:text-4xl">
            Exam-day essentials
          </h2>
        </div>
        <ul className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {ESSENTIALS.map(({ Icon, title, body }) => (
            <li key={title} className="reveal rounded-2xl bg-white/80 p-5 shadow-sm ring-1 ring-black/5 backdrop-blur">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--navy)] text-[var(--gold-bright)]">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold text-[var(--navy)]">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
