/**
 * The one number for "how short is too short to keep". `retention.ts`
 * (server-only: touches Prisma) re-exports it as
 * `RETENTION.minWorthKeepingSeconds`. The end-of-class prompt in
 * `LiveCallContext.tsx` runs in the browser and needs the same number to
 * decide whether to ask "delete this recording?" — importing retention.ts
 * there would pull Prisma into the client bundle, so this constant stays
 * standalone with zero imports. Keeping it in one file is what stops the
 * two from ever drifting apart again.
 */
export const SHORT_RECORDING_SECONDS = 30 * 60;
