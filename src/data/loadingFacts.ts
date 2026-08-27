// =============================================================================
// Rotating "did you know" lines shown under the spinner on every loading
// screen (src/components/LoadingTasks.tsx). Two jobs: say what ARC actually
// is (built by describing it to Claude, not hand-typed), and give people
// something true and specific to read instead of staring at dots.
//
// Numbers here are real snapshots, not live counts — ARC has no backend to
// compute them from, and a loading screen is the wrong place to fetch one
// more thing. Update them occasionally; a slightly stale "1,800+" reads fine,
// a fabricated one doesn't. Row counts are the ones already discovered and
// documented in CLAUDE.md; commit/line/test counts were counted 2026-08-27.
// =============================================================================

export const LOADING_FACTS: readonly string[] = [
  "ARC — the Altronic Resource Center — is written entirely by describing it in plain English to Claude, Anthropic's AI. No template, no generator: every screen was a conversation before it was code.",
  "This is what's sometimes called \"vibe coding\" — an AI writes, tests and ships the code from a description of what's needed. ARC is a real, everyday tool built that way.",
  "ARC has no server of its own. It's a static site that talks straight to SharePoint and Microsoft Graph from your browser, using your own Microsoft sign-in.",
  "ARC's source runs to roughly 97,000 lines of code across more than 360 files — every line of it written by Claude.",
  "227 automated test files and over 2,600 individual tests run before every single change ships — nothing goes out untested.",
  "The project has shipped more than 330 versioned releases so far, each one logged in the changelog you can open from the footer.",
  "CLAUDE.md — the file that tells Claude how this app works and why — runs to about 30,000 words. Longer than it sounds, reading it out loud.",
  "ARC reads from and writes to 60 different SharePoint lists spread across five Microsoft 365 sites.",
  "The Engineering Change Notice list alone holds over 1,800 change notices going back years — every one searchable from ARC in under a second.",
  "The Teradyne board-test log has grown past 16,000 rows since 2023. ARC only loads the current year by default, to keep it fast.",
  "531 suppliers are tracked in the SRM tool.",
  "This app is built from 63 views, 88 components and 46 data hooks — almost none of it hand-typed.",
  "400 commits in, and every one went through the same checks: typecheck, the full test suite, then a real production build, before anything shipped.",
  "Every user-visible change in ARC gets a changelog entry — you can see the whole history from the version number in the footer.",
] as const;
