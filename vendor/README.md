# Official toolkit dependency

Do not copy or reimplement the Controller. Run `npm run setup:toolkit` from the repository root.
The script clones `AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit` at the pinned revision `7cf5006dbab9e328fadf54b654147c6bca44113d` into `vendor/ai4a11y-toolkit`.

The clone is gitignored. CI and Vercel must run the bootstrap before building. The original toolkit is maintained by its own authors; this repository is an independent hackathon integration, not an official release.
