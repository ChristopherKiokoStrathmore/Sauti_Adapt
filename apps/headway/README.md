# Headway

Headway is a Chrome extension for hands-free browsing. Turn your head to move a pointer, rest on a link (dwell) or open your mouth to click, and preview any link with a summary written on your own device.

It builds on [Nutshell](https://github.com/tanhanwei/Nutshell) by Tan Han Wei, rebuilt in TypeScript with a new identity and interface. Headway is MIT licensed; see `LICENSE`.

> **Summaries are switched off for now.** `SUMMARIES_ENABLED` in `src/shared/features.ts` is `false`, so hovering or dwelling on a link opens nothing and the side panel shows only Pointer and Click. Mouth click and scroll/back/forward zones still work. Set it to `true` and rebuild to bring summaries back.

## Run it

```bash
npm install            # from the repo root (this folder is the `headway` workspace)
npm run check:headway  # typecheck, test, and build Headway
```

Or open the Sauti website's **Install Headway** page and download the hackathon ZIP. Extract it first. Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select **the extracted Headway folder** (or `apps/headway` after a local build). The manifest is at the root and points into `dist/`. Rebuild and press reload on the extension card after a change. `npm run watch --workspace headway` rebuilds the TypeScript on save.

Summaries need Chrome's built-in AI (Gemini Nano). The side panel shows whether the Summarizer and Prompt models are ready, need downloading, or are missing on this device. Head tracking needs a camera, and Chrome asks for it per site.

## Layout

```
manifest.json          MV3 manifest (root, so Load unpacked works on this folder)
icons/                 toolbar and store icons (from ~/Documents/headway-brand)
assets/fonts/          Bricolage Grotesque, subset woff2 (SIL OFL)
src/background/        service worker: summarisation jobs, caches, Reddit / YouTube / X helpers
src/content/           hover previews, tooltip, X thread capture
src/gaze/              head pointer: core (Human.js pipeline), head-cal, mouth-cal, dwell, overlay
src/youtube/           bridge (isolated world) and caption handler (page world)
src/twitter/           GraphQL response copier (page world)
src/sidepanel/         settings and summary display
src/shared/            message types, summary formatter, in-page theme
src/types/             Chrome built-in AI types, gaze event contract
test/                  node:test suites (formatter, manifest)
build.mjs              esbuild bundle + static copy into dist/
```

## What is JavaScript, and why

Headway's own code is all TypeScript under `strict`. Two libraries were vendored JavaScript files in Nutshell and are now typed npm dependencies:

- **Mozilla Readability**: `@mozilla/readability@0.6.0`, bundled into the content and gaze scripts.
- **Human.js**: `@vladmandic/human@3.3.6`, byte-identical to the copy Nutshell vendored. Headway uses its TypeScript types. The built `human.esm.js` is copied to `dist/human/` and imported on demand, so pages where head tracking is off never load it.

Nutshell also shipped WebGazer and clmtrackr, but no code referenced them, so Headway does not include them.

## Research

`Research/` records each problem we hit and what we tried, one numbered file per problem. `Research/target-test.html` measures hit rate and time on 24–110 px targets; serve it over http so the content scripts run.

## Checks

```bash
npm run typecheck:headway   # src under strict, tests with Node types
npm run test:headway        # formatter, pointing, and manifest checks
npm run build:headway       # bundle unpacked Chrome extension
```

## Not verified

- **Summaries:** not tested with a real Gemini Nano model. Chromium for Testing has no model, so automated runs reach the "not available on this device" error path.
- **Head pointer accuracy and mouth-click thresholds:** not measured with a person. Automated runs use Chrome's fake camera, which has no face.
- **YouTube captions and X thread capture:** ported unchanged in logic and type-checked, but not exercised against the live sites in this rebuild.
