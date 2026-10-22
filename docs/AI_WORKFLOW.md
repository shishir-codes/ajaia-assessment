# AI workflow note

**Live app: https://ajaia-assessment-bice.vercel.app**

I built this with AI as a force multiplier, not an autopilot. I set the direction and made the calls; the AI did the heavy lifting in parallel, under rules I wrote, and its work was checked by running it, not by trusting it.

## Tools

| Tool | Used for |
|---|---|
| Claude Code (an agentic coding assistant running on Anthropic's Claude models) | Planning, the build contract, code, tests, reviews and docs. It ran parallel helper agents for the backend, frontend, QA, hardening and docs. |
| Playwright (playwright-core) driving Microsoft Edge | Scripted browser QA at desktop and phone sizes, plus the screenshots |
| node --test | API, import, safeguard and unit tests on an in memory Postgres (PGlite) |
| Vercel CLI | Production deploys |

## Who did what

**My part**
- Set the goal and the 4 hour timebox, and approved the scope and the stack.
- Created the Neon Postgres database, connected it to the Vercel project, and kept its credentials out of the repo and the submission folder.
- Chose to import files into a new editable document instead of storing attachments, and kept the 2 MB limit with direct to storage uploads on the roadmap.
- Required public demo safeguards, so reviewers can test freely without breaking anything.
- Required a responsive layout for desktop and mobile.
- Required independent verification rounds before recording: builder tests, a reviewer style end to end QA pass, an adversarial review, a live check, and my own final check.
- Set up the Google Drive delivery folder and the Loom walkthrough, then reviewed and tested the result.

**The AI's part**
- Turned my brief into a short build contract: data model, API shapes, status codes, UI labels, limits and test list.
- Wrote the backend, frontend, tests and docs in parallel agents, each editing only its own files.
- Ran every check and reported failures with the actual output.

## The guardrails it worked under

My standing rules (the CLAUDE.md file Claude Code loads at the start of every session, plus the build rules for this project):

- **Risk first.** Surface risk before acting, and stop for my explicit go ahead on anything touching production servers, DNS, secrets, deploys, spending or credentials.
- **Plans carry their blast radius.** What changes, what could break, the edge cases (empty, malformed, oversized, unicode, concurrent, partial failure, retry, permission denied, upstream failure, second run), how we would know it broke, and the rollback.
- **Verify by risk.** Availability, then anything that writes, then anything that spends, then security, then surfaces.
- **No unearned ticks.** Nothing is called verified unless it was actually run.
- **Secrets stay secret.** Never printed, logged or committed.

## Where AI materially sped up the work

- **Parallel build against one contract.** Backend and frontend were written at the same time, and the frontend's browser flows then ran against the real API and passed.
- **Tests and fixtures in minutes.** 52 tests, including a real .docx file assembled inside the test.
- **Scripted QA that reruns after every fix.** 50 end to end checks in headless Edge, including two browser conflicts, access removed mid edit and phone widths.
- **Docs and the walkthrough script**, written from the verified reports instead of from memory.

## AI output that was changed or rejected

| What the AI first produced | Why it was wrong | What we did |
|---|---|---|
| A request helper that capped JSON bodies at 64 KB | A 2 MB file is about 2.7 MB as base64, so any file over about 48 KB would have failed to import | Raised the cap to 4 MB with the contract's `too_large` code |
| A local server that loaded `.env` files when imported | Tests could pick up a real `DATABASE_URL` and write test data into production | Env loading only when run directly, plus a test guard that refuses any database except PGlite |
| Separate saves for the title and the content | Both carry the same version, so the second would conflict with your own first save | One serialized save queue |
| "Keep mine" that overwrote the whole document | A title only edit would wipe a collaborator's text | Resend only the fields this person changed |
| The sanitiser's default link rules | Relative and protocol relative links such as `//evil.example` got through | Explicit rule: absolute http, https and mailto only (tested) |
| Seeding with separate inserts | A crash or two cold starts could half seed or seed twice | One atomic statement that also claims the "seeded" key |
| "StarterKit plus Underline" in the editor | StarterKit 3 already bundles Underline and Link, so the extension would be registered twice | Configured through StarterKit |
| A save on leaving with `fetch` keepalive | Keepalive caps bodies at 64 KB, so large documents would be dropped silently | Normal fetch plus the browser's leave prompt |
| Local query parsing where the last repeated key won | Vercel passes an array, so local and production disagreed (caught by the adversarial pass) | Parse exactly as Vercel does |
| No upper bound on `baseVersion`, and NUL characters passed through | Postgres would answer 500 for an integer overflow or a NUL in text | 400 outside the valid range; NUL stripped from text and refused in ids and emails (tested) |
| File import with no limit on unzipped size or Markdown complexity | A 50 KB .docx can unzip to gigabytes and exhaust memory, and some Markdown takes seconds to parse (found by the adversarial review) | Unzipped size capped at 4 MB and Markdown complexity capped, both checked before parsing, with tests |
| "Switch user" kept the open document's address | The next person signed in straight onto someone else's document | Switch user now returns to the home list |

## How correctness, UX and reliability were verified

| Round | What ran | Result |
|---|---|---|
| Builder tests | `npm test`, repeated after each change (37 core tests, 12 for the safeguards, 3 from the adversarial review) | 52 of 52 pass |
| Live HTTP checks | `scripts/smoke.mjs` with real cookies as Alice, Bob and Carol | 39 of 39 pass |
| Adversarial checks | 5 MB bodies, 20 simultaneous saves, junk cookies, SQL looking ids, unicode | 13 of 13 pass |
| Frontend flows | Headless Edge: formatting, autosave, share, conflict, import, delete, phone width | 18 of 18 pass |
| Reviewer style QA | Headless Edge on a fresh database: 32 main, 10 edge, 4 failure path and 4 switch user checks | 50 of 50 pass |
| Live browser check | The production URL in headless Edge at desktop 1280 and phone 390 px, every flow from sign in to delete | 31 of 31 pass |
| Visual pass | Desktop 1280, tablet 768 with reduced motion, phone 390 px | 32 of 32 flows pass, no horizontal scrolling |

- **UX:** issues found during these runs and the screenshot reviews were fixed: paragraphs running together, a conflict banner that scrolled out of view, a size message that read as contradictory, a role badge that jumped while typing, and banner wording that implied "Keep mine" merges changes.
- **Reliability:** a hard kill and restart on a file database kept every document and session, and the demo documents did not come back after deletion. A simulated network failure showed "Could not save, retrying" and recovered with "Retry now".
- **Accessibility:** keyboard only runs through the toolbar and dialogs, a visible 2 px focus ring, focus starting on Cancel in the delete dialog, and labels checked for ambiguity.
