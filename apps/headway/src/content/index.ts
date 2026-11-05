import { Readability } from '@mozilla/readability';
import { formatAISummary, escapeHtml } from '../shared/format';
import { tooltipCss, tooltipHead, waitHtml } from '../shared/page-theme';
import type { DisplayMode, RuntimeMessage, SummaryResult, ThreadPayload, ThreadResponse, TweetMedia, TweetNode } from '../shared/types';
import { errorMessage } from '../shared/types';
import { SUMMARIES_ENABLED } from '../shared/features';

/** X/Twitter GraphQL responses are large, undocumented and change often; walk them as plain JSON. */
type Json = Record<string, any>;
interface TweetInfo { id: string; url: string; displayUrl: string }
/** Hover bookkeeping Nutshell stores directly on the hovered elements. */
type HoverLink = HTMLAnchorElement & {
  __hoverTweetInfo?: TweetInfo | null;
  __hoverArticle?: Element;
  __hoverCanonicalUrl?: string;
  __hoverAnchor?: Element;
  __hoverRequestToken?: number;
};
type HoverAnchor = Element & { __hoverAnchor?: Element };
type TooltipPlacement = 'auto' | 'left' | 'right';

(function() {
  'use strict';
  
  // Configuration
  const HOVER_DELAY = 300;
  const IS_YOUTUBE = window.location.hostname.includes('youtube.com');
  const IS_TWITTER = window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com');
  const DEBUG_ENABLED = !IS_YOUTUBE; // Disable logs on YouTube to reduce clutter
  
  // Debug logging helper
  const debugLog = (...args: unknown[]) => {
    if (DEBUG_ENABLED) console.log(...args);
  };
  
  const REDDIT_HOSTS = [
    'reddit.com',
    'www.reddit.com',
    'old.reddit.com',
    'new.reddit.com',
    'np.reddit.com',
    'redd.it'
  ];
  const TWITTER_HOSTS = new Set([
    'twitter.com',
    'www.twitter.com',
    'x.com',
    'www.x.com'
  ]);
  const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com'
  ]);
  
  // State management
  type Timer = ReturnType<typeof setTimeout>;
  let currentHoverTimeout: Timer | null = null;
  let hideTimeout: Timer | null = null;
  let currentlyProcessingUrl: string | null = null;
  let currentlyDisplayedUrl: string | null = null; // Track what URL the tooltip is currently showing
  let processingElement: Element | null = null; // Track element being processed for positioning
  let tooltip: HTMLDivElement | null = null;
  let tooltipContent: HTMLDivElement | null = null; // Content wrapper inside tooltip
  let tooltipCloseHandlerAttached = false;
  let twitterHoverTimeout: Timer | null = null;
  let currentTwitterArticle: Element | null = null;
  let currentTwitterTweetId: string | null = null;
  let pendingTwitterThreadId: string | null = null;
  let pendingTwitterStartedAt = 0;
  let displayMode: DisplayMode = 'tooltip';
  let gazeEnabled = false;
  let currentTooltipPlacement: TooltipPlacement = 'auto';
  let currentYouTubeRequestToken = 0;
  let currentHoveredElement: Element | null = null;
  let isMouseInTooltip = false;
  let displayTimes = new Map<string, number>(); // Track when each URL was displayed (url -> timestamp)
  let hoverTimeouts = new Map<string, { timeoutId: Timer; requestToken: number }>(); // Track hover timeouts per URL
  
  // Twitter-specific state
  const twitterGqlCache = new Map<string, Json[]>(); // tweetId -> array of captured JSON blobs
  let twitterInterceptorInstalled = false;
  
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const showsTooltip = () => displayMode === 'tooltip' || displayMode === 'both';
  const errorBox = (text: string) => `<p class="hw-tip-error">${escapeHtml(text)}</p>`;
  
  // Create tooltip
  function createTooltip(): { tip: HTMLDivElement; content: HTMLDivElement } {
    // If tooltip exists but doesn't have the content wrapper, recreate it
    if (tooltip && tooltipContent && tooltipContent.parentNode === tooltip) {
      return { tip: tooltip, content: tooltipContent };
    }

    // Remove old tooltip if it exists (for clean recreation)
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
      tooltip = null;
      tooltipContent = null;
    }
    
    if (!document.getElementById('hover-tooltip-styles')) {
      const style = document.createElement('style');
      style.id = 'hover-tooltip-styles';
      style.textContent = tooltipCss('hover-summary-tooltip', 'tooltip-close-btn');
      (document.head || document.documentElement).appendChild(style);
    }
    
    const tip = document.createElement('div');
    tooltip = tip;
    tip.id = 'hover-summary-tooltip';
    tip.style.display = 'none';
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-label', 'Headway summary');
    tip.insertAdjacentHTML('afterbegin', tooltipHead);

    // Create content wrapper (so innerHTML changes don't remove close button)
    const content = document.createElement('div');
    tooltipContent = content;
    content.className = 'tooltip-content-wrapper';
    tip.appendChild(content);

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tooltip-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close summary');
    closeBtn.setAttribute('data-gaze-clickable', 'true'); // Make it work with gaze dwell
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTooltip();
    });
    tip.appendChild(closeBtn);

    // Make tooltip interactive - prevent hiding when mouse enters
    tip.addEventListener('mouseenter', () => {
      isMouseInTooltip = true;
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = null;
    });

    // Hide with delay when mouse leaves tooltip
    tip.addEventListener('mouseleave', () => {
      isMouseInTooltip = false;
      scheduleHide(200); // Short delay when leaving tooltip
    });

    document.body.appendChild(tip);
    return { tip, content };
  }
  
  // Position tooltip
  function positionTooltip(element: Element | null, placement: TooltipPlacement = 'auto') {
    if (!tooltip || !element) return;
    
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 12;
    
    let top = rect.top;
    let left = rect.left;
    
    if (placement === 'right') {
      left = rect.right + gap;
      if (left + tooltipRect.width > viewportWidth - gap) {
        left = rect.left - gap - tooltipRect.width;
      }
      if (left < gap) {
        left = Math.max(gap, rect.left);
      }
      top = Math.max(gap, Math.min(rect.top, viewportHeight - tooltipRect.height - gap));
    } else if (placement === 'left') {
      left = rect.left - gap - tooltipRect.width;
      if (left < gap) {
        left = rect.right + gap;
      }
      if (left + tooltipRect.width > viewportWidth - gap) {
        left = Math.max(gap, viewportWidth - tooltipRect.width - gap);
      }
      top = Math.max(gap, Math.min(rect.top, viewportHeight - tooltipRect.height - gap));
    } else {
      if (rect.bottom + gap + tooltipRect.height < viewportHeight) {
        top = rect.bottom + gap;
      } else if (rect.top - gap - tooltipRect.height > 0) {
        top = rect.top - gap - tooltipRect.height;
      } else {
        top = Math.max(gap, (viewportHeight - tooltipRect.height) / 2);
      }
      left = rect.left;
      if (left + tooltipRect.width > viewportWidth - gap) {
        left = Math.max(gap, rect.right - tooltipRect.width);
      }
      if (left < gap) {
        left = gap;
      }
    }
    
    top = Math.max(gap, Math.min(top, viewportHeight - tooltipRect.height - gap));
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }
  
  const handleTooltipPointerDown = (event: PointerEvent) => {
    if (!tooltip || tooltip.style.display !== 'block') return;
    if (event.target instanceof Node && tooltip.contains(event.target)) {
      return;
    }
    hideTooltip();
  };
  
  const handleTooltipKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && tooltip && tooltip.style.display === 'block') {
      event.preventDefault();
      cancelActiveSummary('escape_key');
    }
  };
  
  function attachTooltipDismissHandlers() {
    if (tooltipCloseHandlerAttached) return;
    document.addEventListener('pointerdown', handleTooltipPointerDown, true);
    document.addEventListener('keydown', handleTooltipKeyDown, true);
    tooltipCloseHandlerAttached = true;
  }
  
  function detachTooltipDismissHandlers() {
    if (!tooltipCloseHandlerAttached) return;
    document.removeEventListener('pointerdown', handleTooltipPointerDown, true);
    document.removeEventListener('keydown', handleTooltipKeyDown, true);
    tooltipCloseHandlerAttached = false;
  }

  function cancelActiveSummary(reason = 'user_cancel') {
    const previousUrl = currentlyProcessingUrl;
    const wasYouTube = previousUrl ? (() => {
      try {
        const parsed = new URL(previousUrl, window.location.origin);
        return YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase());
      } catch (error) {
        return false;
      }
    })() : false;
    
    if (currentHoverTimeout) {
      clearTimeout(currentHoverTimeout);
      currentHoverTimeout = null;
    }
    hoverTimeouts.forEach(({ timeoutId }) => {
      clearTimeout(timeoutId);
    });
    hoverTimeouts.clear();
    
    hideTooltip();
    
    currentlyProcessingUrl = null;
    processingElement = null;
    currentHoveredElement = null;
    
    if (IS_TWITTER) {
      clearTwitterState();
    }
    
    if (wasYouTube) {
      const videoId = extractYouTubeVideoId(previousUrl);
      if (videoId) {
        chrome.runtime.sendMessage({
          action: 'ABORT_YOUTUBE_SUMMARY',
          videoId,
          reason
        });
      }
    }
  }
  
  // ============ Twitter-Specific Helpers ============
  
  function ensureTwitterInterceptor() {
    if (!IS_TWITTER || twitterInterceptorInstalled) return;
    twitterInterceptorInstalled = true;
    injectTwitterInterceptor();
    window.addEventListener('message', handleTwitterPostMessage);
  }
  
  function injectTwitterInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dist/twitter-interceptor.js');
    script.type = 'text/javascript';
    script.onload = () => {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }
  
  function handleTwitterPostMessage(event: MessageEvent) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'hover-preview-twitter' || data.type !== 'TWITTER_GQL_RESPONSE') return;
    try {
      const payload = data.payload;
      if (!payload || !payload.json) return;
      recordTwitterGqlPayload(payload.json);
    } catch (error) {
      console.warn('[Twitter] Failed to process intercepted payload:', error);
    }
  }
  
  function recordTwitterGqlPayload(json: Json) {
    const tweetIds = extractTweetIdsFromJson(json);
    if (!tweetIds.length) return;
    tweetIds.forEach((id) => {
      if (!twitterGqlCache.has(id)) {
        twitterGqlCache.set(id, []);
      }
      const entries = twitterGqlCache.get(id) ?? [];
      twitterGqlCache.set(id, entries);
      entries.push(json);
      if (entries.length > 8) {
        entries.shift();
      }
    });
  }
  
  function extractTweetIdsFromJson(obj: Json): string[] {
    const ids = new Set<string>();
    const visited = new Set<object>();
    
    function walk(node: Json) {
      if (!node || typeof node !== 'object') return;
      if (visited.has(node)) return;
      visited.add(node);
      
      if (node.rest_id || node.restId) {
        const id = String(node.rest_id || node.restId);
        if (id) ids.add(id);
      }
      
      if (node.legacy && node.legacy.id_str) {
        ids.add(String(node.legacy.id_str));
      }
      
      for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        const value = node[key];
        if (typeof value === 'object' && value !== null) {
          walk(value);
        }
      }
    }
    
    try {
      walk(obj);
    } catch (error) {
      console.warn('[Twitter] Failed to extract tweet IDs:', error);
    }
    
    return Array.from(ids);
  }
  
  function buildThreadFromCache(tweetId: string | null | undefined): ThreadPayload | null {
    if (!tweetId) return null;
    const blobs = twitterGqlCache.get(tweetId);
    if (!blobs || !blobs.length) return null;
    
    const nodesById = new Map<string, TweetNode>();
    blobs.forEach((blob) => {
      collectTweetsFromPayload(blob, nodesById);
    });
    
    if (!nodesById.size) return null;
    
    const rootNode = nodesById.get(tweetId) || Array.from(nodesById.values())[0];
    if (!rootNode) return null;
    
    const conversationId = rootNode.conversationId || null;
    const collectedNodes: TweetNode[] = [];
    
    nodesById.forEach((node) => {
      if (conversationId && node.conversationId && node.conversationId !== conversationId) {
        return;
      }
      collectedNodes.push(Object.assign({}, node));
    });
    
    if (!collectedNodes.length) return null;
    
    collectedNodes.sort((a, b) => {
      const aTime = a.timestamp || '';
      const bTime = b.timestamp || '';
      return aTime.localeCompare(bTime);
    });
    
    const limitedNodes = collectedNodes.slice(0, 20);
    if (!limitedNodes.some((node) => node.id === rootNode.id)) {
      limitedNodes.unshift(Object.assign({}, rootNode));
    }
    limitedNodes.forEach((node, index) => {
      node.order = index;
    });
    
    return {
      rootId: rootNode.id,
      conversationId,
      nodes: limitedNodes,
      source: 'interceptor'
    };
  }
  
  function collectTweetsFromPayload(obj: Json, map: Map<string, TweetNode>) {
    const visited = new Set<object>();
    
    function walk(node: Json) {
      if (!node || typeof node !== 'object') return;
      if (visited.has(node)) return;
      visited.add(node);
      
      const candidate = extractTweetCandidate(node);
      if (candidate) {
        const id = candidate.id;
        if (!map.has(id) || (candidate.text && candidate.text.length > (map.get(id)?.text || '').length)) {
          map.set(id, candidate);
        }
      }
      
      for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        const value = node[key];
        if (typeof value === 'object' && value !== null) {
          walk(value);
        }
      }
    }
    
    walk(obj);
  }
  
  function extractTweetCandidate(node: Json): TweetNode | null {
    const result = resolveTweetResult(node);
    if (!result) return null;
    
    const legacy = result.legacy || (result.tweet && result.tweet.legacy);
    if (!legacy) return null;
    
    const id = result.rest_id || (legacy && legacy.id_str);
    if (!id) return null;
    
    const userLegacy = (result.core && result.core.user_results && result.core.user_results.result && result.core.user_results.result.legacy) ||
                       (result.author && result.author.legacy) ||
                       null;
    
    const text = extractTweetText(result, legacy);
    const timestamp = legacy.created_at ? new Date(legacy.created_at).toISOString() : null;
    const conversationId = legacy.conversation_id_str || null;
    const handle = userLegacy ? userLegacy.screen_name : (legacy && legacy.screen_name) || null;
    const authorName = userLegacy ? userLegacy.name : null;
    const avatarUrl = userLegacy ? userLegacy.profile_image_url_https : null;
    const permalink = handle ? `https://x.com/${handle}/status/${id}` : (legacy.url || null);
    const inReplyToId = legacy.in_reply_to_status_id_str ? String(legacy.in_reply_to_status_id_str) : null;
    
    const media = extractTweetMedia(legacy);
    
    return {
      id: String(id),
      conversationId: conversationId ? String(conversationId) : null,
      authorName: authorName || null,
      handle: handle ? `@${handle}` : null,
      avatarUrl: avatarUrl || null,
      timestamp,
      permalink,
      text,
      media,
      inReplyToId,
      order: 0
    };
  }
  
  function resolveTweetResult(node: Json): Json | null {
    if (!node || typeof node !== 'object') return null;
    if (node.__typename === 'Tweet') return node;
    if (node.result && node.result.__typename === 'Tweet') return node.result;
    if (node.tweet && node.tweet.__typename === 'Tweet') return node.tweet;
    if (node.tweet_results && node.tweet_results.result && node.tweet_results.result.__typename === 'Tweet') return node.tweet_results.result;
    if (node.itemContent && node.itemContent.tweet_results && node.itemContent.tweet_results.result) {
      return node.itemContent.tweet_results.result;
    }
    if (node.item && node.item.itemContent && node.item.itemContent.tweet_results && node.item.itemContent.tweet_results.result) {
      return node.item.itemContent.tweet_results.result;
    }
    if (node.content && node.content.tweetResult && node.content.tweetResult.result) {
      return node.content.tweetResult.result;
    }
    if (node.content && node.content.itemContent && node.content.itemContent.tweet_results && node.content.itemContent.tweet_results.result) {
      return node.content.itemContent.tweet_results.result;
    }
    if (node.tweetResult && node.tweetResult.result) {
      return node.tweetResult.result;
    }
    if (node.tweet && node.tweet.core && node.tweet.core.tweet && node.tweet.core.tweet.legacy) {
      return node.tweet.core.tweet;
    }
    return null;
  }
  
  function extractTweetText(result: Json, legacy: Json): string {
    if (!legacy) return '';
    if (result.note_tweet && result.note_tweet.note_tweet_results && result.note_tweet.note_tweet_results.result) {
      const note = result.note_tweet.note_tweet_results.result;
      if (note && note.text) {
        return note.text;
      }
      if (note && Array.isArray(note.entity_set?.note_inline_media)) {
        const textPieces = [];
        if (note.entity_set?.richtext?.plain_text) {
          textPieces.push(note.entity_set.richtext.plain_text);
        }
        if (note.entity_set?.media) {
          note.entity_set.media.forEach((mediaItem: Json) => {
            if (mediaItem.alt_text) {
              textPieces.push(`[Image: ${mediaItem.alt_text}]`);
            }
          });
        }
        if (textPieces.length) {
          return textPieces.join('\n');
        }
      }
    }
    
    if (legacy.full_text) {
      return legacy.full_text;
    }
    
    if (legacy.text) {
      return legacy.text;
    }
    
    return '';
  }
  
  function extractTweetMedia(legacy: Json): TweetMedia[] {
    const media: TweetMedia[] = [];
    const entities: Json[] = (legacy.extended_entities && legacy.extended_entities.media) ||
                     (legacy.entities && legacy.entities.media) ||
                     [];
    
    entities.forEach((item) => {
      if (!item) return;
      if (item.type === 'photo') {
        media.push({
          kind: 'photo',
          urls: item.media_url_https ? [item.media_url_https] : []
        });
      } else if (item.type === 'animated_gif') {
        const variants: Json[] = (item.video_info && item.video_info.variants) || [];
        const urls: string[] = variants.filter((variant) => variant.url).map((variant) => variant.url);
        media.push({
          kind: 'gif',
          urls
        });
      } else if (item.type === 'video') {
        const variants: Json[] = (item.video_info && item.video_info.variants) || [];
        const urls: string[] = variants.filter((variant) => variant.url).map((variant) => variant.url);
        media.push({
          kind: 'video',
          urls,
          poster: item.media_url_https || null
        });
      }
    });
    
    return media;
  }
  
  async function extractThreadFromDom(articleElement: Element, tweetId: string): Promise<ThreadPayload | null> {
    try {
      await expandTwitterThread(articleElement);
    } catch (error) {
      console.warn('[Twitter] Expand thread failed:', error);
    }
    
    const articles = collectThreadArticles(articleElement);
    if (!articles.length) return null;
    
    const nodes: TweetNode[] = [];
    articles.forEach((article, index) => {
      const node = extractNodeFromArticle(article, index === 0, tweetId);
      if (node) {
        nodes.push(node);
      }
    });
    
    if (!nodes.length) return null;
    
    const deduped = new Map<string, TweetNode>();
    nodes.forEach((node) => {
      const existing = deduped.get(node.id);
      if (!existing || (node.text && node.text.length > (existing.text || '').length)) {
        deduped.set(node.id, node);
      }
    });
    const uniqueNodes = Array.from(deduped.values());
    if (!uniqueNodes.length) return null;
    
    uniqueNodes.sort((a, b) => {
      const aTime = a.timestamp || '';
      const bTime = b.timestamp || '';
      return aTime.localeCompare(bTime);
    });
    
    const limitedNodes = uniqueNodes.slice(0, 12);
    limitedNodes.forEach((node, index) => {
      node.order = index;
    });
    
    const rootNode = limitedNodes.find((node) => node.id === tweetId) || limitedNodes[0];
    return {
      rootId: rootNode.id,
      conversationId: rootNode.conversationId || null,
      nodes: limitedNodes,
      source: 'dom'
    };
  }
  
  async function waitForPrimaryTwitterArticle(timeout = 8000): Promise<Element | null> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const article = document.querySelector('article[role="article"]');
      if (article) return article;
      await sleep(150);
    }
    return null;
  }
  
  async function captureThreadForBackground(tweetId: string): Promise<ThreadPayload | null> {
    const start = Date.now();
    let lastPayload: ThreadPayload | null = null;
    while (Date.now() - start < 12000) {
      const cached = buildThreadFromCache(tweetId);
      if (cached && cached.nodes && cached.nodes.length > 1) {
        cached.source = 'background-intercept';
        return cached;
      }
      const rootArticle = await waitForPrimaryTwitterArticle();
      if (rootArticle) {
        await sleep(400);
        await preloadTwitterConversation(rootArticle, { passes: 6, skipRestore: true });
        await sleep(500);
        const payload = await extractThreadFromDom(rootArticle, tweetId);
        if (payload && Array.isArray(payload.nodes) && payload.nodes.length > 1) {
          payload.source = payload.source === 'dom' ? 'background-dom' : payload.source;
          return payload;
        }
        if (payload) {
          lastPayload = payload;
        }
      } else {
        await sleep(400);
      }
    }
    if (lastPayload && lastPayload.nodes && lastPayload.nodes.length) {
      lastPayload.source = 'background-dom';
    }
    return lastPayload;
  }

  async function expandTwitterThread(articleElement: Element | null, options: { skipRestore?: boolean } = {}) {
    const { skipRestore = false } = options || {};
    const scrollElement = document.scrollingElement || document.documentElement;
    const originalScrollTop = scrollElement.scrollTop;
    const originalBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    
    const expandButtons: HTMLElement[] = [];
    const buttonSelector = 'div[role="button"], button, a[role="link"]';
    const EXPAND_LABEL_REGEX = /(show|view|reveal).*(repl|thread|tweet)/i;
    
    try {
      for (let i = 0; i < 6; i++) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(buttonSelector));
        candidates.forEach((btn) => {
          const text = (btn.textContent || '').trim();
          if (text && EXPAND_LABEL_REGEX.test(text)) {
            expandButtons.push(btn);
          }
        });
        await sleep(160);
      }
      
      expandButtons.forEach((btn) => {
        try {
          btn.click();
        } catch (error) {}
      });
      
      if (articleElement && articleElement.scrollIntoView) {
        articleElement.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      }
      await sleep(260);
    } finally {
      if (!skipRestore) {
        scrollElement.scrollTop = originalScrollTop;
      }
      document.documentElement.style.scrollBehavior = originalBehavior || '';
    }
  }
  
  async function preloadTwitterConversation(articleElement: Element, options: { passes?: number; skipRestore?: boolean } = {}) {
    const { passes = 6, skipRestore = false } = options || {};
    const scrollElement = document.scrollingElement || document.documentElement;
    const originalScrollTop = scrollElement.scrollTop;
    const originalBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    
    try {
      for (let i = 0; i < passes; i++) {
        await expandTwitterThread(articleElement, { skipRestore: true });
        scrollElement.scrollBy(0, Math.max(window.innerHeight * 0.9, 600));
        await sleep(420 + (i * 90));
        await expandTwitterThread(articleElement, { skipRestore: true });
        await sleep(220);
      }
      scrollElement.scrollTo(0, document.body.scrollHeight);
      await sleep(600);
      await expandTwitterThread(articleElement, { skipRestore: true });
    } finally {
      if (!skipRestore) {
        scrollElement.scrollTop = originalScrollTop;
      }
      document.documentElement.style.scrollBehavior = originalBehavior || '';
    }
  }
  
  function collectThreadArticles(rootArticle: Element | null): Element[] {
    const articles = new Set<Element>();
    if (rootArticle) {
      articles.add(rootArticle);
    }
    
    const timelineSelectors = [
      '[aria-label^="Timeline:"]',
      '[data-testid="primaryColumn"]',
      'main[role="main"]'
    ];
    timelineSelectors.forEach((selector) => {
      const container = document.querySelector(selector);
      if (container) {
        container.querySelectorAll('article[role="article"]').forEach((article) => articles.add(article));
      }
    });
    
    document.querySelectorAll('article[role="article"]').forEach((article) => articles.add(article));
    
    return Array.from(articles);
  }
  
  function extractNodeFromArticle(article: Element, isRoot: boolean, fallbackTweetId: string | null): TweetNode | null {
    const link = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
    const match = link?.getAttribute('href')?.match(/status\/(\d+)/) ?? null;
    const id = match ? match[1] : (isRoot && fallbackTweetId ? fallbackTweetId : null);
    if (!id) return null;
    
    const handleEl = article.querySelector('div[dir="ltr"] span');
    const handle = handleEl ? handleEl.textContent : null;
    const textEl = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText.trim() : '';
    const timeEl = article.querySelector('time');
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : null;
    
    const media: TweetMedia[] = [];
    const imageEls = Array.from(article.querySelectorAll('img'));
    imageEls.forEach((img) => {
      if (!img || !img.src) return;
      const alt = img.alt || '';
      const dimensions = img.width && img.height ? img.width * img.height : 0;
      if (dimensions > 40000 || alt.toLowerCase().includes('image')) {
        media.push({
          kind: 'photo',
          urls: [img.src]
        });
      }
    });
    
    return {
      id: String(id),
      conversationId: null,
      authorName: null,
      handle: handle || null,
      avatarUrl: null,
      timestamp,
      permalink: link ? link.href : null,
      text,
      media,
      inReplyToId: null,
      order: 0,
      source: 'dom'
    };
  }
  
  function formatTwitterThreadForSummary(threadPayload: ThreadPayload | null): string {
    if (!threadPayload || !threadPayload.nodes || !threadPayload.nodes.length) {
      return '';
    }
    
    const lines: string[] = [];
    threadPayload.nodes.forEach((node, index) => {
      const indexLabel = index === 0 ? 'Original tweet' : `Reply ${index}`;
      const authorLabel = node.handle || node.authorName || 'Unknown user';
      let timestampText = '';
      if (node.timestamp) {
        const date = new Date(node.timestamp);
        if (!Number.isNaN(date.getTime())) {
          timestampText = date.toLocaleString();
        }
      }
      lines.push(`${indexLabel} — ${authorLabel}${timestampText ? ` (${timestampText})` : ''}`);
      if (node.text) {
        lines.push(node.text);
      }
      if (node.media && node.media.length) {
        const mediaSummary = node.media.map((item) => item.kind).join(', ');
        lines.push(`[Media: ${mediaSummary}]`);
      }
      lines.push('');
    });
    
    return lines.join('\n').trim();
  }
  
  function clearTwitterState() {
    currentTwitterArticle = null;
    currentTwitterTweetId = null;
    pendingTwitterThreadId = null;
    pendingTwitterStartedAt = 0;
  }
  
  function getTweetInfoFromArticle(article: Element | null | undefined): TweetInfo | null {
    if (!article) return null;
    const link = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const match = href.match(/status\/(\d+)/);
    if (!match) return null;
    const id = match[1];
    const displayUrl = link.href || (`https://x.com${href.startsWith('/') ? href : `/${href}`}`);
    const canonicalUrl = `https://x.com/i/status/${id}`;
    return { id, url: canonicalUrl, displayUrl };
  }
  
  async function processTwitterHover(article: Element, presetInfo: TweetInfo | null = null) {
    const info = presetInfo || getTweetInfoFromArticle(article);
    if (!info) {
      debugLog('[Twitter] No tweet info found for hovered article');
      return;
    }
    
    const { id, url, displayUrl } = info;
    const requestUrl = displayUrl || url;
    const shortUrl = getShortUrl(url);
    
    currentTwitterArticle = article;
    currentTwitterTweetId = id;
    currentlyProcessingUrl = url;
    processingElement = article;
    currentHoveredElement = article;
    pendingTwitterThreadId = id;
    pendingTwitterStartedAt = Date.now();
    
    if (displayMode === 'tooltip' || displayMode === 'both') {
      showTooltip(article, waitHtml('Capturing the thread…'), url);
    }
    
    const isPermalinkView = window.location.pathname.includes('/status/');
    let threadPayload: ThreadPayload | null = null;
    
    if (isPermalinkView) {
      threadPayload = buildThreadFromCache(id);
      if (!threadPayload) {
        threadPayload = await extractThreadFromDom(article, id);
      }
    }
    
    if (!isPermalinkView && threadPayload && threadPayload.nodes && threadPayload.nodes.length < 2) {
      threadPayload = null;
    }
    
    if (!threadPayload || !threadPayload.nodes || threadPayload.nodes.length < 2) {
      if (displayMode === 'tooltip' || displayMode === 'both') {
        showTooltip(article, waitHtml('Opening the conversation…'), url);
      }
      
      for (let attempt = 0; attempt < 3 && (!threadPayload || !threadPayload.nodes || threadPayload.nodes.length < 2); attempt++) {
        try {
          const response: ThreadResponse | undefined = await chrome.runtime.sendMessage({
            type: 'SCRAPE_TWITTER_THREAD',
            url,
            tweetId: id,
            requestUrl
          });
          
          if (response && response.status === 'ok' && response.payload && response.payload.nodes && response.payload.nodes.length) {
            threadPayload = response.payload;
            debugLog(`[Twitter] Background scrape returned ${threadPayload.nodes.length} tweets`);
            break;
          } else if (response && response.status === 'error') {
            debugLog(`[Twitter] Background scrape error: ${response.error} (attempt ${attempt + 1})`);
          }
        } catch (error) {
          debugLog('[Twitter] Background scrape failed', error);
        }
        await sleep(400 * (attempt + 1));
      }
    }
    
    if (!threadPayload || !threadPayload.nodes || threadPayload.nodes.length < 2) {
      if (displayMode === 'tooltip' || displayMode === 'both') {
        showTooltip(article, errorBox('Couldn’t capture the replies yet. Try again once the conversation has loaded.'), url);
      }
      currentlyProcessingUrl = null;
      processingElement = null;
      currentHoveredElement = null;
      clearTwitterState();
      return;
    }
    
    debugLog(`[Twitter] Thread captured via ${threadPayload.source || 'unknown'} with ${threadPayload.nodes.length} tweets`);
    const summaryInput = formatTwitterThreadForSummary(threadPayload);
    const leadNode = threadPayload.nodes[0];
    const title = leadNode && (leadNode.handle || leadNode.authorName)
      ? `Thread by ${leadNode.handle || leadNode.authorName}`
      : 'Twitter Thread';
    
    const result: SummaryResult | undefined = await chrome.runtime.sendMessage({
      type: 'SUMMARIZE_CONTENT',
      url,
      title,
      textContent: summaryInput
    });
    
    const isStillCurrent = (currentlyProcessingUrl === url);
    handleSummaryResult(result, article, url, shortUrl, isStillCurrent);
    pendingTwitterThreadId = null;
    pendingTwitterStartedAt = 0;
    if (!currentHoveredElement && (displayMode === 'tooltip' || displayMode === 'both')) {
      scheduleHide(800, url);
    }
  }
  
  // Schedule hiding tooltip with delay
  function scheduleHide(delay = 500, forUrl: string | null = null) {
    const shortUrl = forUrl ? getShortUrl(forUrl) : 'none';
    debugLog(`⏲️ SCHEDULE HIDE: for "${shortUrl}" in ${delay}ms (currently showing: "${currentlyDisplayedUrl ? getShortUrl(currentlyDisplayedUrl) : 'none'}")`);
    
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      const currentShortUrl = currentlyDisplayedUrl ? getShortUrl(currentlyDisplayedUrl) : 'none';
      // Only hide if:
      // 1. Mouse is not in tooltip
      // 2. Either no URL specified, or the tooltip is still showing this URL's content
      if (!isMouseInTooltip && (!forUrl || currentlyDisplayedUrl === forUrl)) {
        debugLog(`🔽 EXECUTING HIDE: scheduled for "${shortUrl}", currently showing "${currentShortUrl}" - HIDING NOW`);
        hideTooltip();
      } else {
        debugLog(`🚫 SKIP HIDE: scheduled for "${shortUrl}", currently showing "${currentShortUrl}" (mouse in tooltip: ${isMouseInTooltip}, URL match: ${currentlyDisplayedUrl === forUrl})`);
      }
    }, delay);
  }
  
  // Show tooltip
  function showTooltip(element: Element | null, content: string, url: string | null | undefined, options: { placement?: TooltipPlacement } = {}) {
    if (displayMode === 'panel') return;
    
    const placement = options.placement || 'auto';
    currentTooltipPlacement = placement;
    const shortUrl = url ? getShortUrl(url) : 'unknown';
    debugLog(`📤 SHOW TOOLTIP: "${shortUrl}" (was showing: "${currentlyDisplayedUrl ? getShortUrl(currentlyDisplayedUrl) : 'none'}")`);
    
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = null;
    
    const { tip: tooltipEl, content: contentEl } = createTooltip();
    contentEl.innerHTML = content;
    tooltipEl.style.display = 'block';
    attachTooltipDismissHandlers();
    
    currentlyDisplayedUrl = url ?? null;
    
    const anchor = element || processingElement || currentHoveredElement;
    positionTooltip(anchor, placement);
    
    if (url) {
      displayTimes.set(url, Date.now());
    }
    
    requestAnimationFrame(() => {
      tooltipEl.style.opacity = '1';
    });
  }
  
  // Hide tooltip immediately
  function hideTooltip() {
    if (tooltip) {
      const wasShowing = currentlyDisplayedUrl ? getShortUrl(currentlyDisplayedUrl) : 'none';
      debugLog(`📥 HIDE TOOLTIP: was showing "${wasShowing}"`);
      
      tooltip.style.opacity = '0';
      currentlyDisplayedUrl = null; // Clear displayed URL when hiding
      setTimeout(() => {
        if (tooltip && !isMouseInTooltip) {
          tooltip.style.display = 'none';
          debugLog(`🔒 TOOLTIP CLOSED: display set to none`);
        }
      }, 200);
      
      detachTooltipDismissHandlers();
      currentlyProcessingUrl = null;
      processingElement = null;
      currentHoveredElement = null;
      currentTooltipPlacement = 'auto';
    }
  }
  
  // Update tooltip content
  function updateTooltipContent(content: string, url: string) {
    if (displayMode === 'panel') return;
    
    const shortUrl = url ? getShortUrl(url) : 'unknown';
    const wasShowing = currentlyDisplayedUrl ? getShortUrl(currentlyDisplayedUrl) : 'none';
    debugLog(`🔄 UPDATE TOOLTIP: "${shortUrl}" (was showing: "${wasShowing}", visible: ${tooltip && tooltip.style.display === 'block'})`);
    
    // Cancel any pending hide when new content arrives (keep tooltip visible during streaming)
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = null;
    
    if (tooltip && tooltipContent) {
      // Show tooltip if it's not visible (streaming content arrived)
      if (tooltip.style.display !== 'block') {
        tooltip.style.display = 'block';
        debugLog(`  └─ 👁️ Making tooltip visible`);
        // Record display time when showing for first time
        if (url) {
          displayTimes.set(url, Date.now());
        }
      }
      
      // Track what URL is currently displayed
      currentlyDisplayedUrl = url;

      tooltipContent.innerHTML = content;
      tooltip.style.opacity = '1';
      
      const elementForPositioning = currentHoveredElement || processingElement;
      if (elementForPositioning) {
        positionTooltip(elementForPositioning, currentTooltipPlacement);
      }
    }
  }
  
  // Find link element
  function findLink(element: EventTarget | null): HoverLink | null {
    let current = element instanceof Element ? element : null;
    for (let i = 0; i < 10 && current; i++) {
      if (current instanceof HTMLAnchorElement && current.href) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
  
  // Get link type for debugging
  function getLinkType(link: Element, target: EventTarget | null) {
    // Check if the immediate target or any child is an image
    const hasImage = link.querySelector('img') !== null;
    const targetIsImage = target instanceof HTMLImageElement;
    
    if (targetIsImage || hasImage) {
      return '🖼️ IMAGE-LINK';
    }
    return '📝 TEXT-LINK';
  }
  
  // Get short URL for logging
  function getShortUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      // Get last 2 segments of path or domain
      const segments = path.split('/').filter(s => s);
      const lastSegments = segments.slice(-2).join('/');
      return lastSegments || urlObj.hostname;
    } catch {
      return url.substring(0, 50);
    }
  }
  
  function isRedditPostUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      
      const matchesRedditHost = REDDIT_HOSTS.some(host => {
        if (hostname === host) return true;
        return hostname.endsWith(`.${host}`);
      });
      
      if (!matchesRedditHost) {
        return false;
      }
      
      if (hostname === 'redd.it' || hostname.endsWith('.redd.it')) {
        const slug = parsed.pathname.replace(/\//g, '').trim();
        return /^[a-z0-9]+$/i.test(slug);
      }
      
      return /\/comments\/[a-z0-9]+/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }
  
  function isInternalTwitterLink(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.origin);
      return TWITTER_HOSTS.has(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  }
  
  function extractYouTubeVideoId(url: string | null | undefined): string | null {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/(watch\?v=|embed\/)|youtu\.be\/)([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/,
      /[?&]v=([^&\n?#]+)/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[2]) return match[2];
      if (match && match[1] && pattern.source.includes('shorts')) return match[1];
      if (!pattern.source.includes('shorts') && match && match[1]) return match[1];
    }
    return null;
  }
  
  function isYouTubeVideoLink(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.origin);
      if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return false;
      const videoId = extractYouTubeVideoId(url);
      return !!videoId;
    } catch {
      return false;
    }
  }
  
  function findYouTubeCardElement(element: Element | null): Element | null {
    if (!element) return null;
    const selectors = [
      'ytd-rich-grid-video-renderer',
      'ytd-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-playlist-video-renderer',
      'ytd-playlist-renderer',
      'ytd-rich-item-renderer',
      'ytd-grid-video-renderer'
    ];
    for (const selector of selectors) {
      const card = element.closest(selector);
      if (card) return card;
    }
    return null;
  }
  
  // Handle mouseover
  function handleMouseOver(e: MouseEvent) {
    // Skip mouse hover if head tracking is enabled
    if (gazeEnabled) {
      return;
    }

    const eventTarget = e.target instanceof Element ? e.target : null;
    const link = findLink(e.target);
    if (!link) {
      if (IS_TWITTER) {
        const article = eventTarget?.closest('article[role="article"]');
        if (article) {
          const info = getTweetInfoFromArticle(article);
          if (!info) return;
          
          ensureTwitterInterceptor();
          
          const isSameTweet = (currentTwitterTweetId === info.id && currentlyProcessingUrl === info.url);
          if (isSameTweet) {
            return;
          }
          
          if (twitterHoverTimeout) {
            clearTimeout(twitterHoverTimeout);
            twitterHoverTimeout = null;
          }
          
          twitterHoverTimeout = setTimeout(() => {
            twitterHoverTimeout = null;
            processTwitterHover(article, info);
          }, HOVER_DELAY);
          return;
        }
      }
      // Not a link, skip (don't log - too noisy on YouTube)
      return;
    }
    
    let url = link.href;
    let tweetInfoForLink: TweetInfo | null = null;
    const linkType = getLinkType(link, e.target);
    
    if (IS_TWITTER) {
      const article = link.closest && link.closest('article[role="article"]');
      if (article) {
        tweetInfoForLink = getTweetInfoFromArticle(article);
        if (tweetInfoForLink) {
          ensureTwitterInterceptor();
          const canonicalUrl = tweetInfoForLink.url;
          const linkUrlObj = (() => {
            try {
              return new URL(link.getAttribute('href') || '', window.location.origin);
            } catch (error) {
              return null;
            }
          })();
          const isAuxiliaryMediaLink = linkUrlObj ? /\/status\/[^/]+\/(photo|video|media|audio)/i.test(linkUrlObj.pathname) : false;
          if (isAuxiliaryMediaLink && (pendingTwitterThreadId === tweetInfoForLink.id || currentTwitterTweetId === tweetInfoForLink.id || currentlyProcessingUrl === canonicalUrl)) {
            return;
          }
          link.__hoverTweetInfo = tweetInfoForLink;
          link.__hoverArticle = article;
          link.__hoverCanonicalUrl = canonicalUrl;
          url = canonicalUrl;
        } else {
          delete link.__hoverTweetInfo;
          delete link.__hoverArticle;
          delete link.__hoverCanonicalUrl;
        }
      }
    }
    
    if (IS_TWITTER) {
      try {
        const parsedUrl = new URL(url, window.location.origin);
        if (isInternalTwitterLink(parsedUrl.href) && !/\/status\//.test(parsedUrl.pathname)) {
          return;
        }
      } catch (error) {
        // Ignore parsing issues and proceed
      }
    }
    if (IS_YOUTUBE) {
      try {
        const parsedUrl = new URL(url, window.location.origin);
        if (YOUTUBE_HOSTS.has(parsedUrl.hostname.toLowerCase()) && !isYouTubeVideoLink(url)) {
          return;
        }
      } catch (error) {
        return;
      }
    }
    const shortUrl = getShortUrl(url);

    // Check if this is a YouTube thumbnail first
    if (IS_YOUTUBE && eventTarget && isYouTubeThumbnail(eventTarget)) {
      console.log(`🎬 YOUTUBE THUMBNAIL: "${shortUrl}" (will trigger in ${HOVER_DELAY}ms)`);
      try {
        const parsedHost = new URL(url, window.location.origin).hostname.toLowerCase();
        if (!YOUTUBE_HOSTS.has(parsedHost)) {
          console.log(`[YouTube] Skipping non-YouTube thumbnail host: ${parsedHost}`);
          return;
        }
      } catch (error) {
        console.warn('[YouTube] Invalid thumbnail URL, skipping');
        return;
      }
      const videoId = extractYouTubeVideoId(url);
      const canonicalUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
      const hasPending = hoverTimeouts.has(canonicalUrl);
      const isProcessing = currentlyProcessingUrl === canonicalUrl;
      if (hasPending || isProcessing) {
        console.debug('[YouTube] ⏭️  Already processing/displaying this video, ignoring re-hover', {
          hasPending,
          isProcessing,
          url: canonicalUrl
        });
        return;
      }

      let thumbnailElement: HoverAnchor | null = eventTarget.closest('ytd-thumbnail');
      if (!thumbnailElement) {
        thumbnailElement = eventTarget.closest('ytd-video-preview') || 
                          eventTarget.closest('ytd-playlist-thumbnail');
      }

      if (!thumbnailElement) {
        console.warn('[YouTube] Could not find thumbnail element, skipping');
        return;
      }

      const cardElement = findYouTubeCardElement(thumbnailElement) || thumbnailElement || link;
      link.__hoverAnchor = cardElement;
      thumbnailElement.__hoverAnchor = cardElement;
      link.__hoverCanonicalUrl = canonicalUrl;
      const isSwitch = currentlyProcessingUrl && currentlyProcessingUrl !== canonicalUrl;
      if (isSwitch) {
        console.debug(`[YouTube] 🔴 SWITCHING FROM ${currentlyProcessingUrl} TO ${canonicalUrl}`);
        const oldVideoId = extractYouTubeVideoId(currentlyProcessingUrl);
        chrome.runtime.sendMessage({
          action: 'ABORT_YOUTUBE_SUMMARY',
          videoId: oldVideoId,
          newVideoId: videoId
        }, response => {
          console.debug('[YouTube] Abort response:', response);
        });
      }
      
      const requestToken = ++currentYouTubeRequestToken;
      link.__hoverRequestToken = requestToken;
      
      // Clear this URL's previous timeout if any
      const oldTimeout = hoverTimeouts.get(canonicalUrl);
      if (oldTimeout) {
        clearTimeout(oldTimeout.timeoutId);
        hoverTimeouts.delete(canonicalUrl);
      }
      
      // 4. Clear hide timeout
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }

      currentHoveredElement = link;
      
      // Schedule hover (DON'T set currentlyProcessingUrl yet - that happens when timeout fires!)
      const hoverTimeout = setTimeout(() => {
        console.log('[YouTube] Hover timeout firing for thumbnail', canonicalUrl, {
          requestToken,
          currentToken: currentYouTubeRequestToken,
          pendingUrl: currentlyProcessingUrl
        });
        hoverTimeouts.delete(canonicalUrl); // Clean up
        handleYouTubeVideoHover(cardElement, link, canonicalUrl, requestToken);
      }, HOVER_DELAY);

      // Store timeout for this URL
      hoverTimeouts.set(canonicalUrl, { timeoutId: hoverTimeout, requestToken });
      console.log('[YouTube] Hover timeout scheduled for thumbnail', {
        url: canonicalUrl,
        requestToken
      });
      return; // Don't process as regular link
    }
    
    if (IS_YOUTUBE && isYouTubeVideoLink(url)) {
      try {
        const parsedHost = new URL(url, window.location.origin).hostname.toLowerCase();
        if (!YOUTUBE_HOSTS.has(parsedHost)) {
          return;
        }
      } catch (error) {
        return;
      }
      const videoId = extractYouTubeVideoId(url);
      if (!videoId) return;
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      link.__hoverCanonicalUrl = canonicalUrl;
      const cardElement = findYouTubeCardElement(link) || link;
      link.__hoverAnchor = cardElement;
      const hasPending = hoverTimeouts.has(canonicalUrl);
      const isProcessing = currentlyProcessingUrl === canonicalUrl;
      if (hasPending || isProcessing) {
        console.debug('[YouTube] ⏭️  Already processing/displaying this video link, ignoring re-hover', {
          hasPending,
          isProcessing,
          url: canonicalUrl
        });
        return;
      }
      const isSwitch = currentlyProcessingUrl && currentlyProcessingUrl !== canonicalUrl;
      if (isSwitch) {
        console.debug(`[YouTube] 🔴 SWITCHING FROM ${currentlyProcessingUrl} TO ${canonicalUrl}`);
        const oldVideoId = extractYouTubeVideoId(currentlyProcessingUrl);
        chrome.runtime.sendMessage({
          action: 'ABORT_YOUTUBE_SUMMARY',
          videoId: oldVideoId,
          newVideoId: videoId
        }, response => {
          console.debug('[YouTube] Abort response:', response);
        });
      }
      const requestToken = ++currentYouTubeRequestToken;
      link.__hoverRequestToken = requestToken;
      const oldTimeout = hoverTimeouts.get(canonicalUrl);
      if (oldTimeout) {
        clearTimeout(oldTimeout.timeoutId);
        hoverTimeouts.delete(canonicalUrl);
      }
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      currentHoveredElement = link;
      const hoverTimeout = setTimeout(() => {
        console.log('[YouTube] Hover timeout firing for link', canonicalUrl, {
          requestToken,
          currentToken: currentYouTubeRequestToken,
          pendingUrl: currentlyProcessingUrl
        });
        hoverTimeouts.delete(canonicalUrl);
        handleYouTubeVideoHover(cardElement, link, canonicalUrl, requestToken);
      }, HOVER_DELAY);
      hoverTimeouts.set(canonicalUrl, { timeoutId: hoverTimeout, requestToken });
      console.log('[YouTube] Hover timeout scheduled for link', {
        url: canonicalUrl,
        requestToken
      });
      return;
    }
    
    // Don't re-trigger if we're already processing this exact URL
    if (currentlyProcessingUrl === url) {
      debugLog(`🚫 BLOCKED: ${linkType} "${shortUrl}" (already processing)`);
      return;
    }
    
    // Cancel any pending hide when hovering a new link (critical for preventing blinks!)
    if (hideTimeout) {
      debugLog(`🚫 CANCEL HIDE: starting hover on "${shortUrl}"`);
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    
    debugLog(`✅ HOVER: ${linkType} "${shortUrl}" (will trigger in ${HOVER_DELAY}ms)`);
    
    currentHoveredElement = link;
    
    if (currentHoverTimeout) clearTimeout(currentHoverTimeout);
    currentHoverTimeout = setTimeout(() => {
      processLinkHover(link);
    }, HOVER_DELAY);
  }
  
  // Handle mouseout
  function handleMouseOut(e: MouseEvent) {
    const eventTarget = e.target instanceof Element ? e.target : null;
    const related = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    const link = findLink(e.target);
    if (!link) {
      if (IS_TWITTER) {
        const article = eventTarget?.closest('article[role="article"]');
        if (article) {
          const relatedArticle = related?.closest('article[role="article"]');
          if (relatedArticle === article) {
            return;
          }
          
          const info = getTweetInfoFromArticle(article);
          if (info && pendingTwitterThreadId === info.id) {
            debugLog(`[Twitter] Mouseout while background pending for ${info.id}, keeping tooltip visible`);
            return;
          }
          
          if (twitterHoverTimeout) {
            clearTimeout(twitterHoverTimeout);
            twitterHoverTimeout = null;
          }
          
          if (currentlyProcessingUrl && (!info || info.id !== pendingTwitterThreadId)) {
            scheduleHide(400, currentlyProcessingUrl);
          }
          
          if (!info || info.id !== pendingTwitterThreadId) {
            currentTwitterArticle = null;
            currentTwitterTweetId = null;
          }
          currentHoveredElement = null;
        }
      }
      return;
    }
    
    const url = link.__hoverCanonicalUrl || link.href;
    const anchorElement = link.__hoverAnchor;
    const tweetInfoMouseOut = link.__hoverTweetInfo || (IS_TWITTER ? getTweetInfoFromArticle(link.closest('article[role="article"]')) : null);
    const shortUrl = getShortUrl(url);

    // Handle YouTube thumbnail mouseout
    if (IS_YOUTUBE && eventTarget && isYouTubeThumbnail(eventTarget)) {
      const relatedTarget = related;
      const thumbnailElement = eventTarget.closest('ytd-thumbnail') || 
                              eventTarget.closest('ytd-video-preview') || 
                              eventTarget.closest('ytd-playlist-thumbnail');
      
      if (relatedTarget && thumbnailElement && thumbnailElement.contains(relatedTarget)) {
        console.log('[YouTube] Mouseout within same thumbnail, keeping hover alive', { url });
        return;
      }
      
      const pendingTimeout = hoverTimeouts.get(url);
      if (pendingTimeout) {
        console.log('[YouTube] Mouseout clearing pending hover', { url, requestToken: pendingTimeout.requestToken });
        clearTimeout(pendingTimeout.timeoutId);
        hoverTimeouts.delete(url);
      }
      
      // Allow general logic below to decide whether to hide tooltip; skip additional handling
    }
    
    // Check if we're actually leaving the link (not just moving to a child element or tooltip)
    const relatedTarget = related;
    if (relatedTarget) {
      if (anchorElement && anchorElement.contains(relatedTarget)) {
        return;
      }
      // Don't hide if moving to a child element
      if (link.contains(relatedTarget) || link === relatedTarget) {
        debugLog(`⏭️ MOUSEOUT: "${shortUrl}" (child element, ignored)`);
        return;
      }
      // Don't hide if moving into the tooltip
      if (tooltip && (tooltip.contains(relatedTarget) || tooltip === relatedTarget)) {
        debugLog(`⏭️ MOUSEOUT: "${shortUrl}" (into tooltip, ignored)`);
        return;
      }
    }
    
    if (IS_TWITTER && tweetInfoMouseOut && pendingTwitterThreadId === tweetInfoMouseOut.id) {
      debugLog(`[Twitter] Mouseout ignored for pending thread ${tweetInfoMouseOut.id}`);
      return;
    }
    delete link.__hoverAnchor;
    delete link.__hoverRequestToken;
    
    // Don't schedule hide if we're actively processing/streaming this URL
    if (currentlyProcessingUrl === url) {
      debugLog(`👋 MOUSEOUT: "${shortUrl}" (streaming active, tooltip will stay visible)`);
      // Don't schedule hide - streaming updates will keep it visible
      // It will only hide when streaming completes or user switches to different URL
    } else {
      // Check if THIS URL's content was just displayed (protection window)
      const urlDisplayTime = displayTimes.get(url) || 0;
      const timeSinceDisplay = urlDisplayTime > 0 ? Date.now() - urlDisplayTime : Infinity;
      const MIN_DISPLAY_TIME = 500; // Minimum time to show content before allowing hide
      
      debugLog(`[DEBUG] URL: "${shortUrl}", displayTime: ${urlDisplayTime}, timeSinceDisplay: ${timeSinceDisplay}ms`);
      
      if (timeSinceDisplay < MIN_DISPLAY_TIME && urlDisplayTime > 0) {
        // Content was just displayed, use longer delay to give user time to see it
        const remainingTime = MIN_DISPLAY_TIME - timeSinceDisplay;
        debugLog(`👋 MOUSEOUT: "${shortUrl}" (content just shown, waiting ${Math.round(remainingTime)}ms before scheduling hide)`);
        
        // Schedule hide after the protection window expires
        setTimeout(() => {
          if (!isMouseInTooltip && !currentHoveredElement) {
            debugLog(`⏰ Protection window expired for "${shortUrl}", now scheduling hide`);
            scheduleHide(500, url); // 500ms > 300ms hover delay to prevent race condition
          }
        }, remainingTime);
      } else {
        debugLog(`👋 MOUSEOUT: "${shortUrl}" (scheduling hide in 500ms, reason: ${urlDisplayTime === 0 ? 'never displayed' : `too long ago (${timeSinceDisplay}ms)`})`);
        scheduleHide(500, url); // 500ms > 300ms hover delay to prevent race condition
      }
    }
    
    // Cancel pending hover
    if (currentHoverTimeout) clearTimeout(currentHoverTimeout);
    currentHoverTimeout = null;
    
    currentHoveredElement = null;
  }
  
  // Process link hover
  async function processLinkHover(link: HoverLink) {
    const url = link.__hoverCanonicalUrl || link.href;
    const shortUrl = getShortUrl(url);
    const isReddit = isRedditPostUrl(url);
    const tweetInfo = link.__hoverTweetInfo || null;
    const tweetArticle = link.__hoverArticle || link.closest('article[role="article"]');
    
    if (IS_TWITTER && tweetInfo && tweetArticle) {
      await processTwitterHover(tweetArticle, tweetInfo);
      return;
    }
    
    if (IS_TWITTER) {
      try {
        const parsed = new URL(url, window.location.origin);
        if (isInternalTwitterLink(parsed.href) && !/\/status\//.test(parsed.pathname)) {
          currentlyProcessingUrl = null;
          processingElement = null;
          return;
        }
      } catch (error) {
        currentlyProcessingUrl = null;
        processingElement = null;
        return;
      }
    }
    
    // Clear previous processing URL when starting a new one
    if (currentlyProcessingUrl && currentlyProcessingUrl !== url) {
      debugLog(`🔄 SWITCHING: from "${getShortUrl(currentlyProcessingUrl)}" to "${shortUrl}"`);
    }
    
    // Mark this URL as currently being processed
    currentlyProcessingUrl = url;
    processingElement = link; // Track element for positioning during streaming
    
    debugLog(`🔄 PROCESSING: "${shortUrl}"${isReddit ? ' [Reddit]' : ''}`);
    
    // Show loading state in tooltip
    if (displayMode === 'tooltip' || displayMode === 'both') {
      const loadingMessage = isReddit
        ? waitHtml('Gathering the Reddit discussion…')
        : waitHtml('Reading the page…');
      showTooltip(link, loadingMessage, url);
    }
    
    if (isReddit) {
      await processRedditPost(link, url, shortUrl);
      return;
    }
    
    // Fetch HTML
    const response: { html?: string; error?: string } | undefined = await chrome.runtime.sendMessage({
      type: 'FETCH_CONTENT',
      url: url
    });
    
    if (!response || response.error || typeof response.html !== 'string') {
      const reason = response?.error || 'No response';
      console.error('[Content] Fetch error:', reason);
      if (showsTooltip()) {
        showTooltip(link, errorBox(`Error: ${reason}`), url);
      }
      currentlyProcessingUrl = null;
      processingElement = null;
      return;
    }
    
    // Extract content with Readability
    const parser = new DOMParser();
    const doc = parser.parseFromString(response.html, 'text/html');
    const documentClone = doc.cloneNode(true) as Document;
    
    const reader = new Readability(documentClone);
    const article = reader.parse();
    
    let title: string;
    let textContent: string;
    
    if (article && article.textContent && article.textContent.trim().length > 100) {
      title = article.title || 'Untitled';
      textContent = article.textContent;
    } else {
      const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || 
                       doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
                       'No content could be extracted from this page.';
      
      title = doc.title || 'Untitled';
      textContent = metaDesc;
    }
    
    // Show generating state
    if (displayMode === 'tooltip' || displayMode === 'both') {
      showTooltip(link, waitHtml('Writing the summary on this device…'), url);
    }
    
    // Request summarization from background
    const result: SummaryResult | undefined = await chrome.runtime.sendMessage({
      type: 'SUMMARIZE_CONTENT',
      url: url,
      title: title,
      textContent: textContent
    });
    
    // Check if this result is still for the current URL we care about
    const isStillCurrent = (currentlyProcessingUrl === url);
    handleSummaryResult(result, link, url, shortUrl, isStillCurrent);
  }
  
  async function processRedditPost(link: HoverLink, url: string, shortUrl: string) {
    debugLog(`🧵 REDDIT REQUEST: "${shortUrl}"`);
    
    if (displayMode === 'tooltip' || displayMode === 'both') {
      showTooltip(link, waitHtml('Summarizing the Reddit discussion…'), url);
    }
    
    try {
      const result: SummaryResult | undefined = await chrome.runtime.sendMessage({
        type: 'SUMMARIZE_REDDIT_POST',
        url: url
      });
      
      const isStillCurrent = (currentlyProcessingUrl === url);
      handleSummaryResult(result, link, url, shortUrl, isStillCurrent);
    } catch (error) {
      console.error(`[Reddit] Summary failed for "${shortUrl}":`, error);
      if (displayMode === 'tooltip' || displayMode === 'both') {
        const message = errorMessage(error, 'Unable to summarize Reddit thread');
        showTooltip(link, errorBox(`Error: ${message}`), url);
      }
      if (currentlyProcessingUrl === url) {
        currentlyProcessingUrl = null;
        processingElement = null;
      }
    }
  }
  
  function handleSummaryResult(result: SummaryResult | undefined, link: Element, url: string, shortUrl: string, isStillCurrent: boolean) {
    if (!isStillCurrent && IS_TWITTER && pendingTwitterThreadId) {
      pendingTwitterThreadId = null;
      pendingTwitterStartedAt = 0;
    }
  if (!result || !result.status) {
      debugLog(`❌ INVALID RESULT: "${shortUrl}"`);
      if (displayMode === 'tooltip' || displayMode === 'both') {
        showTooltip(link, errorBox('No summary came back. Rest on the link again to retry.'), url);
      }
      if (isStillCurrent) {
        currentlyProcessingUrl = null;
        processingElement = null;
        clearTwitterState();
      }
      return;
    }
    
    if (result.status === 'duplicate') {
      debugLog(`❌ DUPLICATE: "${shortUrl}" (ignoring)`);
      if (isStillCurrent) {
        currentlyProcessingUrl = null;
        processingElement = null;
        clearTwitterState();
      }
      return;
    }
    
    if (result.status === 'aborted') {
      debugLog(`❌ ABORTED: "${shortUrl}" (was canceled, ${isStillCurrent ? 'clearing' : 'already moved on'})`);
      return;
    }
    
    if (result.status === 'error') {
      const reason = result.error || result.message || 'Unknown error';
      console.error(`❌ ERROR: "${shortUrl}" - ${reason}`);
      if (displayMode === 'tooltip' || (displayMode === 'both' && isStillCurrent)) {
        showTooltip(link, errorBox(`Error: ${reason}`), url);
      }
      if (isStillCurrent) {
        currentlyProcessingUrl = null;
        processingElement = null;
        clearTwitterState();
      }
      return;
    }
    
    if (result.status === 'complete' && result.cached) {
      debugLog(`💾 CACHED: "${shortUrl}" (instant display, still current: ${isStillCurrent})`);
      
      if (isStillCurrent) {
        const formattedSummary = formatAISummary(result.summary ?? '');
        
        if (displayMode === 'tooltip' || displayMode === 'both') {
          showTooltip(link, formattedSummary, url);
        }
        
        if (displayMode === 'panel' || displayMode === 'both') {
          chrome.runtime.sendMessage({
            type: 'DISPLAY_CACHED_SUMMARY',
            title: result.title,
            summary: formattedSummary
          }).catch(() => {});
        }
        
        currentlyProcessingUrl = null;
        processingElement = null;
        clearTwitterState();
        debugLog(`✅ COMPLETE: "${shortUrl}" (ready for next hover)`);
      } else {
        debugLog(`⚠️ STALE CACHED: "${shortUrl}" (user moved on, ignoring)`);
      }
      return;
    }
    
    if (isStillCurrent) {
      debugLog(`📡 STREAMING: "${shortUrl}" (will receive updates)`);
    } else {
      debugLog(`⚠️ STALE STREAMING: "${shortUrl}" (user moved on, ignoring)`);
    }
    // Streaming updates are handled via STREAMING_UPDATE messages.
  }
  
  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'CAPTURE_TWITTER_THREAD') {
      if (!IS_TWITTER) {
        sendResponse({ status: 'error', error: 'NOT_TWITTER_CONTEXT' });
        return false;
      }
      (async () => {
        try {
          const payload = await captureThreadForBackground(message.tweetId ?? '');
          if (payload && payload.nodes && payload.nodes.length) {
            sendResponse({ status: 'ok', payload });
          } else {
            sendResponse({ status: 'error', error: 'NO_THREAD_DATA' });
          }
        } catch (error) {
          sendResponse({ status: 'error', error: errorMessage(error, 'CAPTURE_FAILED') });
        }
      })();
      return true;
    }
    
    if (message.type === 'STREAMING_UPDATE') {
      // Only accept updates for the EXACT URL we're currently processing
      const isValid = message.url === currentlyProcessingUrl;
      if (!isValid) {
        if (IS_YOUTUBE) {
          console.debug(`[YouTube] REJECTED stale update for: ${message.url}`);
          console.debug(`  Currently processing: ${currentlyProcessingUrl}`);
        }
        return;
      }
      updateTooltipContent(message.content ?? '', message.url ?? '');
    }
    
    if (message.type === 'PROCESSING_STATUS') {
      if (message.status === 'started' && currentHoveredElement) {
        if (displayMode === 'tooltip' || displayMode === 'both') {
          showTooltip(currentHoveredElement, waitHtml('Writing the summary on this device…'), message.url);
        }
      }
    }
    
    if (message.type === 'DISPLAY_MODE_CHANGED') {
      displayMode = message.displayMode as DisplayMode;
      debugLog('[Content] Display mode updated:', displayMode);
      if (displayMode === 'panel') {
        hideTooltip();
      }
    }

    if (message.type === 'GAZE_ENABLED_CHANGED') {
      gazeEnabled = Boolean(message.gazeEnabled);
      debugLog('[Content] Gaze enabled updated:', gazeEnabled);
    }

    if (message.type === 'TRIGGER_CALIBRATION') {
      debugLog('[Content] Triggering head calibration');
      // Trigger Alt+H keyboard event to start calibration
      const event = new KeyboardEvent('keydown', {
        key: 'h',
        code: 'KeyH',
        altKey: true,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(event);
    }

    if (message.type === 'TRIGGER_MOUTH_CALIBRATION') {
      debugLog('[Content] Triggering mouth calibration');
      // Trigger Alt+M keyboard event to start mouth calibration
      const event = new KeyboardEvent('keydown', {
        key: 'm',
        code: 'KeyM',
        altKey: true,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(event);
    }

    if (message.type === 'PING') {
      // Respond to ping to confirm content script is loaded
      sendResponse({ status: 'ok' });
      return true;
    }
  });

  // Listen for gaze:status events and relay to sidepanel
  window.addEventListener('gaze:status', (event) => {
    if (event.detail) {
      chrome.runtime.sendMessage({
        type: 'GAZE_STATUS',
        phase: event.detail.phase,
        note: event.detail.note
      }).catch(() => {
        // Ignore errors if sidepanel not open
      });
    }
  });
  
  // Get initial display mode and gaze enabled status
  chrome.storage.local.get(['displayMode', 'gazeEnabled'], (result) => {
    if (result.displayMode) {
      displayMode = result.displayMode;
      debugLog('[Content] Initial display mode:', displayMode);
    }
    if (typeof result.gazeEnabled === 'boolean') {
      gazeEnabled = result.gazeEnabled;
      debugLog('[Content] Initial gaze enabled:', gazeEnabled);
    }
  });
  
  // Initialize hover detection (only while summaries are switched on; see shared/features.ts).
  // The message listener above stays: the side panel uses it for PING and calibration.
  if (SUMMARIES_ENABLED) {
    if (IS_TWITTER) {
      ensureTwitterInterceptor();
    }
    document.body.addEventListener('mouseover', handleMouseOver, true);
    document.body.addEventListener('mouseout', handleMouseOut, true);
  }
  
  debugLog('[Content] Hover link extension initialized');
  

  
  // ============ YouTube-Specific Functions ============
  
  /**
   * Create YouTube summary overlay inside thumbnail
   */
  
  /**
   * Check if an element is a YouTube thumbnail
   */
  function isYouTubeThumbnail(element: Element): boolean {
    if (!IS_YOUTUBE) return false;
    
    // Only check for actual thumbnail elements, not entire video cards
    // This ensures consistent overlay sizing
    const thumbnailSelectors = [
      'ytd-thumbnail',
      'ytd-video-preview',
      'ytd-playlist-thumbnail',
      'a#thumbnail'
    ];
    
    for (const selector of thumbnailSelectors) {
      if (element.matches(selector) || element.closest(selector)) {
        return true;
      }
    }
    
    return false;
  }
  
  function waitForYouTubeCaptions(videoId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('youtube-captions-ready', captionListener);
        clearTimeout(timeout);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for captions'));
      }, 5000);
      const captionListener = (event: CustomEvent<{ videoId: string }>) => {
        if (event.detail && event.detail.videoId === videoId) {
          cleanup();
          resolve();
        }
      };
      window.addEventListener('youtube-captions-ready', captionListener);
      if (window.hasYouTubeCaptions) {
        window.hasYouTubeCaptions(videoId)
          .then((hasCaptions) => {
            if (hasCaptions) {
              cleanup();
              resolve();
            }
          })
          .catch(() => {});
      }
    });
  }

  async function handleYouTubeVideoHover(anchorElement: Element | null, linkElement: HoverLink | null, url: string, requestToken: number) {
    console.log('[YouTube] Hover handler start', {
      url,
      requestToken,
      currentToken: currentYouTubeRequestToken,
      currentlyProcessingUrl
    });
    if (requestToken !== currentYouTubeRequestToken) {
      console.warn('[YouTube] Stale hover request, ignoring', {
        requestToken,
        currentToken: currentYouTubeRequestToken
      });
      return;
    }
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      console.warn('[YouTube] Could not extract video ID from:', url);
      currentlyProcessingUrl = null;
      return;
    }
    const tooltipAnchor = anchorElement || linkElement;
    currentlyProcessingUrl = url;
    processingElement = linkElement || tooltipAnchor;
    currentHoveredElement = tooltipAnchor;
    const tooltipOptions = { placement: 'right' as const };
    if (displayMode === 'tooltip' || displayMode === 'both') {
      showTooltip(tooltipAnchor, waitHtml('Capturing the captions…'), url, tooltipOptions);
    }
    const summaryTimeout = setTimeout(() => {
      if (currentlyProcessingUrl === url) {
        chrome.runtime.sendMessage({
          action: 'ABORT_YOUTUBE_SUMMARY',
          videoId
        });
        if (displayMode === 'tooltip' || displayMode === 'both') {
          showTooltip(tooltipAnchor, errorBox('The summary took too long. Rest on the video again to retry.'), url, tooltipOptions);
        }
        currentlyProcessingUrl = null;
        if (linkElement) {
          delete linkElement.__hoverAnchor;
          delete linkElement.__hoverRequestToken;
        }
      }
    }, 30000);

    try {
      await waitForYouTubeCaptions(videoId);
    console.log('[YouTube] Captions ready before summary request:', videoId);
    } catch (error) {
      console.warn('[YouTube] Captions did not arrive in time, continuing anyway:', videoId, errorMessage(error));
    }

    if (displayMode === 'tooltip' || displayMode === 'both') {
      showTooltip(tooltipAnchor, waitHtml('Writing the summary on this device…'), url, tooltipOptions);
    }
    if (requestToken !== currentYouTubeRequestToken) {
      console.warn('[YouTube] Request token changed after caption wait, aborting send', {
        requestToken,
        currentToken: currentYouTubeRequestToken
      });
      return;
    }
    console.log('[YouTube] Sending GET_YOUTUBE_SUMMARY', { videoId, url, requestToken });
    chrome.runtime.sendMessage({
      action: 'GET_YOUTUBE_SUMMARY',
      videoId,
      url
    }, (response: SummaryResult | undefined) => {
      clearTimeout(summaryTimeout);
      if (requestToken !== currentYouTubeRequestToken) {
        console.warn('[YouTube] Request token changed before response handling', {
          requestToken,
          currentToken: currentYouTubeRequestToken
        });
        return;
      }
      if (chrome.runtime.lastError) {
        console.error('[YouTube] Runtime error:', chrome.runtime.lastError);
        if (displayMode === 'tooltip' || displayMode === 'both') {
          showTooltip(tooltipAnchor, errorBox('The summary could not be written.'), url, tooltipOptions);
        }
        currentlyProcessingUrl = null;
        return;
      }
      if (!response) {
        console.warn('[YouTube] Empty response from background');
        currentlyProcessingUrl = null;
        return;
      }
      console.log('[YouTube] Summary response payload:', response);
      if (response.status === 'complete') {
        const summary = response.summary || 'No summary generated';
        const formatted = formatAISummary(summary);
        showTooltip(tooltipAnchor, formatted, url, tooltipOptions);
        // Nutshell compared against 'sidepanel', which is not a display mode, so YouTube
        // summaries never reached the panel. The panel listens on `type`, not `action`.
        if (displayMode === 'panel' || displayMode === 'both') {
          chrome.runtime.sendMessage({
            type: 'DISPLAY_CACHED_SUMMARY',
            title: 'YouTube video',
            summary: formatted,
            url
          }).catch(() => {});
        }
        currentlyProcessingUrl = null;
        processingElement = null;
        if (linkElement) {
          delete linkElement.__hoverAnchor;
          delete linkElement.__hoverRequestToken;
        }
        return;
      }
      if (response.status === 'streaming') {
        return;
      }
      if (response.error) {
        const errorMsg = response.error === 'NO_CAPTIONS'
          ? 'No captions available for this video yet.'
          : `Error: ${response.error}`;
        if (displayMode === 'tooltip' || displayMode === 'both') {
          showTooltip(tooltipAnchor, errorBox(errorMsg), url, tooltipOptions);
        }
        currentlyProcessingUrl = null;
        processingElement = null;
        if (linkElement) {
          delete linkElement.__hoverAnchor;
          delete linkElement.__hoverRequestToken;
        }
      }
    });
  }
  
})();

export {};
