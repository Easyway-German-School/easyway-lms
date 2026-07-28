import StudentShell from "@/components/StudentShell";

export default function NotificationsPage() {
  return (
    <StudentShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Notifications</p>
                <h1 className="mt-3 text-3xl font-semibold">Alerts & messages</h1>
              </div>
              <button className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-110">
                Mark all read
              </button>
            </div>

            <div className="mt-10 space-y-4">
              {[
                { title: "Assignment deadline approaching", description: "Submit your German essay before Friday.", time: "2 hours ago" },
                { title: "New AI pronunciation tip", description: "Check your latest speaking practice review.", time: "Today" },
                { title: "Payment receipt issued", description: "Your deposit payment was confirmed.", time: "Yesterday" },
              ].map((note) => (
                <div key={note.title} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--foreground)]">{note.title}</h2>
                      <p className="mt-2 text-sm text-[var(--muted)]">{note.description}</p>
                    </div>
                    <span className="text-sm text-[var(--muted)]">{note.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </StudentShell>
  );
}
