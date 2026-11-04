/** Shapes shared by the background worker, content scripts and side panel. */

export type DisplayMode = 'tooltip' | 'panel' | 'both';
export type ApiChoice = 'summarization' | 'prompt';
export type ApiStatus = AIAvailability | 'initializing' | 'error';

export interface Settings {
  apiChoice: ApiChoice;
  customPrompt: string;
  displayMode: DisplayMode;
}

export interface TweetMedia {
  kind: 'photo' | 'gif' | 'video';
  urls: string[];
  poster?: string | null;
}

export interface TweetNode {
  id: string;
  conversationId: string | null;
  authorName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  timestamp: string | null;
  permalink: string | null;
  text: string;
  media: TweetMedia[];
  inReplyToId: string | null;
  order: number;
  source?: string;
}

export interface ThreadPayload {
  rootId: string;
  conversationId: string | null;
  nodes: TweetNode[];
  source: string;
}

export type ThreadResponse =
  | { status: 'ok'; payload: ThreadPayload }
  | { status: 'error'; error: string; payload?: undefined };

export interface SummaryResult {
  status?: 'complete' | 'duplicate' | 'aborted' | 'error' | 'streaming';
  title?: string;
  summary?: string;
  cached?: boolean;
  error?: string;
  message?: string;
  videoId?: string;
  captionCount?: number;
  compression?: unknown;
  debugInputSnippet?: string;
  debugFullInput?: string;
}

export interface CaptionSegment {
  start: number;
  duration: number;
  text: string;
}

export interface CaptionData {
  captions?: CaptionSegment[];
  text?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface ApiStatusResponse {
  summarizer: ApiStatus;
  promptAPI: ApiStatus;
}

/**
 * Every runtime message. Nutshell keyed some by `type` and some by `action`;
 * both are kept so content scripts and the worker stay wire-compatible.
 */
export interface RuntimeMessage {
  type?: string;
  action?: string;
  url?: string;
  title?: string;
  textContent?: string;
  html?: string;
  tweetId?: string;
  requestUrl?: string;
  videoId?: string | null;
  newVideoId?: string | null;
  tabId?: number;
  reason?: string;
  phase?: string;
  note?: string;
  status?: string;
  content?: string;
  [key: string]: unknown;
}

export const errorMessage = (error: unknown, fallback = 'Unknown error'): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;

export const errorName = (error: unknown): string | undefined =>
  error instanceof Error || error instanceof DOMException ? error.name : undefined;
