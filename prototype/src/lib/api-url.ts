export function getApiUrl(path: string) {
  if (typeof window === "undefined") {
    return path.startsWith("/") ? path : `/${path}`;
  }

  const configuredBase = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = configuredBase ? configuredBase.replace(/\/$/, "") : window.location.origin;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${base}${normalizedPath}`;
}
