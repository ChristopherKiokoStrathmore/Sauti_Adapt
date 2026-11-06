# Sauti Adapt accessibility review

Status: **NOT VERIFIED** as a WCAG 2.2 AA conformance claim.
Date: 6 November 2026.

This is an engineering checklist, not an accessibility certification.
Automated axe results can only detect a subset of barriers. Manual review,
co-designer testing and assistive technology testing are still required.

| Review area | Evidence source | Status |
| --- | --- | --- |
| Semantic landmarks and accessible names | `e2e/accessibility.spec.ts` axe checks | NOT VERIFIED until CI |
| Colour contrast and text legibility | Axe and visual inspection | NOT VERIFIED |
| Keyboard access to onboarding | Playwright keyboard test | NOT VERIFIED until CI |
| Focus visibility and order | Manual keyboard and assistive technology review | NOT VERIFIED |
| Target size at least 24 CSS px or exception | Axe and target-specific Playwright test | NOT VERIFIED |
| Reduced motion | Web stylesheet media query and manual device check | NOT VERIFIED |
| Screen reader announcements | NVDA and VoiceOver with co-designer | NOT VERIFIED |
| Error identification and recovery | Co-designer scenarios | NOT VERIFIED |
| Language of page and sections | HTML language attributes and native review | NOT VERIFIED |
| WCAG 2.2 AA combined audit | Independent manual assessment | NOT VERIFIED |

## Swahili copy

`apps/web/i18n/sw-KE.review.json` contains draft strings for review.
They are **not integrated into the production UI**, not approved and not
verified by a native Kiswahili speaker. They must not be presented as
localised, culturally validated copy.

## Headway ownership

The teammate maintained `apps/headway` source is unchanged. Camera privacy,
optional debugger permission and source refactor must be in a **separate PR**
with explicit teammate review. The Sauti PWA cannot grant browser extension
permissions or control external desktop applications.
