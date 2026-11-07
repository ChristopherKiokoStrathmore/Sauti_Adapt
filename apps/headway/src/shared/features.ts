/**
 * Feature switches, decided at build time.
 *
 * SUMMARIES_ENABLED: link summaries (mouse hover, head-pointer dwell, the side panel's
 * Summaries section) are hidden for now. With it off, the summary code stays in the
 * bundle but nothing triggers it, and dwell does nothing: the pointer still snaps to
 * links so mouth click lands on them. Set it to true and rebuild to bring summaries back.
 */
export const SUMMARIES_ENABLED = false;

/**
 * HEAD_POINTER_ENABLED: head pointer and mouth click (camera). Off in the audio-only
 * Headway: the gaze content script loads nothing, so no page ever asks for the camera,
 * even if `gazeEnabled` is still true in storage from an earlier version. The side
 * panel hides the Pointer and Click sections. Set to true and rebuild to bring them back.
 */
export const HEAD_POINTER_ENABLED = false;
