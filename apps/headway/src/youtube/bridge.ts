/**
 * YouTube content bridge (isolated-world content script, youtube.com only).
 * Injects the page-world caption handler and relays its captions to the
 * worker and to the main content script.
 */
import type { CaptionData, RuntimeMessage } from '../shared/types';
import { errorMessage } from '../shared/types';

(function () {
  console.log('[YouTube Bridge] Initializing...');

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('dist/youtube-caption-handler.js');
  script.onload = () => {
    console.log('[YouTube Bridge] Caption handler injected');
    script.remove();
  };
  script.onerror = (e) => console.error('[YouTube Bridge] Failed to load handler:', e);
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('youtube-captions-ready', (event) => {
    const { videoId, captionCount } = (event as CustomEvent<{ videoId: string; captionCount: number }>).detail;
    console.log(`[YouTube Bridge] Captions ready for ${videoId}: ${captionCount} captions`);
    window.dispatchEvent(new CustomEvent('yt-captions-available', { detail: { videoId, captionCount } }));
  });

  interface Pending { resolve: (data: CaptionData | null) => void; reject: (error: Error) => void }
  const pendingCaptionRequests = new Map<number, Pending>();
  let requestIdCounter = 0;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { type?: string; requestId?: number; success?: boolean; data?: CaptionData | null; videoId?: string } | null;
    if (data?.type !== 'YT_CAPTIONS_RESPONSE' || typeof data.requestId !== 'number') return;
    const pending = pendingCaptionRequests.get(data.requestId);
    if (!pending) return;
    pendingCaptionRequests.delete(data.requestId);
    if (data.success) {
      console.log('[YouTube Bridge] Received captions for:', data.videoId);
      pending.resolve(data.data ?? null);
    } else {
      console.warn('[YouTube Bridge] No captions for:', data.videoId);
      pending.reject(new Error('NO_CAPTIONS'));
    }
  });

  function getCaptionsFromPage(videoId: string): Promise<CaptionData | null> {
    return new Promise((resolve, reject) => {
      const requestId = ++requestIdCounter;
      pendingCaptionRequests.set(requestId, { resolve, reject });
      window.postMessage({ type: 'YT_GET_CAPTIONS', requestId, videoId }, '*');
      setTimeout(() => {
        if (pendingCaptionRequests.has(requestId)) {
          pendingCaptionRequests.delete(requestId);
          reject(new Error('TIMEOUT'));
        }
      }, 1000);
    });
  }

  window.getYouTubeCaptions = async (videoId: string) => {
    try {
      return await getCaptionsFromPage(videoId);
    } catch {
      return null;
    }
  };

  window.hasYouTubeCaptions = async (videoId: string) => {
    try {
      return (await getCaptionsFromPage(videoId)) !== null;
    } catch {
      return false;
    }
  };

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.action !== 'GET_YOUTUBE_CAPTIONS' || !message.videoId) return;
    const videoId = message.videoId;
    console.log('[YouTube Bridge] Caption request for:', videoId);
    getCaptionsFromPage(videoId)
      .then((captions) => sendResponse({ success: true, data: captions, videoId }))
      .catch((error: unknown) => {
        console.warn('[YouTube Bridge] Failed to get captions:', errorMessage(error));
        sendResponse({ success: false, error: errorMessage(error), videoId });
      });
    return true; // async response
  });

  console.log('[YouTube Bridge] Ready!');
})();

export {};
