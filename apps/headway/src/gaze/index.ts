// Gaze content-script bundle. Order matters and matches Nutshell's manifest order:
// core starts the camera pipeline and dispatches gaze:* events, the calibration
// modules and dwell layer listen to them, and overlay draws the pointer and HUD.
//
// Loaded only when the head pointer is switched on at build time (shared/features.ts).
// With it off, nothing below runs, so no page asks for the camera.
import { HEAD_POINTER_ENABLED } from '../shared/features';

if (HEAD_POINTER_ENABLED) {
  void (async () => {
    await import('./core');
    await import('./head-cal');
    await import('./mouth-cal');
    await import('./dwell');
    await import('./overlay');
  })();
}

export {};
