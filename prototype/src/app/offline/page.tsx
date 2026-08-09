import BrandLogo from "@/components/BrandLogo";

/**
 * What the installed app shows when the network is gone.
 *
 * Precached by the service worker at install time, which is why it must stay
 * static: no session, no database, no `fetch`. Anything dynamic here would
 * either fail (it is being served precisely because the network failed) or,
 * worse, be baked into a shared cache with one student's data in it.
 *
 * The copy names what still works offline rather than apologising. On a
 * Nigerian mobile line the app will be opened without a connection regularly,
 * and "your downloaded materials are still there" is the difference between a
 * student closing the app and a student studying.
 */
export const metadata = { title: "Offline · EasyWay" };

export default function OfflinePage() {
  return (
    <main className="app-canvas grid min-h-screen place-items-center px-6 py-16 text-[var(--foreground)]">
      <div className="w-full max-w-md rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow)]">
        <BrandLogo variant="mark" className="mx-auto h-14 w-14" />

        <h1 className="mt-6 text-2xl font-semibold">You are offline</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          EasyWay could not reach the school right now. Your place in class, your payments and your progress are all
          safe — nothing is lost by being offline.
        </p>

        <p className="mt-6 rounded-2xl bg-[var(--surface-alt)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
          Anything you already downloaded is still on this device. Live class, your timetable and new materials need a
          connection.
        </p>

        {/*
          A plain <a> to the portal root, not a router link and not a
          `location.reload()` button. This page is served by the service worker
          with no JavaScript guaranteed to have hydrated, so the one control on
          it has to work as markup.
        */}
        <a
          href="/"
          className="mt-6 inline-block rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Try again
        </a>
      </div>
    </main>
  );
}
