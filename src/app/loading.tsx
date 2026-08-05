import BrandLoader from "@/components/BrandLoader";

/**
 * Route-level loading UI. The App Router streams this in whenever a navigation
 * suspends on server work, and it covers every nested segment that does not
 * define its own loading.tsx — which is all of them, so this is the single
 * answer to "long page loads" across the app.
 *
 * Fast navigations never render it: Next only shows a loading boundary once the
 * request actually suspends.
 */
export default function Loading() {
  return <BrandLoader fill size="lg" />;
}
