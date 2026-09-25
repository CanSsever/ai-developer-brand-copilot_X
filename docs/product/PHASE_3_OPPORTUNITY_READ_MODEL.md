# Phase 3 Opportunity Read Model

Task 3.7 exposes persisted content opportunities without invoking the detector,
scorer, reprocessing queue, or GitHub integration.

## Endpoint and ownership

The authenticated endpoint is `GET /projects/:projectId/opportunities` (under
the API's configured global prefix). The project lookup is scoped to both the
requested project ID and the authenticated user ID. A missing project and a
project owned by another user return the same not-found response.

Optional pagination query parameters are `limit` (default 10, range 1-25) and
`cursor`. The cursor is an opaque, version-1, project-bound base64url value.
Malformed, non-canonical, or cross-project cursors are rejected. Pagination is
keyset-based; it does not use offsets.

## Visible rows and order

An opportunity is visible only when all of these persisted values hold:

- `isCurrent = true`
- `status = recommended`
- `shouldPost = true`
- `expiredAt = null`

Rows are ordered by priority score descending, confidence descending, novelty
score descending, candidate key ascending, then ID ascending. The cursor carries
the complete ordering tuple so page boundaries remain deterministic. The
candidate key is used only for ordering and cursor continuation; it is not
returned in a card.

## Safe response

Cards contain the bounded title, opportunity type, recommended format, scores,
scoring version, creation time, ordered reason signals, and selected
development-event references. Reason signals retain their persisted order and
include code, effect, optional value, and IDs that resolve within the card's
selected provenance. The API rejects inconsistent cross-project or
out-of-provenance links rather than returning a partial explanation.

The dashboard maps every approved reason code to fixed copy (negative signals
are marked as a caution):

| Reason code | Display label |
| --- | --- |
| `high_importance` | High-impact development |
| `high_content_potential` | Strong content potential |
| `fresh_work` | Fresh work |
| `novel_topic` | High novelty |
| `feature_completed` | Feature completed |
| `release_or_milestone` | Release or milestone |
| `multi_event_story` | Multiple development events form one story |
| `duplicate_topic` | Duplicate topic |
| `repetition_penalty` | Repeated development theme |
| `low_novelty` | Low novelty |
| `low_confidence` | Lower confidence |

Static opportunity-type labels are Progress update, Feature showcase,
Technical insight, Problem and solution, Milestone, and Release. Static format
labels are Short update, Visual progress update, Technical breakdown, Milestone
update, Release announcement, and Multi-point story. These maps contain
presentation copy only; the API's order and persisted reason values are
authoritative.

Processing status is read from the latest run for the project and the current
processing version supplied by Task 3.6. The response exposes only the
allowlisted status, safe status message, timestamps, retry time, version, and
aggregate counts. Internal failure codes, lease details, fingerprints,
candidate keys, provider data, and source evidence are not part of the public
contract.

The statuses are `queued`, `running`, `succeeded`, `failed_retryable`, and
`failed_terminal`. The dashboard renders specific no-run, queued/running,
successful-zero-candidate, successful-all-suppressed, retryable (including its
retry time), and terminal-failure messages. Existing cards stay visible while
a newer run is queued, running, or retryable.

| Status | Safe status message |
| --- | --- |
| `queued` | Content opportunity analysis is queued. |
| `running` | Content opportunity analysis is in progress. |
| `succeeded` | Content opportunity analysis is up to date. |
| `failed_retryable` | Content opportunity analysis is temporarily delayed and will retry automatically. |
| `failed_terminal` | Content opportunities could not be updated. |

## Dashboard behavior

The selected project dashboard fetches this read model independently of
development intelligence and daily summaries. A read failure is isolated to
the opportunity panel. The panel explains not-started, queued/running,
successful-empty, suppressed-empty, retryable failure, and terminal failure
states; current recommendations remain visible during reprocessing.
Reason-code, opportunity-type, and format labels are exhaustive static
presentation maps. The panel does not offer accept/dismiss actions in Task 3.7.

| Dashboard state | User-facing empty state |
| --- | --- |
| No processing run | Content recommendations have not been generated yet. |
| Queued or running, no cards | Analyzing recent development activity for share-worthy updates. |
| Succeeded with zero candidates | No content opportunity was detected from the current development activity. |
| Succeeded with candidates but zero recommendations | Development activity was analyzed, but nothing currently meets the recommendation threshold. |
| Retryable failure | Content opportunity analysis is temporarily delayed and will retry automatically; show retry time when available. |
| Terminal failure | Content opportunities could not be updated. |

## Read-only boundary and privacy

The read endpoint performs three fixed database reads (owner-scoped project,
opportunity page, current-version run) plus bounded, selected relations. Each
page loads at most the requested number of cards plus one look-ahead row; each
card loads at most 20 selected events and 11 reason signals, and each signal
loads at most 20 event links. It does not enqueue runs, call AI providers, score
opportunities, sync GitHub, or mutate persisted state. It returns only the
selected event title, type, and occurrence time needed to explain an
opportunity; raw repository evidence and unrelated development events are not
included.

Task 3.7 adds no feedback controls, drafts, publishing, or Phase 4 actions.
Task 3.3-3.6 persistence and processing semantics are unchanged.
