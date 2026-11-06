# Ledger — Suggested standing instruction to add to `CLAUDE.md`

Place the following block in the existing `CLAUDE.md` (append without removing existing rules). This is a **proposed local-repo edit**, not a claim that the repo has been changed.

---

## ChatGPT handoff continuity — mandatory

`docs/CHATGPT-HANDOFF.md` is the rolling, public-safe context document for future ChatGPT conversations. Read it alongside `docs/BACKLOG.md` and the relevant phase reports before every Ledger development phase. It summarizes project vision, approved architectural decisions, feature status, risks, AI strategy, current milestone, and next steps; current source code and Git/deployment evidence take precedence over stale text.

**Always update `docs/CHATGPT-HANDOFF.md` as part of the same reviewed work batch** whenever you implement a feature, update an architectural decision, resolve a blocker, change the roadmap, or prepare a phase report. At each stage correctly distinguish planned, built but uncommitted, committed, deployed, and acceptance-tested. After a commit/push, verify GitHub Actions and report the SHA/status; update the handoff during the next authorized change if a separate commit would otherwise be needed. Never make an unauthorized commit/push simply to refresh this document.

Before finishing a work batch:

1. Check Git status, newest report, `docs/BACKLOG.md`, and (where possible) GitHub Actions.
2. Refresh the handoff's **current snapshot, phase status, next action, approved decisions, open risks, AI roadmap and change log**. Preserve architectural invariants. Reconcile stale backlog statements.
3. Keep the public repo free of real household data, private addresses, identities, financial balances, exported files, credentials and secrets. Use invented examples only.
4. In your report state whether the handoff was updated, what changed, and anything that remains unknown.
5. Include the handoff in the phase's review and git diff; **never commit/push until the owner explicitly authorizes it**.

If ChatGPT sends a new decision or change request, apply that information to the handoff during the work batch once the owner has approved it; do not infer decisions merely from a discussion or suggestion. The handoff is a maintained summary, not a substitute for authoritative code, tests, Git state or detailed reports.
