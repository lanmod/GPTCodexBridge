# Dashboard Web Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users operate the WebCodexBridge workflow from the browser dashboard without typing routine `wcb` commands.

**Architecture:** Add a small POST action layer to `src/dashboard.ts` that delegates to the existing command functions in `src/commands.ts`. Keep the browser UI as a local cockpit: forms and buttons submit actions, then refresh `/api/state` so the page remains the source of current status.

**Tech Stack:** Node HTTP server, TypeScript, existing command functions, Vitest.

---

### Task 1: Action API

**Files:**
- Modify: `src/dashboard.ts`
- Test: `tests/dashboard.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests that POST to `/api/actions/create-task`, `/api/actions/codex-prompt`, and `/api/actions/snapshot`, then assert the response includes `ok: true`, a Chinese message, and refreshed dashboard state.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --run tests/dashboard.test.ts`

Expected: tests fail because `/api/actions/*` returns 404.

- [ ] **Step 3: Implement minimal action routing**

In `src/dashboard.ts`, parse JSON request bodies for POST `/api/actions/<name>`, dispatch to existing command functions, and return `{ ok, message, state }`.

- [ ] **Step 4: Verify**

Run: `npm test -- --run tests/dashboard.test.ts`

Expected: dashboard tests pass.

### Task 2: Browser Controls

**Files:**
- Modify: `src/dashboard.ts`
- Test: `tests/dashboard.test.ts`

- [ ] **Step 1: Write failing HTML tests**

Assert the dashboard HTML contains the operation panel, task title field, task description field, verify command field, and action buttons.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --run tests/dashboard.test.ts`

Expected: tests fail because the controls do not exist yet.

- [ ] **Step 3: Implement controls**

Add a compact operation panel with create task, Codex prompt, snapshot, commit, rollback, GitHub package, GitHub publish, refresh, and copy handoff controls. Actions should call the POST API and refresh state.

- [ ] **Step 4: Verify**

Run: `npm test -- --run tests/dashboard.test.ts`

Expected: dashboard tests pass.

### Task 3: Documentation And Full Verification

**Files:**
- Modify: `docs/操作说明.md`
- Modify: `README.md` if needed

- [ ] **Step 1: Update operation docs**

Document that routine work can now happen from the browser dashboard after starting `wcb serve`.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test -- --run
npm run build
```

Expected: all tests and build pass.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard.ts tests/dashboard.test.ts docs/操作说明.md docs/superpowers/plans/2026-06-07-dashboard-web-actions.md
git commit -m "实现网页驾驶舱操作闭环"
```
