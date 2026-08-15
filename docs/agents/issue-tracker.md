# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- When a workflow needs status, record it as a `Status:` line near the top of the issue file
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or issue number directly.

## Wayfinding operations

- **Map**: `.scratch/<effort>/map.md` — Notes, Decisions-so-far, and Fog.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`; `Type:` is `research`, `prototype`, `grilling`, or `task`; `Status:` is `claimed` or `resolved`.
- **Blocking**: `Blocked by: NN, NN` near the top. A ticket is unblocked when all listed tickets are resolved.
- **Frontier**: scan `.scratch/<effort>/issues/` for open, unblocked, unclaimed tickets; first by number wins.
- **Claim**: set `Status: claimed` before work.
- **Resolve**: append an `## Answer`, set `Status: resolved`, and link its gist in the map’s Decisions-so-far section.
