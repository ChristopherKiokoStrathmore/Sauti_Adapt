/// <reference path="./toolkit-modules.d.ts" />
import { createController as createOfficialController } from '@toolkit/controller/createController.js';
import { createDomReceiver as createOfficialDomReceiver } from '@toolkit/controller/web/dom-receiver.js';

/** Documented upstream options. `operator` is the ability-model object from the toolkit JSDoc, not `null`. */
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
  describeCapabilities(): Promise<{ actions?: string[] } & Record<string, unknown>>;
  getContext(): Promise<unknown>;
  applySettings(changes: object, scope?: unknown): Promise<unknown>;
  undoLast(): Promise<unknown>;
  resetUndo(): Promise<unknown>;
  getContent(mode?: string, chunk?: number): Promise<unknown>;
  performAction(action: string, target?: unknown, text?: unknown, meta?: unknown): Promise<unknown>;
  stop?(): Promise<unknown>;
}

/** Pass-through to the pinned upstream modules. Call sites keep the documented types. */
export function createDomReceiver(root: HTMLElement, options?: { scrollTarget?: HTMLElement; platform?: string }): OfficialDomReceiver {
  return createOfficialDomReceiver(root, options);
}

export function createController(options: OfficialControllerOptions): OfficialController {
  return createOfficialController(options);
}
