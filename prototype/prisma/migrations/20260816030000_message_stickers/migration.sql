-- Stickers: the school's own set, sent instead of text.
--
-- One nullable column. No existing column changes type, no index is dropped,
-- no data is touched, and nothing currently deployed reads it — so applying
-- early breaks nothing and applying late loses nothing.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

-- An ID, never an image URL, and that is the whole point. The artwork is drawn
-- in code (src/lib/community-stickers.tsx), so a sticker sent today still
-- renders after the set is redrawn, costs no storage, needs no upload path and
-- cannot 404 the way a file on a bucket eventually does.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "stickerId" TEXT;
