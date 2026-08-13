/**
 * Utilities for parsing and embedding external URLs (YouTube, TikTok, Vimeo, etc.)
 */

export type EmbedProvider = 'youtube' | 'tiktok' | 'vimeo' | 'instagram' | 'url';

export interface EmbedData {
  provider: EmbedProvider;
  videoId: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  url: string;
}

/**
 * Parse a URL and extract provider and video ID
 */
export function parseEmbedUrl(url: string): EmbedData | null {
  const trimmedUrl = url.trim();

  // YouTube patterns
  const youtubeMatch =
    trimmedUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) ||
    trimmedUrl.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (youtubeMatch) {
    return {
      provider: 'youtube',
      videoId: youtubeMatch[1],
      thumbnailUrl: `https://img.youtube.com/vi/${youtubeMatch[1]}/maxresdefault.jpg`,
      durationSeconds: null, // YouTube duration would need API key
      url: `https://www.youtube.com/watch?v=${youtubeMatch[1]}`,
    };
  }

  // TikTok patterns
  const tiktokMatch =
    trimmedUrl.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/) ||
    trimmedUrl.match(/vm\.tiktok\.com\/(\w+)/) ||
    trimmedUrl.match(/vt\.tiktok\.com\/(\w+)/);
  if (tiktokMatch) {
    const videoId = tiktokMatch[1];
    return {
      provider: 'tiktok',
      videoId,
      thumbnailUrl: null, // TikTok doesn't allow direct thumbnail access
      durationSeconds: null,
      url: trimmedUrl,
    };
  }

  // Vimeo patterns
  const vimeoMatch = trimmedUrl.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
  if (vimeoMatch) {
    const videoId = vimeoMatch[1];
    return {
      provider: 'vimeo',
      videoId,
      thumbnailUrl: `https://i.vimeocdn.com/video/${videoId}.jpg`,
      durationSeconds: null,
      url: `https://vimeo.com/${videoId}`,
    };
  }

  // Instagram patterns
  const instagramMatch = trimmedUrl.match(/(?:instagram\.com|instagr\.am)\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/);
  if (instagramMatch) {
    return {
      provider: 'instagram',
      videoId: instagramMatch[1],
      thumbnailUrl: null,
      durationSeconds: null,
      url: trimmedUrl,
    };
  }

  // If it's a valid URL but no provider matches, return as generic URL
  if (isValidUrl(trimmedUrl)) {
    return {
      provider: 'url',
      videoId: trimmedUrl,
      thumbnailUrl: null,
      durationSeconds: null,
      url: trimmedUrl,
    };
  }

  return null;
}

/**
 * Validate if a string is a valid URL
 */
function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get embed HTML for different providers
 */
export function getEmbedHtml(embedData: EmbedData, width = 600, height = 400): string {
  switch (embedData.provider) {
    case 'youtube':
      return `<iframe width="${width}" height="${height}" src="https://www.youtube.com/embed/${embedData.videoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;

    case 'vimeo':
      return `<iframe width="${width}" height="${height}" src="https://player.vimeo.com/video/${embedData.videoId}" title="Vimeo video player" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;

    case 'tiktok':
      return `<blockquote class="tiktok-embed" cite="${embedData.url}" data-unique-id="${embedData.videoId}"><section></section></blockquote><script async src="https://www.tiktok.com/embed.js"></script>`;

    case 'instagram':
      return `<blockquote class="instagram-media" data-instgrm-captioned data-instgrm-permalink="${embedData.url}" data-instgrm-version="14"><section></section></blockquote><script async src="//www.instagram.com/embed.js"></script>`;

    case 'url':
      return `<p>Open this link to watch: <a href="${embedData.url}" target="_blank" rel="noopener noreferrer">${embedData.url}</a></p>`;

    default:
      return '';
  }
}

/**
 * Check if a provider is embeddable in an iframe
 */
export function isIframeEmbeddable(provider: EmbedProvider): boolean {
  return provider === 'youtube' || provider === 'vimeo';
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: EmbedProvider): string {
  const names: Record<EmbedProvider, string> = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    vimeo: 'Vimeo',
    instagram: 'Instagram',
    url: 'External Link',
  };
  return names[provider] || 'Video';
}

/**
 * Extract video ID from various URL formats
 */
export function extractVideoId(url: string, provider: EmbedProvider): string | null {
  const embedData = parseEmbedUrl(url);
  if (embedData && embedData.provider === provider) {
    return embedData.videoId;
  }
  return null;
}
