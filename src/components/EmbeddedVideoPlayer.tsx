/**
 * Embedded video viewer for YouTube, TikTok, Vimeo, Instagram, etc.
 */

'use client';

import { parseEmbedUrl, isIframeEmbeddable, getProviderDisplayName } from '@/lib/embed-utils';

interface EmbeddedVideoPlayerProps {
  title: string;
  url: string;
  description?: string | null;
  provider?: string;
}

export default function EmbeddedVideoPlayer({
  title,
  url,
  description,
  provider,
}: EmbeddedVideoPlayerProps) {
  const embedData = parseEmbedUrl(url);

  if (!embedData) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
        <p className="text-[var(--muted)]">Unable to load this video</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline mt-2 inline-block"
        >
          Open {url} in new tab
        </a>
      </div>
    );
  }

  const iframeEmbeddable = isIframeEmbeddable(embedData.provider);
  const displayProvider = getProviderDisplayName(embedData.provider);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)] mb-2">{title}</h1>
        {description && (
          <p className="text-[var(--muted)] text-sm">{description}</p>
        )}
        <p className="text-xs text-[var(--muted)] mt-2">
          From {displayProvider}
        </p>
      </div>

      {/* Container for embedded content */}
      <div className="bg-[var(--surface)] rounded-lg overflow-hidden border border-[var(--border)]">
        {embedData.provider === 'youtube' && (
          <iframe
            width="100%"
            height="600"
            src={`https://www.youtube.com/embed/${embedData.videoId}?autoplay=0`}
            title={title}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="w-full"
            style={{ aspectRatio: '16 / 9', minHeight: '400px' }}
          />
        )}

        {embedData.provider === 'vimeo' && (
          <iframe
            width="100%"
            height="600"
            src={`https://player.vimeo.com/video/${embedData.videoId}`}
            title={title}
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="w-full"
            style={{ aspectRatio: '16 / 9', minHeight: '400px' }}
          />
        )}

        {embedData.provider === 'tiktok' && (
          <div className="flex items-center justify-center bg-[var(--background)] py-8">
            <iframe
              src={`https://www.tiktok.com/embed/v2/${embedData.videoId}`}
              width="325"
              height="700"
              frameBorder="0"
              allow="autoplay; encrypted-media"
              allowFullScreen
            />
          </div>
        )}

        {embedData.provider === 'instagram' && (
          <div
            className="flex items-center justify-center bg-[var(--background)] py-8"
            dangerouslySetInnerHTML={{
              __html: `
                <blockquote class="instagram-media" data-instgrm-permalink="${embedData.url}" data-instgrm-version="14">
                  <section></section>
                </blockquote>
                <script async src="//www.instagram.com/embed.js"></script>
              `,
            }}
          />
        )}

        {embedData.provider === 'url' && (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <p className="text-[var(--muted)] mb-4">
              This material is hosted on an external website
            </p>
            <a
              href={embedData.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Open in New Tab
            </a>
            <p className="text-xs text-[var(--muted)] mt-4">
              {embedData.url}
            </p>
          </div>
        )}
      </div>

      {/* Mobile note for TikTok/Instagram */}
      {(embedData.provider === 'tiktok' || embedData.provider === 'instagram') && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            💡 This content may display better on mobile or if you open it in a new tab
          </p>
        </div>
      )}
    </div>
  );
}
