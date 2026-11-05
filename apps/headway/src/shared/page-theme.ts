/**
 * Styling for everything Headway draws inside web pages. It has to survive any
 * site's CSS, so it is plain inline CSS scoped by id, on a dark ink surface that
 * reads the same on light and dark pages. The lime accent marks one thing at a
 * time: the active zone, the dwell ring or the primary button.
 */
export const INK = '#0f100d';
export const SURFACE = '#171814';
export const PAPER = '#eeeee6';
export const MUTED = '#a3a598';
export const LINE = 'rgba(238, 238, 230, 0.14)';
export const LIME = '#c8f031';
export const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

/** CSS for a summary tooltip with the given element id and close-button class. */
export function tooltipCss(id: string, closeClass: string): string {
  return `
    #${id} {
      position: fixed; z-index: 2147483647;
      box-sizing: border-box;
      background: ${INK}; color: ${PAPER};
      border: 1px solid ${LINE}; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      padding: 14px 52px 16px 16px;
      max-width: 400px; max-height: 480px; overflow-y: auto;
      font: 14px/1.6 ${FONT}; letter-spacing: normal; text-align: left;
      display: none; opacity: 0; transition: opacity 0.18s ease;
      pointer-events: auto; cursor: auto; user-select: text;
      scrollbar-width: thin; scrollbar-color: rgba(238,238,230,0.25) transparent;
    }
    #${id} .hw-tip-head {
      display: flex; align-items: center; gap: 8px; margin: 0 0 10px;
      font: 600 11px/1 ${MONO}; letter-spacing: 0.08em; text-transform: uppercase; color: ${MUTED};
    }
    #${id} .hw-tip-dot { width: 8px; height: 8px; border-radius: 50%; background: ${LIME}; flex: none; }
    #${id} p { margin: 0 0 10px; color: ${PAPER}; }
    #${id} p:last-child { margin-bottom: 0; }
    #${id} ul { margin: 8px 0 10px; padding-left: 20px; list-style: disc outside; }
    #${id} li { margin-bottom: 7px; line-height: 1.55; display: list-item; color: ${PAPER}; }
    #${id} li::marker { color: ${MUTED}; }
    #${id} h2, #${id} h3, #${id} h4 { margin: 12px 0 6px; font: 600 15px/1.3 ${FONT}; color: ${PAPER}; letter-spacing: -0.01em; }
    #${id} strong { font-weight: 600; color: ${PAPER}; }
    #${id} em { font-style: italic; }
    #${id} .hw-tip-wait { color: ${MUTED}; font-style: normal; }
    #${id} .hw-tip-error { display: flex; gap: 8px; color: ${PAPER}; }
    #${id} .hw-tip-error::before { content: '⚠'; color: ${LIME}; font-family: ${MONO}; }
    .${closeClass} {
      position: absolute; top: 8px; right: 8px; z-index: 1;
      width: 36px; height: 36px; padding: 0; margin: 0;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px; border: 1px solid ${LINE}; background: transparent;
      color: ${PAPER}; font: 400 20px/1 ${FONT}; cursor: pointer;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .${closeClass}:hover { background: ${SURFACE}; border-color: rgba(238, 238, 230, 0.3); }
    .${closeClass}:focus-visible { outline: 2px solid ${LIME}; outline-offset: 2px; }
  `;
}

export const tooltipHead = '<div class="hw-tip-head" aria-hidden="true"><span class="hw-tip-dot"></span><span>Headway summary</span></div>';
export const waitHtml = (text: string) => `<p class="hw-tip-wait">${text}</p>`;
