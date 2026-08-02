# Journey map artwork

Drop the German Journey Map here, one file per level, named by the level:

    A1.png   A2.png   B1.png   B2.png   C1.png   C2.png

Nothing else needs changing. The dashboard card and the once-a-day reminder
both read from here (`src/lib/journey-map.ts`), and each picks the file
matching the student's own level.

A level with no file here shows **nothing** — no card, no popup, no broken
image. So it is safe to add them one at a time as the artwork is finished.
