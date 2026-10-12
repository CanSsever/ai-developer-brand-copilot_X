# Phase 3.9A — Evaluation Framework and Development Validation

## Scope

Task 3.9A provides a deterministic offline evaluation framework for the frozen
`phase3-opportunity-v1` development split only. It is not the final Phase 3 exit
evaluation. It does not call a provider, access the held-out scenarios, mutate a
database, generate a draft, or add Phase 4 behavior.

The executable default is scorer-only and conditional. It converts each frozen
development scenario into canonical Task 3.3 input, constructs an explicitly
oracle-backed validated Task 3.4 candidate shape from the frozen expectation,
and invokes the real `scorePhase3OpportunityCandidates` production function.
No Task 3.5 formula is copied into the evaluation producer.

This run measures deterministic Task 3.5 decisions and explanations assuming a
correct Task 3.4 candidate. Its visible precision may be reported as development
regression evidence, but it is not the Phase 3 final precision gate.

## Final detector-inclusive boundary

The final Phase 3 visible-opportunity precision gate must evaluate:

```text
Task 3.4 detector
  -> validated candidates
  -> Task 3.5 production scorer
  -> visible opportunity observation
```

The framework defines a detector-inclusive observation-producer interface that
returns the same frozen observation contract used by the existing deterministic
metrics. No detector-inclusive producer is instantiated or executed in Task
3.9A. Provider calls remain prohibited until the separately authorized release
evaluation.

## Development command and report

After the API build, run from the repository root:

```text
pnpm phase3:evaluate
```

The command has no split option and can execute only development scenarios
`001` through `080`. Unknown flags, including held-out/release flags, fail. JSON
is written to standard output by default. `--output <path>` may write a formal
artifact, using create-new semantics so an existing artifact is never silently
overwritten.

The versioned report contains corpus/rubric/contract identities and all five
pins, the current Git SHA when available, scoring version, exact scenario IDs,
metrics, explicit regression gates, failing scenario IDs, stable reason digests,
Task 3.8 evidence, an offline what/why projection, human-review status, and the
detector-exclusion limitation. It contains no provider payload, raw repository
evidence, credentials, generated UUID, mutable timestamp, or database state.

## Explanation determinism

Every visible development recommendation is scored twice from identical input.
The complete decisions must compare equal. A SHA-256 reason digest covers only:

- scoring version
- candidate key, opportunity type, topic key, and selected event IDs
- ordered reason code, effect, value/null, and ordered event IDs

Visible recommendations must have at least one approved reason, stable taxonomy
order, the correct effect, a bounded three-decimal value or null, and reason
event IDs contained in the opportunity provenance.

## Offline answer

One visible recommendation is projected as title/what, opportunity type,
recommended format, ordered structured reasons, and supporting DevelopmentEvent
references. This answers “What should I share and why?” without generating post
copy, creating a ContentDraft, or publishing anything.

## Human review and final exit

Held-out human review is stored separately from the frozen corpus. The blank
manifest binds future review evidence to the corpus version and held-out digest
without claiming any review completion. Its validator requires:

- all failing held-out samples to have completed second review
- at least `ceil(20% * passing samples)` passing samples to have completed review
- every disagreement to contain an adjudicated expectation
- exactly the frozen held-out IDs and fingerprint

An incomplete manifest makes final exit ineligible. Task 3.9A always reports
final detector-inclusive precision and final Phase 3 exit as false.

## Feedback persistence evidence

Task 3.8 is not reimplemented. The framework records its delivery evidence:

- commit `7518d396b94c8b80cf0363c795d0840986e3edee`
- migration `20260925100000_add_opportunity_feedback`
- hosted CI #30 exact-SHA success
- existing API, database invariant, ownership, RLS, idempotency, concurrency,
  read-model, and dashboard tests

## Remaining Phase 3 exit work

Before Task 3.9 and Phase 3 can complete, a release candidate must be frozen, a
detector-inclusive held-out evaluation must be explicitly authorized and run,
all required human second review/adjudication must be recorded, the final report
must pass the PDR gates, and hosted CI must succeed. Held-out failures must not be
used for tuning the frozen release candidate.
