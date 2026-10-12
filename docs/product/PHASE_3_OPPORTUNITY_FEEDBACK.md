# Phase 3.8 — Opportunity Feedback

## Purpose and product boundary

Feedback records a user's explicit accept/dismiss decision about one exact,
currently actionable `ContentOpportunity`. `ContentOpportunity` remains the
system's recommendation and keeps only `recommended`, `suppressed`, or `expired`
system status. Feedback is an independent overlay; it does not change
`shouldPost`, scores, novelty, ranking, reasons, provenance, or lifecycle.

Actions are `accepted` and `dismissed`. Dismissal reasons are the bounded values
`not_relevant`, `repetitive`, `too_minor`, `sensitive`, and `other`. Accept has no
reason. Dismiss may omit a reason. Free text is not accepted.

Feedback does not affect Task 3.3 input selection, Task 3.4 detection, Task 3.5
scoring or duplicate suppression, Task 3.6 processing, or Task 3.7 visibility,
ranking, and pagination. It does not enqueue processing, call a provider, create
a draft, or publish content. It is not personalization.

## Persistence and ownership

`OpportunityFeedback` stores an owner UUID, exact opportunity UUID, action,
optional reason, currentness, supersession time, creation time, SHA-256
idempotency-key hash, and SHA-256 request fingerprint. Project ownership is
derived through `ContentOpportunity → Project`; no duplicate project ID is
stored. Database foreign keys cascade user/project/opportunity cleanup, while
normal opportunity expiry/replacement preserves feedback history.

Semantic fields are append-only. Replacing a decision updates only the old row's
`isCurrent=true → false` and `supersededAt=null → timestamp`, then inserts a new
current row. A partial unique index enforces at most one current decision per
user/opportunity. A second unique index scopes idempotency hashes per user across
the feedback domain. Database checks constrain action/reason pairing, current
state, and lowercase SHA-256 format. A database trigger enforces same-owner
feedback and rejects semantic rewrites or historical-to-current reversal.

Authenticated users may SELECT only their own rows under RLS. Authenticated
direct INSERT, UPDATE, and DELETE are revoked; the authenticated API performs
feedback writes. History deletion remains blocked except for parent cleanup
cascades.

## Mutation contract

The authenticated route is `POST
/projects/:projectId/opportunities/:opportunityId/feedback` under the existing
API base path.

```json
{"action":"accepted"}
```

or:

```json
{"action":"dismissed","reason":"repetitive"}
```

Only `action` and optional `reason` are accepted. The `Idempotency-Key` header
is required, must be 1–128 characters, nonblank, and contain no control
characters. The raw key is neither persisted nor logged; only its SHA-256 hash
is stored. Browser server actions generate a cryptographically random UUID for
each intentional submission. A retry within the same API request path reuses
that request's key; another user submission gets a new key.

The versioned request fingerprint is SHA-256 over canonical JSON with fixed
field order: `phase3-opportunity-feedback-v1`, normalized authenticated user ID,
project ID, opportunity ID, action, and normalized reason/null. The idempotency
key is excluded from semantic request identity.

For the same user and key, the same fingerprint replays the original feedback
row without inserting or superseding anything; the response's `isCurrent`
reflects that row's persisted currentness at replay time. A different fingerprint
returns HTTP 409 without mutation. Replay is resolved before checking whether an
otherwise-owned opportunity is still actionable, so a successful retry still
works after that opportunity expires. A new key is accepted only while the exact
opportunity is current, recommended, `shouldPost=true`, and not expired. A
stale or mismatched project/opportunity pair is not silently rebound to a
replacement opportunity.

The transaction uses SERIALIZABLE isolation and locks the owner Project first,
then the exact ContentOpportunity row. This shares Task 3.5's Project lock order
and serializes replacement against feedback. It then resolves idempotency,
checks actionability, supersedes the prior current row if present, and inserts
the new current row atomically. Database uniqueness remains the final race
guard. Concurrent serializable conflicts are retried a bounded number of times;
unique-key races are resolved as replay/conflict or a safe 409.

The response exposes only `id`, `opportunityId`, `action`, `reason`, `createdAt`,
and `isCurrent`; key hashes, fingerprints, user IDs, and persistence internals
are private.

## Read model and dashboard

Task 3.7 returns only current feedback for the authenticated user on each card:

```text
currentFeedback: { action, reason, createdAt } | null
```

The page query uses one bounded nested relation query filtered by user and
currentness (`take: 2` to fail closed on an invariant violation). Historical
feedback is not exposed in normal cards. Feedback does not enter ranking or
cursor identity, and accepted/dismissed cards remain visible under the existing
system recommendation predicate. A replacement opportunity begins with no
feedback; older feedback remains attached to the older opportunity.

The dashboard always permits changing a decision while the opportunity remains
actionable. Accept submits no reason. Dismiss offers only the five structured
reasons plus “No reason”; there is no free-text field. The current decision is
rendered as text (including a human-readable dismissal reason) and does not rely
on color alone. A stale click returns safe refresh guidance. Accept does not
imply draft generation.

## Verification and migration checkpoint

The forward-only migration is
`20260925100000_add_opportunity_feedback`. It is migration 20 in the repository.
It was applied to the development database at the authorized delivery checkpoint;
`db:migrate:status` reports 20 migrations found and the schema up to date.

Static migration checks and the explicitly enabled real database invariant tests
passed after migration application. Repository verification gates and both
Gitleaks history and trackable-content scans also passed.
