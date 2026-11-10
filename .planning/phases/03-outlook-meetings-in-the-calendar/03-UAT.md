# Phase 3 UAT (production, time.untangle.es, image sha-22fbbab)

**Date:** 2026-11-10 · **Tester:** owner

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Real week vs Outlook | pass | Compared with Clockify's Outlook calendar for the week of Nov 9: same meetings, same local times |
| 2 | Sync twice + navigation | pass (UX issue) | Button greys out after one press and the user cannot tell when it is available again; navigation keeps it disabled. -> UX-06 (Phase 3.1) |
| 3 | Dismiss / Show dismissed / Restore | pass | |
| 4 | Entra revocation -> Reconnect | pass | |
| 5 | Connect from a user without Microsoft | pass | |
| 6 | Second account + impersonation | waived | Owner will not use impersonation; automated privacy tests cover it |

## Feedback (new scope)

- View options: hide weekends, start/end hour of the visible day (UX-01)
- More contrast and more readable text on meeting blocks, like Clockify (UX-02)
- Hover tooltip on desktop instead of click only (UX-03)
- "Create time entry" inside the tooltip (ASGN-01, Phase 4); the right-click menu must close the tooltip or render above it (UX-04)
- Mouse wheel zoom / scroll, better navigation (UX-05)
- Theme switch, highlight colour, Untangle colours by default (BRAND-01, BRAND-02, BRAND-04)
- Organization icon in workspace settings (BRAND-03)
