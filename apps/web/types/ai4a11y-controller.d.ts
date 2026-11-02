/** Documented upstream options. The JS default `operator = null` hides this object type from inference. */
export interface OfficialControllerOptions {
  control?: unknown;
  llm?: { resolve: (...args: unknown[]) => unknown } | null;
  operator?: { abilityModel?: { supportAreas?: string[] }; librarian?: { getAbilityModel?: () => Promise<unknown> } } | null;
  rawToTask?: boolean;
}

export interface OfficialHandleResult {
  ok?: boolean;
  say?: string;
  pending?: boolean;
  data?: unknown;
  intent?: unknown;
}

export interface OfficialController {
  handle(utterance: string, opts?: object): Promise<OfficialHandleResult>;
}

export interface OfficialDomReceiver {
  describeCapabilities(): Promise<unknown>;
  getContext(): Promise<unknown>;
  applySettings(changes: object, scope?: unknown): Promise<unknown>;
  undoLast(): Promise<unknown>;
  resetUndo(): Promise<unknown>;
  getContent(mode?: string, chunk?: number): Promise<unknown>;
  performAction(action: string, target?: unknown, text?: unknown, meta?: unknown): Promise<unknown>;
  stop?(): Promise<unknown>;
}
