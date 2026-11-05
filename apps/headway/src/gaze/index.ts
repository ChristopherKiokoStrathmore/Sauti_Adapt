// Gaze content-script bundle. Order matters and matches Nutshell's manifest order:
// core starts the camera pipeline and dispatches gaze:* events, the calibration
// modules and dwell layer listen to them, and overlay draws the pointer and HUD.
import './core';
import './head-cal';
import './mouth-cal';
import './dwell';
import './overlay';
