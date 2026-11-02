/**
 * The pinned controller defaults `operator = null`, so TypeScript infers
 * `operator?: null` and rejects the documented operator object (TS2322).
 * These declarations restore the JSDoc parameter types. They do not change
 * the runtime modules.
 */
declare module '@toolkit/controller/createController.js' {
  export interface ToolkitOperator {
    abilityModel?: { supportAreas?: string[] };
    librarian?: { getAbilityModel?: () => Promise<unknown> };
  }

  export interface ToolkitControllerOptions {
    control?: unknown;
    llm?: { resolve: (...args: unknown[]) => unknown } | null;
    operator?: ToolkitOperator | null;
    rawToTask?: boolean;
  }

  export interface ToolkitController {
    handle(utterance: string, opts?: object): Promise<{
      ok?: boolean;
      say?: string;
      pending?: boolean;
      data?: unknown;
      intent?: unknown;
    }>;
  }

  export function createController(options?: ToolkitControllerOptions): ToolkitController;
}

declare module '@toolkit/controller/web/dom-receiver.js' {
  export function createDomReceiver(
    root: HTMLElement,
    options?: { scrollTarget?: HTMLElement; platform?: string },
  ): {
    describeCapabilities(): Promise<{ actions?: string[] } & Record<string, unknown>>;
    getContext(): Promise<unknown>;
    applySettings(changes: object, scope?: unknown): Promise<unknown>;
    undoLast(): Promise<unknown>;
    resetUndo(): Promise<unknown>;
    getContent(mode?: string, chunk?: number): Promise<unknown>;
    performAction(action: string, target?: unknown, text?: unknown, meta?: unknown): Promise<unknown>;
    stop?(): Promise<unknown>;
  };
}
