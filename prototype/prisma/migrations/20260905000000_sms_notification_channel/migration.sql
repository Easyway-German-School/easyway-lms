-- Adds SMS as a fourth notification channel, alongside the bell, push and
-- email. See src/lib/notification-routing.ts and src/lib/notification-prefs.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

-- Off by default: every send costs real money, so a kind only texts once an
-- admin (or the code default) turns it on — the opposite default from the
-- other three channels.
ALTER TABLE "NotificationSetting" ADD COLUMN IF NOT EXISTS "sms" BOOLEAN NOT NULL DEFAULT false;

-- On by default, matching inApp/push/email: once a kind's routing has SMS on
-- at all, an individual only narrows it by opting out.
ALTER TABLE "NotificationPreference" ADD COLUMN IF NOT EXISTS "sms" BOOLEAN NOT NULL DEFAULT true;
