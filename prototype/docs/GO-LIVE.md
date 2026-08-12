# Go-live runbook — live classes, session-scoped community, chat

Written 2026-08-12, for the launch next week. Follow the order. Two of these
steps are not independent and doing them apart will break the portal for
everybody — that is called out where it bites.

---

## 0. The thing that broke the first demo

Production had `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` but **no
`LIVEKIT_URL`**. `liveKitConfigured()` needs all three, so it returned false and
every class silently fell back to an embedded `meet.jit.si` room.

That fallback could never have worked. This app sends
`Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)`.
`(self)` grants a feature to **this origin only** — a cross-origin iframe gets
no delegation, and the frame's own `allow="camera; microphone"` cannot grant
what the parent policy withheld. So Jitsi's camera, microphone and screen share
were blocked by the browser while its chat and hand-raise, being pure data,
worked perfectly.

**The fingerprint to remember: chat and hand-raise alive + camera/mic/share
dead = a permissions-policy block. Not the network, not the SFU.**

Recording never ran either — `ensureRecordingStarted()` sits after the
fallback's early return.

The fallback provider has been deleted. A missing variable now returns 503 and
names the variable to staff.

---

## 1. Environment (done 2026-08-12)

Added to Vercel **production**:

| Variable | Why |
|---|---|
| `LIVEKIT_URL` | **The root cause.** Without it there is no classroom at all. |
| `RECORDING_S3_ACCESS_KEY` / `_SECRET` / `_BUCKET` / `_ENDPOINT` / `_REGION` | Recordings land in the dedicated bucket instead of falling back to the uploads bucket. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push. Without these, `notify({ push: true })` reaches zero devices silently. |

Verify before the first class:

```bash
cd prototype && npm run check:livekit
```

It creates and deletes a real room, reports clock drift, and — new — exits
non-zero naming any missing variable. A drift over ~120s means every token is
rejected; see the clock-skew note in the project memory.

---

## 2. Still to do by hand: the LiveKit webhook

**Nobody can do this from the repo.** In the LiveKit Cloud dashboard, add a
webhook pointing at:

```
https://<your-production-domain>/api/webhooks/livekit
```

Without it, a finished recording reaches the library only when something calls
the reconciler. That is now three things — the daily cron, an admin pressing the
button, and (added 2026-08-12) any student opening the Watch shelf, throttled to
one pass a minute. So a missing webhook costs minutes rather than a day, but the
webhook is still the fast path and the one the design assumes.

The endpoint verifies the signature against `LIVEKIT_API_SECRET`, so an
unsigned or forged POST is rejected.

---

## 3. Migration and deploy — DO THESE TOGETHER

**Production and development share one Neon database.** The migration drops
`Thread` and `Comment`. If it is applied while production is still running the
old code, the community page breaks for every user immediately. If the new code
ships before the migration, `Message` does not exist and the community page
breaks the other way.

There is no safe gap. Run them back to back, in this order, in a quiet window:

```bash
cd prototype && npx prisma migrate deploy
```

`P1001 Can't reach database server` is usually a Neon cold start — retry once
before investigating anything.

Then, from the **repo root** (`git push` is 403 on this project):

```bash
npx vercel --prod
```

What the migration does:

- adds `Space.sessionSlot`, drops the `(branchId, level)` unique key and
  replaces it with `(branchId, level, sessionSlot)`
- creates `Message`
- **carries the forum across** — each thread becomes its opening message, each
  comment becomes a reply quoting it. Nothing anybody wrote is dropped.
- drops `Thread` and `Comment`

It is idempotent throughout (`IF NOT EXISTS`, FK adds wrapped in
`EXCEPTION WHEN duplicate_object`), per this project's convention. Never run
`prisma migrate dev` here.

### Testing before the window

Because there is one database, the chat cannot be exercised locally without
applying the migration to production data. Two options:

1. **Neon branch** — branch the database, point `prototype/.env.local` at the
   branch, migrate and test there. This is the right answer and worth the
   twenty minutes.
2. **Coordinated window** — migrate and deploy together at a quiet hour, then
   test on production immediately.

---

## 4. What to test, in order, on the live site

1. **Tutor opens `/live`.** Expect the EasyWay classroom — dark shell, logo top
   left, quality pill, hand queue, reaction bar. If you see a plain video call
   with a Jitsi watermark, the deploy did not pick up `LIVEKIT_URL`.
2. **Camera, microphone, screen share all turn on.** This is the exact set that
   failed before.
3. **Student joins from a second device.** Two-way audio and video.
4. **Read the join code off the tutor's screen, type it on the student's
   `/live` page.** It should open the room. This was dead by construction
   before — the code loaded the session and the stale "No class in session"
   screen rendered on top of it.
5. **End the class, wait ~5 minutes, open Materials → Watch.** The recording
   should appear. If not, check the webhook from step 2, then hit
   `POST /api/live/recording/reconcile` as an admin.
6. **Community.** A morning A1 student must see only the morning room. Confirm
   an afternoon student of the same level sees a different room with different
   messages.
7. **Popups.** With a student on `/dashboard` (not the community page), post
   from the tutor account. Within ~8 seconds a card should appear bottom-right
   carrying **the actual message text**, and clicking it should open that room.

---

## 5. Known gaps, stated plainly

- **Chat images** are modelled and rendered (`attachmentUrl`) but there is no
  upload button in the composer yet. The field is wired end to end; only the
  picker is missing.
- **Chat does not push to phones.** Ordinary messages deliberately write no
  `Notification` rows — one message in a class of forty would write forty, and
  the bell would be useless inside a week. Announcements do, and those push.
  If you want every message on the lock screen, that is a separate decision
  with a real cost.
- **Message editing** exists in the API (`PATCH`) but has no UI control yet.
- Still missing from production env and unrelated to this work:
  `PAYSTACK_SECRET_KEY`, `ANTHROPIC_API_KEY`, `STORAGE_PUBLIC_BASE_URL`.
  Payments and the AI assistant will not work in production without them.
