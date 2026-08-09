# Backups

## What went wrong, so it is not repeated

The nightly job ran every night from 3 August and failed every night, in
seventeen seconds, and nobody found out until somebody went looking on
9 August. Three faults, stacked:

1. **None of the secrets were ever set.** `restic` exited with "Please specify
   repository location", a message that names a command-line flag rather than
   the missing secret, so the failure read as a tooling problem rather than a
   configuration one.
2. **The step that reports failure to the app also failed**, because it needs
   `APP_BASE_URL` and `CRON_SECRET`, which were equally unset. The one
   mechanism designed to notice a silent backup failure was itself failing
   silently. `BackupRun` stayed empty, so the alarm in `/admin/security` said
   "never" — correctly, and to nobody.
3. **A one-megabyte floor on the dump.** This school's dump is a fraction of
   that, so even fully configured the workflow would have rejected its own good
   backup. A size floor is a guess about how big the data ought to be; the
   check is now a content check (`pg_restore --list`, at least twenty tables
   with data, and `Student`/`Payment`/`User`/`Grade`/`Attendance` present by
   name), which is true at any size.

## What is true now

- The workflow **names the missing secret** before doing anything else.
- It **degrades instead of collapsing**: with no object-storage secrets it
  still dumps, encrypts under `BACKUP_PASSPHRASE`, and keeps the result as a
  90-day GitHub artifact. GitHub is a different account from Neon, which is the
  property that matters.
- It **refuses to write anything unencrypted**, whichever path it takes.
- The check-in step can no longer fail the run.

## The twenty-minute setup

Under **Settings → Secrets and variables → Actions** on the repository:

| Secret | Needed for | Where it comes from |
| --- | --- | --- |
| `DIRECT_DATABASE_URL` | everything | Neon → your project → Connection string, **direct**, not pooled |
| `BACKUP_PASSPHRASE` | the artifact fallback | invent one, store it in a password manager |
| `APP_BASE_URL` | the alarm telling the truth | `https://<your-vercel-domain>` |
| `CRON_SECRET` | the same | the value already in the Vercel environment |
| `RESTIC_REPOSITORY` | the real destination | e.g. `s3:https://s3.us-west-000.backblazeb2.com/easyway-backups` |
| `RESTIC_PASSWORD` | the same | invent one, store it in a password manager |
| `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET_KEY` | the same | Backblaze B2 application key |

The first four are the minimum for a real off-site backup. The last four
upgrade it from "90-day artifacts" to a pruned, deduplicated, verified
repository.

**Lose `RESTIC_PASSWORD` or `BACKUP_PASSPHRASE` and the backups are
unrecoverable.** That is the point of client-side encryption and it has no
recovery path. Put both in a password manager before setting them here.

### Why a different vendor

Backblaze B2 rather than Cloudflare R2 for the *file* backup, because R2 is
where the files already live and a backup in the same account dies in the same
email compromise, the same declined card, the same suspension. For the
*database* dump, R2 is acceptable — the database is at Neon.

## Running one by hand

```bash
gh workflow run "Backup database"
```

## The local copy

```bash
npm --prefix prototype run backup -- ~/Documents/EASYWAY-BACKUPS/manual
npm --prefix prototype run backup:verify -- ~/Documents/EASYWAY-BACKUPS/manual
```

One JSON file per table plus a manifest, and a drill that reads it back. It
survives a Neon incident and does not survive the laptop, so it is a
supplement to the off-site job rather than a substitute for it. Both record a
`BackupRun`, so the alarm reflects what actually happened.

`verify-snapshot.mjs` is not a formality. On its first run it caught a real bug
in the writer: `JSON.stringify` calls `toJSON()` before it calls the replacer,
so every `Date` arrived at the replacer already converted to a string and was
written untagged. The snapshot parsed perfectly and would have restored a
database where every timestamp was text. The drill now fails if it rebuilds no
dates at all.

## Restoring

There is deliberately no restore script. A one-command restore pointed at a
live database is a foot-gun that eventually goes off, and a restore is a
decision somebody makes deliberately, with the site in maintenance.

From a restic snapshot:

```bash
restic snapshots --tag database
restic restore <snapshot-id> --target ./restore
pg_restore --clean --no-owner --no-privileges -d "$DIRECT_DATABASE_URL" ./restore/easyway-*.dump
```

From an artifact: download it from the workflow run, then

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in easyway-*.dump.enc -out easyway.dump
pg_restore --clean --no-owner --no-privileges -d "$DIRECT_DATABASE_URL" easyway.dump
```

## Still open

`backup-objects.yml` — the photos, materials and recordings in R2 — has never
recorded a successful run either, for the same reason: no secrets. It needs the
same treatment.
