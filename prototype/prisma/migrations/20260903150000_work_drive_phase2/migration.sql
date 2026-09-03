-- Work Drive, Phase 2: content search.
--
-- Phase 0 gave DriveFile a filename-only `searchVector` (a generated column +
-- GIN index). This adds the file's extracted text so a search for a word
-- INSIDE a document finds it:
--
--   * `textContent` — a capped slice of the extracted text, denormalised onto
--     the row (the fuller copy is in DriveFileText, added in Phase 0);
--   * a second GIN index over `to_tsvector('simple', textContent)`, which the
--     search route ORs with the filename vector.
--
-- No destructive change to the existing generated column — the two indexes are
-- queried together instead. Hand-written and idempotent, per
-- prisma/manual/README.

ALTER TABLE "DriveFile" ADD COLUMN IF NOT EXISTS "textContent" TEXT;

CREATE INDEX IF NOT EXISTS "DriveFile_textContent_fts_idx"
  ON "DriveFile"
  USING GIN (to_tsvector('simple', coalesce("textContent", '')));
