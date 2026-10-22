# Architecture note

**Live app: https://ajaia-assessment-bice.vercel.app**

Ajaia Docs is a React single page app on a stateless serverless API, backed by Postgres. This note covers what I prioritised, how the parts fit, and what comes next.

## What I prioritised and why

1. **No lost or leaked work.** Permissions are enforced on the server and every save is version checked, because a silent overwrite or a leaked document is the failure users never forgive.
2. **A complete core flow over breadth.** Sign in, create, edit, autosave, import, share and conflict handling each work end to end on desktop and phone.
3. **Proof, not claims.** 49 automated tests, 39 live HTTP checks, 13 adversarial checks and 50 scripted browser checks, all passing.
4. **Safe to demo in public.** Limits, rate limits and a one command demo reset let reviewers test freely.

## Architecture

```text
Browser: React 19 SPA, TipTap editor, hash routes #/ and #/doc/<id>
   |   same origin fetch, JSON, HttpOnly session cookie
   v
Vercel serverless functions (Node.js): api/*.js, one file per route
   |   session check > input validation > permission check > one SQL statement
   v
Postgres: Neon over HTTP in production, PGlite (Postgres in WebAssembly) locally and in tests
```

- **Stateless API.** Each request carries a signed cookie, so any function instance can serve any request. Only the per instance rate limiters live in memory.
- **One database helper.** `query(text, params)` hides the driver. Neon serves production, PGlite serves local runs and tests with no setup, and the same SQL runs on both.
- **Self provisioning schema.** One check per cold start creates any missing tables. Both demo documents and their shares are seeded by one atomic statement, so concurrent cold starts cannot double seed, and a deleted demo document never comes back.
- **Fast first load.** The main bundle is 76 kB gzipped. The editor (133 kB gzipped) loads only when a document opens.

## Data model

```sql
users(id PK, email UNIQUE, name)
documents(id PK, owner_id -> users, title, content, version, created_at, updated_at, updated_by -> users)
document_shares(document_id -> documents ON DELETE CASCADE, user_id -> users,
                role CHECK IN ('viewer','editor'), created_at, PRIMARY KEY (document_id, user_id))
meta(key PK, value)
```

Ownership lives on the document; sharing is one row per person with a role. Deleting a document removes its shares in the same statement. Indexes cover the two hot lookups (documents by owner, shares by user).

## Access model

| Role | Read | Edit title and content | Share, change roles, remove access | Delete |
|---|---|---|---|---|
| Owner | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | No (403) | No (403) |
| Viewer | Yes | No (403) | No (403) | No (403) |
| No access | 404 | 404 | 404 | 404 |

- Every documents, document, shares and import request requires a valid session (401 otherwise).
- No access answers 404 `not_found`, so nobody can probe which documents exist.
- Sessions are `userId.hmac` cookies signed with HMAC-SHA256, compared in constant time, HttpOnly, SameSite=Lax and Secure in production. The user is looked up on every request.
- Sign in is mocked by design (seeded users, no passwords). The permission layer is real.

## Autosave and optimistic concurrency

- **Client:** one serialized save queue sends title and content together with `baseVersion`, about 1 second after typing stops, on Ctrl+S, and before leaving the page. A second save never races the first.
- **Server:** one conditional statement, `UPDATE ... WHERE id = $1 AND version = $base AND (owner or editor) RETURNING ...`. When no row comes back, the server works out why: 404 for no access, 403 for a viewer, otherwise 409 `version_conflict` with the latest document.
- **UI:** the 409 banner offers "Load latest" (fetch the newest version and replace the content) or "Keep mine" (save only the fields this person changed on top of the newest version).
- **Proven:** 20 simultaneous saves from the same version give exactly one 200 and nineteen 409s, each carrying the new version.
- **Failure handling:** network and 5xx errors retry with backoff from 2 to 30 seconds. A 403 or 404 mid edit locks the editor and keeps the text on screen.

## Sanitising

- One allowlist runs on every write: create, save and import. Allowed: `p br strong b em i u s h1 h2 h3 ul ol li blockquote code pre hr a`.
- Links keep only absolute `http`, `https` and `mailto` targets. Scripts, styles, SVG, event handlers, `javascript:` and `data:` links are removed, NUL characters are stripped, and nesting is capped at 64.
- The browser renders stored HTML only through TipTap's schema, never through `dangerouslySetInnerHTML`. That is two independent layers.

## Reliability and operations

- **Retry safe by design.** Removing access that is already gone still returns 200, schema setup and seeding are safe to run again, and the demo reset gives the same result on a second run.
- **Failures are explicit.** A failed database setup is not cached, so the next request retries. A deployment without a connection string answers 503 `db_not_configured` instead of crashing, and `/api/health` answers 503 when the database is unreachable.
- **A strict HTTP surface.** JSON only bodies (415 otherwise), 405 with an Allow header for wrong methods, `Cache-Control: no-store` on every API response, and security headers on every path.
- **Logs that are safe to read.** One JSON line per event, never document content, file contents or secrets; connection strings and keys are scrubbed from error messages.
- **Accessible by default.** Labelled controls, a visible focus ring, native dialogs that trap focus and close on Escape, and a save status that screen readers announce.

## Safeguards

Per user caps (100 documents, 20 new documents per 10 minutes, counted in the database inside the insert statement itself, so they hold across every server instance), per instance rate limits (120 saves and 30 share changes per user per minute, 20 sign ins per IP per minute), size limits on every input, security headers on every response, and `node scripts/reset-demo.mjs` to restore the demo documents. Full table in the [README](../README.md#public-demo-safeguards).

## Deliberate scope decisions

| Deliberately scoped out | Why | What it would take |
|---|---|---|
| Real time co editing | CRDTs and websockets are a project of their own. Version checked saves already guarantee no silent overwrite. | Yjs with a websocket provider, presence and cursors |
| Comments | Outside the core create, edit and share flow | A comments table anchored to text ranges |
| Real authentication | Seeded demo users keep the review frictionless; sessions and roles are still enforced on the server | OAuth or magic links, server side session expiry |
| Version history | Every save already increments a version number | A versions table written on each save, plus restore |
| Attachment storage | Importing into an editable document is the more useful flow and keeps requests under 2 MB | Direct to storage uploads with signed URLs |
| Export | Stretch goal behind the core flows | Download as HTML, Markdown or .docx |

## The next 2 to 4 hours

| # | Step | Why it matters | Effort |
|---|---|---|---|
| 1 | Live refresh: poll the document version, or use server sent events, and show who else has it open | Collaborators see each other's saves before a conflict happens | About 1 hour |
| 2 | Version history with restore | Undo across sessions and people, built on the existing version counter | About 1 hour |
| 3 | Export as HTML and Markdown | Content leaves the app as easily as it comes in | About 30 minutes |
| 4 | Shared rate limit store and server side session expiry | Limits hold across all instances; sessions end on schedule | About 30 minutes |
| 5 | Insert link button and arrow key toolbar navigation | Faster editing and better keyboard support | About 30 minutes |
