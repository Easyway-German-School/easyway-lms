-- Which named packages (e.g. "Exam Preparatory") a tutor's coverage is scoped
-- to — see ASSIGNABLE_PATHWAYS in src/lib/lecturer-assignment.ts.
-- Null/empty means no restriction, same as classTypes/batches above it.
-- Additive and idempotent.
ALTER TABLE "Lecturer" ADD COLUMN IF NOT EXISTS "pathways" JSONB;
