# Autonomous Browser Agent — Architecture

PromptGuard's agent operates the browser on the user's behalf while defending
itself against indirect prompt injection. This document covers how it is put
together, why the pieces are arranged this way, and what it does not do.

---

## The shape of one iteration

```
                        ┌─────────────────────────┐
   goal ───────────────►│      Agent Runtime      │
                        │        (renderer)       │
                        └───────────┬─────────────┘
                                    │
                        extractPageState (AXTree)
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
      PLANNING PIPELINE                          SECURITY PIPELINE
              │                                           │
   State Builder → semantic state              deep CDP content snapshot
              │                                           │
   POST /api/v1/agent/plan                POST /api/v1/agent/scan-active-page
              │                                           │
      validated tool call(s)                      allowed: true | false
              │                                           │
              └─────────────────────┬─────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  CIRCUIT BREAKER  │
                          └─────────┬─────────┘
                       allowed?     │
                    ┌───────────────┴───────────────┐
                   yes                              no
                    │                                │
        approval gate (if needed)          discard the action,
                    │                      end the task, log it
            Browser Runtime
         (native CDP input events)
                    │
          Verification Engine
                    │
        ┌───────────┴───────────┐
    verified                unverified
        │                       │
   next action        Recovery Engine ladder
```

The two pipelines run concurrently via `Promise.allSettled`, because neither
depends on the other's result and both are on the critical path. The
concurrency is only safe because of the rule that follows it: **the planner may
produce an action while a scan is in flight, but nothing executes until the
verdict is in.**

---

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| Browser Runtime | `frontend/electron/browserRuntime/` | The only path to the page. CDP only. |
| CDP session | `cdpSession.ts` | Owns the single debugger attachment; fans events out |
| Page inspector | `pageInspector.ts` | `Accessibility.getFullAXTree`, `Page.captureScreenshot` |
| State Builder | `stateBuilder.ts` | AXTree → compact semantic state (pure) |
| Element resolver | `elementResolver.ts` | `backendNodeId` → viewport point |
| Native input | `nativeInput.ts` | `Input.dispatchMouseEvent` / `dispatchKeyEvent` |
| Wait engine | `waitEngine.ts` | Event-driven waits; no fixed sleeps |
| Verification | `verificationEngine.ts` | Did the action actually do anything? |
| Agent runtime core | `frontend/src/services/agentRuntimeCore.ts` | The loop |
| Circuit breaker | `agentCircuitBreaker.ts` | The hard stop |
| Security pipeline | `agentSecurityPipeline.ts` | Capture → cache → scan |
| Recovery engine | `agentRecoveryEngine.ts` | retry → refind → wait → rebuild → replan |
| Approval policy | `agentApprovalPolicy.ts` | Which actions need human consent |
| Browser memory | `agentBrowserMemory.ts` | Reusable per-origin site knowledge |
| Working memory | `agentWorkingMemory.ts` | Per-task structured summary |
| Planner | `backend-node/src/services/agentPlannerService.ts` | Goal + memory + state → tool calls |
| Tool registry | `backend-node/src/services/agentToolRegistry.ts` | Prompt docs + validation, one source |
| Agent security | `backend-node/src/services/agentSecurityService.ts` | Per-channel injection scan |

---

## Security design

### Endpoint isolation

| | Manual "Scan Page" | Agent |
|---|---|---|
| Endpoint | `POST /api/v1/security/check-webpage` | `POST /api/v1/agent/scan-active-page` |
| Schema | `WebpageCheckRequest` | `AgentPageSnapshot` |
| Aggregation | `security_routes.analyze_text` | `agent_security_service` |
| Event log | `security_event_store` | `agent_security_event_store` |
| IPC channel | `security:scan-webview` | `agent:runtime:invoke` |

The agent must never call the manual endpoint, and the manual button must never
call the agent's. Tests assert this in both directions.

**Isolated, but never in disagreement.** The two keep separate channel lists
(`MANUAL_SCAN_CHANNELS`, `AGENT_SCAN_CHANNELS`) so neither can regress the
other, and `test_agent_and_manual_scan_agree.py` pins them equal. A user who
scans a page by hand, sees "no injection detected", and then watches the agent
refuse the same page has been given contradictory advice by one product. That
shipped once: the agent scanned `dom_snapshot_content` and the manual scanner
did not.

`dom_snapshot_content` is now excluded from both. It is the raw string table
from `DOMSnapshot.captureSnapshot` — every tag name, class, attribute value and
URL, with no structure. Its readable text is already covered by `visible_text`,
`hidden_text` and `aria_text`, so it added no reach, only noise.

### Detector precision

Three rules keep ordinary pages out of the blocked column:

1. **Whole-word matching.** Indicators are matched on word boundaries.
   Substring matching made `"dan"` fire inside `"guidance"`, `"abundant"` and
   `"dance"` — this is what blocked youtube.com.
2. **Weak indicators need corroboration.** Terms that describe an ordinary
   subject as often as an attack (`jailbreak`, `developer mode`, `upload to`,
   `extract user`) only count when instruction-like language sits within 160
   characters. Scanning the whole chunk was too generous: any page large enough
   to contain `jailbreak` almost certainly contains some imperative somewhere.
3. **Corroboration must be addressed to a model.** `show` and `follow` were
   tried and are far too common — `"Show more images"` is a button and
   `"follow every step"` is a tutorial. The context set is now second-person
   and directive: `you are`, `you must`, `ignore`, `act as`, `your
   instructions`, `from now on`, and similar. A term also cannot corroborate
   itself, or `"upload to your channel"` would always read as a directive.

Verified against live captures of youtube, wikipedia, github, Hacker News, BBC
News, Stack Overflow, reddit, MDN, amazon, and a Google search for "jailbreak
tutorial": all allowed by both scanners, and injections planted in
`hidden_text`, `html_comments`, `aria_text` and `meta_tags` still caught on
every one.

The one shared component is the low-level CDP content collector, which acts as
a *sensor* for both. Duplicating it is not possible — Electron permits exactly
one `debugger.attach()` per `webContents` — and everything downstream of the
sensor is separate.

### Fail closed, everywhere

A missing verdict, an unreachable backend, a failed capture, or an empty
snapshot all deny execution. The backend returns **400** rather than
`allowed: true` for an empty snapshot, because an empty capture is not evidence
of safety.

A tripped breaker never re-arms within a task. A page that flickers between
hostile and clean content must not be able to earn its way back to executing.

### Layers against injection

1. **Scanning** — every page, every content channel, before any action.
2. **Prompt structure** — the goal precedes the page block; page content is
   fenced in explicit `BEGIN/END UNTRUSTED PAGE CONTENT` markers; the system
   prompt states that text inside has no authority. *Bypassable — a second
   layer, not the control.*
3. **Tool registry** — a planner that is fully compromised still cannot emit a
   tool that does not exist, navigate to `javascript:`/`file:`/`data:`, or
   reference an element id absent from the state it was given.
4. **Runtime allowlist** — the Browser Runtime independently refuses dangerous
   navigation schemes, regardless of what the backend approved.
5. **Structural limits on the worst actions** — see upload, below.
6. **Human approval** — consequential actions stop and ask.

### Upload: structural, not procedural

`DOM.setFileInputFiles` can hand any readable file to a remote site. The
defence is not a permission prompt but the shape of the API: **the planner
names the field, never the file.** Paths come from a native OS picker the user
operates. A fully compromised planner can, at worst, cause a file dialog the
user cancels.

### Browser memory is not an injection store

Memory records only our own structured observations — which `(role, name)`
control worked for which tool on which origin. It never persists page text.
Memory is written from pages that passed a scan, but a scan is a filter, not a
proof; persisting page-derived prose would create a store of
attacker-influenced text that outlives the scan that cleared it and gets
replayed into later prompts. An origin that serves an injection is marked
blocked and everything learned from it is discarded.

### Scan cache

Keyed by `task id + normalised URL + SHA-256 of content`. The content hash is
what makes reuse safe: the same URL serving different content produces a
different key, so a page that mutates after load cannot reuse an earlier
verdict. SHA-256 rather than a cheap hash because a collision would mean
reusing a "safe" verdict for different content. Only clean verdicts are cached.

---

## Why these choices

**AXTree instead of DOM scraping.** Chromium has already resolved roles,
names, and computed visibility, and flags decorative nodes as `ignored`. The
result is smaller, more stable across redesigns, and needs no script in the
page.

**Native CDP input instead of `element.click()`.** Trusted events are
indistinguishable from a user's, so pages relying on `isTrusted`, pointer
capture, or focus side effects behave correctly.

**Per-character key events instead of `Input.insertText`.** `insertText` is one
round trip but produces no keydown/keyup, and React/Vue controlled inputs and
autocomplete widgets only update in response to those.

**AXTree fingerprint polling instead of DOM mutation events.** CDP only reports
mutations for nodes already pushed to the client, making them an unreliable
completeness signal. The fingerprint also ignores animation churn on pages that
are semantically stable.

**Element ids are handles, not selectors.** `e1`, `e2`, … are rebound on every
`extractPageState`. Re-finding matches on role + name — what the planner
actually reasoned about — and never across roles.

---

## Testing

```bash
# Backend (Node/Fastify — current runtime)
cd backend-node && npm test                            # 178 Vitest tests

# Frontend build + lint
cd frontend && npm run build && npm run lint

# End-to-end, including 8 tests driving real CDP
cd frontend && npx playwright test                     # 16 tests
```

> The backend has been migrated from Python/FastAPI to TypeScript/Node.js +
> Fastify (`backend-node/`), and the old Python `backend/` tree has been removed.
> All agent security guarantees below are preserved byte-for-byte; the Vitest
> suites are 1:1 ports of the original `pytest` assertions. See
> `backend-node/MIGRATION.md`.

Additional harness-based checks for the agent internals live in the session
scratchpad (`checkPhase3/5/6/7.mjs`). They bundle the services with esbuild and
exercise them against mock CDP and HTTP. Their value is in the properties they
assert — no action on a blocked page, fail-closed on a scanner outage, upload
refusing planner-supplied paths — which are cheaper to prove against mocks than
against a live browser.

---

## Known limitations

- **Cross-origin iframes are invisible.** `Accessibility.getFullAXTree` on the
  page target reaches same-origin subframes but not out-of-process ones. An
  injection inside a cross-origin iframe appears in neither the semantic state
  nor the security snapshot. **This is the most significant gap in the security
  story.** Fixing it needs CDP target auto-attach and a per-target session.
- **Detection quality is inherited.** With no trained model present, scanning
  runs on the regex rule-based detector. False negatives there are false
  negatives here.
- **The precision rules trade some recall.** An injection phrased without
  second-person directive language and using only a weak indicator — for
  example bare text reading "developer mode" next to no instruction — will not
  be flagged. That is the deliberate cost of not blocking every page that
  mentions jailbreaking. A trained classifier in `app/ml_models/` supersedes
  these heuristics entirely.
- **`dom_snapshot_content` is captured but never scanned** by either pipeline.
  Text that exists *only* in that string table — not in visible, hidden or
  accessibility text — is therefore unscanned. In practice the overlap is
  near-total; the noise was not.
- **Scan-then-act is not atomic.** A page could mutate between the snapshot and
  the action landing. The content hash catches it on the *next* iteration, not
  within one.
- **`click` verification is weak in both directions.** A click that opens a
  native dialog or starts a download reads as unverified; an unrelated page
  mutation makes a no-op click read as verified.
- **Approval heuristics are label-based.** A "Place order" button labelled
  "Continue" will not trigger the financial rule. The rules catch the common
  English cases and nothing more.
- **Confidence does not influence recovery.** It gates approval only.
- **Key codes are best-effort** for punctuation; letters and digits are correct
  for US layout. Non-US layouts and IME input are not modelled.
- **Screenshots are uncapped in size** and are not yet fed to the planner —
  vision support is deliberately out of scope.
- **Browser memory does not include cookies, auth state, or downloads.**
  Cookies and auth live in the Electron session where Chromium manages them;
  duplicating them here would add a weaker second copy of credentials.
- **`terminal` and `email` tools are deliberately not registered.** The
  registry supports them; handing shell execution or outbound mail to an agent
  whose input includes attacker-controlled page text converts a prompt
  injection into remote code execution or a spam relay.
