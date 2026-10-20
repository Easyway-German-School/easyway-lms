# This repo holds two unrelated projects — don't confuse their deploys

`easyway-lms` is a monorepo. It contains **two separate apps that deploy as two
separate Vercel projects**, with no shared runtime:

- **`prototype/`** — the real EasyWay LMS app. This is what actually builds and
  deploys as the **`easyway-lms`** Vercel project (see `scripts/vercel-postbuild.mjs`:
  "The real Next app lives in prototype/"). The root-level `src/` directory is a
  legacy mirror of `prototype/src/` that is NOT what gets built — `npm run build`
  builds `prototype/` and lifts its output to the repo root afterwards. A handful
  of files have been manually copied into root `src/` because the build's file
  tracing occasionally reaches there (see commit `02da885`); when fixing something
  in `prototype/src/`, check whether the same file exists under root `src/` and
  mirror the fix there too, as a matter of consistency, but the deployed behavior
  is governed by `prototype/`.

- **`osd-exam-centre/`** — a fully standalone Next.js app (the ÖSD exam centre),
  with its own `vercel.json`, deploying as the **`easyway-osd-exam-centre`**
  Vercel project. It shares no code, no imports, and no runtime with `prototype/`
  or root `src/`.

## The mistake to never repeat

A PR that only touches `prototype/` or root `src/` will still show a GitHub status
check for `Vercel – easyway-osd-exam-centre`, because Vercel is wired to build
every connected project on every push to the repo — **not** because the change
affected that project. Do not treat a red `easyway-osd-exam-centre` check as a
sign that an LMS-only change broke something, and do not spend time debugging
`osd-exam-centre` when the diff never touched it. Check which files the PR
actually changed before assuming a failing check is relevant: if none of them
are under `osd-exam-centre/`, that check's result is noise for this PR.

The reverse is just as true: a change inside `osd-exam-centre/` has no bearing on
the `easyway-lms` (`prototype/`) deploy.
