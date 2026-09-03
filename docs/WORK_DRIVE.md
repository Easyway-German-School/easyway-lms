# Work Drive

_Status: in build. Design doc — mark it up._
_Owner: engineering. Requested by: Jason (Sept 2026)._

---

## What this is

A staff-only area of the admin portal where the office keeps the working files
that have no home in the LMS today — policies, letterhead and form templates,
finance spreadsheets, scanned receipts and contracts, HR files, board minutes,
marketing assets — **and** plans the things those files are for: staff meetings,
training days, events, and webinars.

Right now that material lives in people's personal Google Drives and email
threads. It is scattered, has no access control, and walks out the door when a
staff member leaves. The Work Drive gives each school one place for it, inside
the system that already handles their students, with the same tenant isolation,
audit trail, soft deletes and off-provider backups everything else here gets.

## What it is not

Not a Dropbox clone. No desktop sync client, no deep version trees, no
real-time co-editing, no public file-sharing links in v1. Schools already
running Google Workspace will not migrate off it — this is for the ones that
don't, plus a canonical home for platform-issued templates.

## The shape that makes it ours

The organising unit is a **Workspace** — a small team hub that holds files
*plus* its own calendar *plus*, optionally, a live room. Not "My Drive /
Shared with me / Trash". An admin spins up a Workspace for a department, a
project, or a specific event, and everything for that thing lives together:
the files, the schedule, the meeting, the webinar, the activity feed.

(The name `Space` is already taken by the community chat feature, hence
`Workspace`.)

---

## Data model

### Conventions (every new model)

- `tenantId String?` + `tenantRef Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)` + `@@index([tenantId])`, matching every other tenant-owned table. Back-relations added to `Tenant` by hand (the `scripts/add-tenant-columns.mjs` pattern).
- `deletedAt DateTime?` soft delete. The Prisma guard already enforces tenant scoping and blast-radius limits on every write.
- Every stored datetime is paired with an explicit IANA `timezone` string. (A past bug had every JWT four hours future-dated from a machine timezone mistake — datetimes here never rely on server-local time.)
- The audit trail is automatic for anything behind `requireCapability()`.

### Files

| Model | Purpose | Key fields |
|---|---|---|
| `Workspace` | The container. | `name`, `slug`, `icon`, `color`, `kind` (`general` \| `department` \| `project` \| `event`), `visibility` (`private` \| `staff` \| `branch`), `branchId?`, `createdById`, `archivedAt?`, `storageUsedBytes` (denormalised counter for the quota meter) |
| `WorkspaceMember` | Who is in a private workspace and at what level. | `workspaceId`, `userId`, `role` (`owner` \| `editor` \| `viewer`), `addedById` — `@@unique([workspaceId, userId])` |
| `DriveFolder` | Folder tree inside a workspace. | `workspaceId`, `parentId?` (self-relation), `name`, `path` (materialised, e.g. `/Finance/2026/Q3`, for breadcrumbs and prefix search), `createdById` |
| `DriveFile` | One file. | `workspaceId`, `folderId?` (null = workspace root), `name`, `mimeType`, `sizeBytes`, `storageKey` (R2 object key), `checksum` (sha256, integrity + dedupe), `currentVersionId?`, `kind` (derived: `document` \| `spreadsheet` \| `image` \| `video` \| `audio` \| `pdf` \| `archive` \| `other`, drives the icon), `searchVector` (Postgres `tsvector`, GIN index) |
| `DriveFileVersion` | Immutable prior versions. | `fileId`, `versionNumber`, `storageKey`, `sizeBytes`, `checksum`, `uploadedById`, `note?` ("what changed") — no `deletedAt`; pruned by a retention job |
| `DriveFileText` | Extracted text for search, kept off the hot row. | `fileId` (unique), `content` (from `pdf-parse` / `mammoth`), `extractedAt` |
| `FileShare` | Grant one staff user access to one file/folder they're not a workspace member of. | `targetType` (`file` \| `folder`) + `targetId`, `sharedById`, `sharedWithUserId`, `permission` (`view` \| `edit`), `expiresAt?`, `revokedAt?` — **no public link tokens in v1** |
| `FileActivity` | The in-UI activity feed (distinct from the security audit log). | `workspaceId`, `fileId?`, `folderId?`, `actorId`, `action` (`uploaded` \| `renamed` \| `moved` \| `new_version` \| `deleted` \| `restored` \| `shared` \| `downloaded` \| `commented`), `meta Json` |
| `FileComment` | Thread on a file. | `fileId`, `authorId`, `body`, `deletedAt?` |

### Events / staff calendar

| Model | Purpose | Key fields |
|---|---|---|
| `WorkEvent` | A calendar entry: meeting, deadline, holiday, training, event, webinar. | `workspaceId?` (null = tenant-wide), `branchId?`, `title`, `description`, `kind` (`meeting` \| `deadline` \| `holiday` \| `training` \| `event` \| `webinar`), `location`, `startAt` / `endAt`, `allDay`, `rrule?` (RFC 5545, the `rrule` npm lib), `timezone`, `visibility` (`workspace` \| `staff` \| `branch` \| `public`), `webinarId?`, `coverImageKey?`, `status` (`draft` \| `scheduled` \| `live` \| `ended` \| `cancelled`), `createdById` |
| `EventAttendee` | Invitees and registrants — internal or external. | `eventId`, `userId?` (staff) **or** `externalName` / `externalEmail` (guests, webinar registrants), `response` (`invited` \| `accepted` \| `declined` \| `tentative` \| `attended` \| `no_show`), `role` (`host` \| `co_host` \| `presenter` \| `attendee`), `checkInAt?`, `reminderSentAt?`, `registrationSource?` |
| `EventTask` | The "plan the event" checklist. | `eventId`, `title`, `assigneeId?`, `dueAt?`, `done`, `doneAt?` / `doneById?`, `order` |
| `EventResource` | Files attached to an event — agenda decks, handouts. | `eventId`, `fileId` (→ `DriveFile`), `label`, `visibleToAttendees` (publish to registrants after) |

### Webinars

Rides on the LiveKit SFU and the class-recording pipeline that already exist.

| Model | Purpose | Key fields |
|---|---|---|
| `Webinar` | Delivery side; the `WorkEvent` owns scheduling and attendees. | `eventId` (1:1), `roomName` (LiveKit, unique), `mode` (`webinar` — stage + muted audience \| `meeting` — everyone can talk), `audience` (`staff` \| `students` \| `branch` \| `public` \| `mixed`), `registrationRequired`, `registrationOpensAt?` / `registrationClosesAt?`, `capacity?`, `landingSlug?` (`/w/<slug>` public page), `landingConfig Json` (headline, speaker bios, agenda), `allowQuestions`, `allowChat`, `recordAutomatically` (default true), `recordingId?` (→ existing `ClassRecording` / `Material`), `startedAt?` / `endedAt?` |
| `WebinarQuestion` | Q&A panel with upvotes. | `webinarId`, `askedByUserId?` / `askedByName?`, `body`, `upvotes` (denormalised) + `WebinarQuestionVote` join for dedupe, `status` (`pending` \| `answered` \| `dismissed`), `answeredById?` / `answeredAt?` / `answerText?` |

Registration = `EventAttendee` rows with `externalEmail`. Polls deferred to v2.

### Tenant wiring

- New `SchoolSetting` keys: `work_drive.enabled` (feature flag), `work_drive.quota` (`{ bytes: number | null }`, null = platform default). Helper in `src/lib/work-drive/settings.ts` following the `school-settings.ts` `parse` / `default` / strict-overload pattern.
- New capabilities in `src/lib/admin-roles.ts` `CAPABILITIES`: **`work_drive`** (access + manage files/workspaces) and **`events`** (calendar + webinars). Granted to `super` (via `"all"`); `secretary` gets `events`; hand-grant `work_drive` per person otherwise. Revisit presets with Jason.
- Client upload: extend `UploadFolder` and the `/api/media/presign` `FOLDERS` allowlist with `work-drive`. Uploads go **direct to R2** — the 4.5 MB Vercel body cap makes the proxy path unusable for real documents.

---

## Build plan

Each phase ships, deploys, and is committed before the next starts. "Done"
means live and demonstrated, not "it typechecks".

### Phase 0 — schema + gates _(no UI, safe deploy)_

Add every Files-pillar model, the two `SchoolSetting` keys, and the two
capabilities. One Prisma migration authored from `prototype/`; confirm
`prisma migrate deploy` runs clean on the Vercel build. No behaviour change.

### Phase 1 — Files MVP _(the core ask)_

`/admin/work-drive`, gated on `work_drive`, hidden unless `work_drive.enabled`.

- Workspace list + create (name, icon from the shared icon set, colour from theme tokens, visibility).
- Inside a workspace: folder tree (`react-arborist`), breadcrumbs, file list.
- Upload direct to R2 via the presign route (large / resumable via `tus` or Uppy); download via a short-TTL signed GET.
- Rename / move / soft-delete / restore; a Trash view per workspace.
- `FileActivity` feed, per workspace and per file.
- Search: filename `ILIKE` first, plus a name-only `tsvector`.
- Icons per file kind, theme-safe (no emoji). `min-w-0` on `<main>`; verified at 375 px.

### Phase 2 — sharing & collaboration

- `WorkspaceMember` management (add staff, set role).
- Per-file `FileShare` to a named staff user (`view` / `edit`); a "Shared with me" view.
- `FileComment` threads; `notify()` on share and on comment mention.
- Versioning UI: upload a new version, see history, restore, download an old one.
- Text-extraction job (`pdf-parse`, `mammoth`) → `DriveFileText` → richer search vector.

### Phase 3 — staff calendar / events

- `WorkEvent`, `EventAttendee`, `EventTask`, `EventResource`.
- Month / week / agenda calendar as its own nav item, cross-linked into workspaces.
- Create event: kind, time, location, staff invitee picker, attach files, checklist.
- RSVP + attendee list + check-in.
- Recurrence via `rrule`; explicit IANA `timezone` stored on every event.
- Cron (the one dispatcher): reminders at T-24h / T-1h / T-10m via `notify()` + Brevo.
- Read-only per-user `.ics` feed (token URL) so it drops into Google / Outlook.

### Phase 4 — webinars

- `Webinar`, `WebinarQuestion` (+ votes). Registration folds into `EventAttendee`.
- Creating a webinar = `WorkEvent(kind: webinar)` + `Webinar` row + a LiveKit room.
- Host console reuses the live-classroom components (speaking meters, end screen) in webinar mode: audience muted, raise-hand → promote-to-presenter.
- Q&A panel with upvotes; chat from the community-chat components.
- Auto-record on host join → existing recording pipeline → Video Library entry, scoped visibility.
- Public landing page `/w/<slug>` for `public` audience: headline, speakers, agenda, register form → `EventAttendee` + double opt-in email. Add `/w/*` to the `proxy.ts` public allowlist.
- After the event: email the recording + handouts (`EventResource.visibleToAttendees`) to registrants.

### Phase 5 — platform polish

- Quota enforcement on upload + a usage meter in the workspace header and the EduPrime billing console.
- Trash auto-purge cron (30 days, mirrors the portal-lock grace period) + `DriveFileVersion` retention cron.
- Verify Work Drive R2 keys are covered by the `BackupRun` manifest.
- A welcome-tour stop for the new nav.
- Audit-trail coverage check on every new mutation route.
- Per-tenant flag toggle in the platform console + tenant settings UI.

---

## Libraries to add

All MIT: `tus-js-client` + `tus-node-server` (or Uppy), `rrule`, `pdf-parse`,
`mammoth`, `react-arborist`. Everything else — R2 storage, the upload lib,
`requireCapability()`, the audit trail, backups, LiveKit, the recording
pipeline, `notify()`, the icon set, theming, per-tenant isolation — is already
in the tree.

## Open questions for Jason

1. Capability presets — should `secretary` get `work_drive` too, or stays hand-granted?
2. Default per-tenant storage quota, and does it meter into EduPrime billing?
3. Do students ever see a Workspace (e.g. a shared "event" workspace for a public webinar), or is the whole feature staff-only?
4. Webinars to the public internet (`/w/<slug>`) in v1, or staff/student audiences only to start?
5. Version retention: keep last N versions, or last 90 days, or both?
