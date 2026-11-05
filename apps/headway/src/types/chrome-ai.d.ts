// Chrome built-in AI (Gemini Nano). Only the surface Headway calls is typed here.
// https://developer.chrome.com/docs/ai/built-in-apis

type AIAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available' | 'readily';

interface AIDestroyable {
  destroy(): void;
}

interface AISummarizerCreateOptions {
  type?: 'key-points' | 'tldr' | 'teaser' | 'headline';
  format?: 'markdown' | 'plain-text';
  length?: 'short' | 'medium' | 'long';
  sharedContext?: string;
  outputLanguage?: string;
  signal?: AbortSignal;
}

interface AISummarizer extends AIDestroyable {
  summarize(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  summarizeStreaming(input: string, options?: { signal?: AbortSignal }): AsyncIterable<string>;
}

interface AISummarizerFactory {
  availability(options?: { outputLanguage?: string }): Promise<AIAvailability>;
  create(options?: AISummarizerCreateOptions): Promise<AISummarizer>;
}

interface AILanguageModelExpected {
  type: 'text' | 'image' | 'audio';
  languages?: string[];
}

interface AILanguageModelCreateOptions {
  expectedOutputs?: AILanguageModelExpected[];
  expectedInputs?: AILanguageModelExpected[];
  signal?: AbortSignal;
}

interface AILanguageModel extends AIDestroyable {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming(input: string, options?: { signal?: AbortSignal }): AsyncIterable<string>;
}

interface AILanguageModelFactory {
  availability(options?: AILanguageModelCreateOptions): Promise<AIAvailability>;
  create(options?: AILanguageModelCreateOptions): Promise<AILanguageModel>;
  params(): Promise<unknown>;
}

declare var Summarizer: AISummarizerFactory | undefined;
declare var LanguageModel: AILanguageModelFactory | undefined;
/** Older Chrome builds exposed the APIs under a single `ai` namespace. */
declare var ai: { summarizer?: AISummarizerFactory; languageModel?: AILanguageModelFactory } | undefined;
