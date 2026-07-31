import StudentShell from "@/components/StudentShell";
import NotificationFeed from "@/components/NotificationFeed";

export default function NotificationsPage() {
  return (
    <StudentShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
          <NotificationFeed />
        </div>
      </main>
    </StudentShell>
  );
}
