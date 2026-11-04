/**
 * Feature switches, decided at build time.
 *
 * SUMMARIES_ENABLED: link summaries (mouse hover, head-pointer dwell, the side panel's
 * Summaries section) are hidden for now. With it off, the summary code stays in the
 * bundle but nothing triggers it, and dwell does nothing: the pointer still snaps to
 * links so mouth click lands on them. Set it to true and rebuild to bring summaries back.
 */
export const SUMMARIES_ENABLED = false;
