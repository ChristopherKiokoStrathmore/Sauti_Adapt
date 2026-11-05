/**
 * Page-world script, injected on x.com / twitter.com only.
 * Copies GraphQL thread responses to the content script with postMessage;
 * it never changes a request or a response.
 */
type Xhr = XMLHttpRequest & { __hoverTwitterUrl?: string };

(function installTwitterInterceptor() {
  if (window.__hoverTwitterInterceptorInstalled) return;
  window.__hoverTwitterInterceptorInstalled = true;

  function safePost(payload: { url: string; json: unknown }) {
    try {
      window.postMessage({ source: 'hover-preview-twitter', type: 'TWITTER_GQL_RESPONSE', payload }, '*');
    } catch (error) {
      console.error('[Headway][Twitter] postMessage failed:', error);
    }
  }

  function shouldCapture(url: string | undefined): url is string {
    if (!url) return false;
    if (url.indexOf('/i/api/graphql/') === -1) return false;
    return /TweetDetail|TweetResultByRestId|ConversationTimeline|threaded_conversation/i.test(url);
  }

  function handleResponse(url: string | undefined, clonePromise: Promise<Response>) {
    if (!shouldCapture(url)) return;
    clonePromise
      .then((clone) => clone.json().then((json: unknown) => safePost({ url, json })).catch(() => {}))
      .catch(() => {});
  }

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(this: typeof globalThis, input: RequestInfo | URL, init?: RequestInit) {
    try {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      return originalFetch.call(this, input, init).then((response) => {
        try {
          handleResponse(requestUrl, Promise.resolve(response.clone()));
        } catch {
          // never break the page's own request
        }
        return response;
      });
    } catch {
      return originalFetch.call(this, input, init);
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: Xhr, ...args: Parameters<XMLHttpRequest['open']>) {
    this.__hoverTwitterUrl = String(args[1]);
    return (originalOpen as (...a: unknown[]) => void).apply(this, args);
  } as XMLHttpRequest['open'];

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: Xhr, body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener('load', function onLoad(this: Xhr) {
      try {
        const responseType = this.responseType;
        if (!responseType || responseType === 'text') {
          const url = this.__hoverTwitterUrl;
          if (!shouldCapture(url)) return;
          handleResponse(url, Promise.resolve(new Response(this.responseText)));
        }
      } catch {
        // never break the page's own request
      }
    });
    return originalSend.call(this, body);
  };
})();

export {};
