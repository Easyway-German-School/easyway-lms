export function getApiBaseUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000";
}

export function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();

  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL(normalizedPath, baseUrl).toString();
  }

  return normalizedPath;
}
