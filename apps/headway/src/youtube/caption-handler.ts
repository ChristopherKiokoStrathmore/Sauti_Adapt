/**
 * Page-world script, injected on youtube.com only.
 * Watches the player's own caption (timedtext) requests and keeps a copy per video,
 * so the content script can ask for them over postMessage.
 */
import type { CaptionSegment } from '../shared/types';

type Xhr = XMLHttpRequest & { _ytCaptionUrl?: string };

interface CachedCaptions {
  videoId: string;
  captions: CaptionSegment[];
  text: string;
  timestamp: number;
}

interface Json3Event { segs?: { utf8?: string }[]; tStartMs?: number; dDurationMs?: number }

(function () {
  if (!window.location.hostname.includes('youtube.com')) return;

  console.log('[YouTube Handler] Initializing caption handler...');
  const captionCache = new Map<string, CachedCaptions>();

  function extractVideoId(url: string): string | null {
    const patterns = [
      /[?&]v=([^&\n?#]+)/,
      /\/vi\/([^/]+)/,
      /\/vi_webp\/([^/]+)/,
      /youtu\.be\/([^&\n?#]+)/,
      /\/embed\/([^&\n?#]+)/,
      /\/shorts\/([^&\n?#]+)/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }
    return null;
  }

  function parseCaptions(data: string): CaptionSegment[] {
    try {
      // JSON3 (current YouTube format)
      if (data.includes('"events"')) {
        const json = JSON.parse(data) as { events?: Json3Event[] };
        if (json.events) {
          return json.events
            .filter((e): e is Json3Event & { segs: { utf8?: string }[] } => !!e.segs)
            .map((e) => ({
              start: (e.tStartMs ?? 0) / 1000,
              duration: (e.dDurationMs ?? 0) / 1000,
              text: e.segs.map((s) => s.utf8 ?? '').join('')
            }));
        }
      }
      // XML (older YouTube format)
      if (data.includes('<text ')) {
        const xml = new DOMParser().parseFromString(data, 'text/xml');
        return Array.from(xml.getElementsByTagName('text')).map((node) => ({
          start: parseFloat(node.getAttribute('start') ?? '') || 0,
          duration: parseFloat(node.getAttribute('dur') ?? '') || 0,
          text: node.textContent || ''
        }));
      }
    } catch (e) {
      console.error('[YouTube Handler] Parse error:', e);
    }
    return [];
  }

  const captionsToText = (captions: CaptionSegment[]) => captions.map((c) => c.text).join(' ').trim();

  function setupInterception() {
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (this: Xhr, ...args: Parameters<XMLHttpRequest['open']>) {
      this._ytCaptionUrl = String(args[1]);
      return (originalXHROpen as (...a: unknown[]) => void).apply(this, args);
    } as XMLHttpRequest['open'];

    XMLHttpRequest.prototype.send = function (this: Xhr, body?: Document | XMLHttpRequestBodyInit | null) {
      const xhr = this;
      const url = xhr._ytCaptionUrl;
      if (url && (url.includes('timedtext') || url.includes('caption'))) {
        const videoId = extractVideoId(url);
        if (videoId) {
          console.log(`[YouTube Handler] Intercepting captions for: ${videoId}`);
          xhr.addEventListener('load', () => {
            try {
              const captions = parseCaptions(xhr.responseText);
              if (captions.length > 0) {
                captionCache.set(videoId, { videoId, captions, text: captionsToText(captions), timestamp: Date.now() });
                console.log(`[YouTube Handler] Captured ${captions.length} captions for ${videoId}`);
                window.dispatchEvent(new CustomEvent('youtube-captions-ready', {
                  detail: { videoId, captionCount: captions.length }
                }));
              }
            } catch (err) {
              console.error('[YouTube Handler] Error processing captions:', err);
            }
          });
        }
      }
      return originalXHRSend.call(this, body);
    };
    console.log('[YouTube Handler] XHR interception active');
  }

  window.__ytGetCaptions = (videoId: string) => captionCache.get(videoId) || null;
  window.__ytHasCaptions = (videoId: string) => captionCache.has(videoId);
  window.__ytClearCache = () => {
    captionCache.clear();
    console.log('[YouTube Handler] Cache cleared');
  };

  window.addEventListener('message', (event: MessageEvent<{ type?: string; requestId?: number; videoId?: string }>) => {
    if (event.source !== window) return;
    if (event.data?.type === 'YT_GET_CAPTIONS') {
      const { requestId, videoId } = event.data;
      const captionData = videoId ? captionCache.get(videoId) : undefined;
      window.postMessage({
        type: 'YT_CAPTIONS_RESPONSE',
        requestId,
        videoId,
        success: !!captionData,
        data: captionData || null
      }, '*');
    }
  });

  setupInterception();
  console.log('[YouTube Handler] Ready! Monitoring for caption requests...');
})();

export {};
