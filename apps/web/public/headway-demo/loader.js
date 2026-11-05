// This browser module is loaded only after Headway camera activation.
// Use the actual Human.js ESM bundle, not the human.js IIFE distribution.
(async () => {
  try {
    const humanModule = await import('./human.esm.js');
    const constructor = humanModule.Human ?? humanModule.default;
    if (typeof constructor !== 'function') {
      throw new Error('The Human.js browser bundle does not expose a usable constructor.');
    }
    window.__HeadwayHumanConstructor = constructor;
    window.dispatchEvent(new Event('headway-human-ready'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown face tracking model loader error';
    window.dispatchEvent(new CustomEvent('headway-human-error', { detail: message }));
  }
})();
