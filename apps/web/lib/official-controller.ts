import { createController as createOfficialController } from '@toolkit/controller/createController.js';
import { createDomReceiver as createOfficialDomReceiver } from '@toolkit/controller/web/dom-receiver.js';
import type { OfficialController, OfficialControllerOptions, OfficialDomReceiver } from '@/types/ai4a11y-controller';

/** Pass-through to the pinned upstream modules, with the documented option types. */
export function createDomReceiver(root: HTMLElement, options?: { scrollTarget?: HTMLElement; platform?: string }): OfficialDomReceiver {
  return createOfficialDomReceiver(root, options) as OfficialDomReceiver;
}

export function createController(options: OfficialControllerOptions): OfficialController {
  return (createOfficialController as (opts?: OfficialControllerOptions) => OfficialController)(options);
}
