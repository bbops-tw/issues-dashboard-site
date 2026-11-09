# Issue conventions

GitHub Issues in this repository are the system of record. The dashboard is a static site that reads and writes those issues. It does not keep a second database.

Placeholder content uses the title prefix `[Example]` and the words `EXAMPLE DATA` in the body. Do not treat those issues as real records.

Pull requests are out of scope. The dashboard reads `repository.issues` in GraphQL, which does not return pull requests. The REST issues list does return pull requests; skip any object that has a `pull_request` field.

The API host is `https://api.github.com`. Send these headers:

```text
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
```

Label name, color, and description live in `labels.json` in the private repository `bbops-tw/issues-dashboard`. That file is not in this site repository. If this document and that file disagree, change this document to match the file, then update `js/model.js` if the dashboard lists that label in a filter.

## Labels

An issue should have one type, one area, and one severity. The dashboard still shows an issue that breaks that rule.

| Label | Meaning |
| --- | --- |
| `type:issue` | A defect or problem to fix. |
| `type:improvement` | An improvement that is not a defect. |
| `area:Case` | Case area. |
| `area:Gearbox` | Gearbox area. |
| `area:Battery` | Battery area. |
| `area:Electronics` | Electronics area. |
| `area:QA` | QA area. |
| `area:Decision` | A decision other work may wait on. |
| `severity:critical` | Highest severity. |
| `severity:high` | High severity. |
| `severity:medium` | Medium severity. |
| `severity:low` | Low severity. |
| `status:in-progress` | Someone is actively working this open issue. |
| `status:blocked` | This open issue cannot move yet. |
| `decision:approved` | The decision is approved. |
| `decision:rejected` | The decision is rejected. |

Do not invent label names. Do not encode status, parent links, or dependencies in the title.

Colors and descriptions live in `labels.json` in the private repository `bbops-tw/issues-dashboard`. The seed script in that repository creates a missing label and updates color and description when the label already exists. It does not rename labels. Neither `labels.json` nor the seed script is part of this site.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/labels" \
  -d '{"name":"type:issue","color":"b60205","description":"Defect or problem to fix."}'
```

Replace an issue's whole label set only when you mean to. Adding one label does not remove the others:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER/labels" \
  -d '{"labels":["status:in-progress"]}'
```

```bash
gh issue edit ISSUE_NUMBER --repo "$OWNER/$REPO" --add-label "status:in-progress" --remove-label "status:blocked"
```

If a label name with a colon 404s in a URL, percent-encode the colon (`status%3Ablocked`).

## Status

Two different facts exist:

1. GitHub issue state is `open` or `closed`. This is the source of truth for done versus not done.
2. While the issue is open, an optional status label says how the work is moving.

Derived primary status, which is what the dashboard filters and the board columns use:

1. State `closed` → Closed. Status labels do not override this.
2. Else label `status:blocked` → Blocked.
3. Else label `status:in-progress` → In progress.
4. Else → Open.

If both status labels are present on an open issue, Blocked wins. Remove the one that does not apply. When you close an issue, remove both status labels.

A blocked-by dependency does not set `status:blocked`. Add that label only when you want the board to show the issue as Blocked. The critical path view reads dependencies, not this label.

Close and reopen:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER" \
  -d '{"state":"closed","state_reason":"completed"}'
```

Use `"state":"open"` to reopen. `state_reason` may be `completed`, `not_planned`, or `reopened` as appropriate.

## Decisions

`decision:approved` and `decision:rejected` are mutually exclusive. The label is the source of truth. A comment is the audit trail. If they disagree, trust the label and the latest decision comment.

To record a decision:

1. Add the chosen label.
2. Remove the opposite label if it is present. A 404 on remove means it was already absent.
3. Post a comment whose first line is exactly `**Decision recorded: approved**` or `**Decision recorded: rejected**`.

With a note:

```text
**Decision recorded: approved**

Note:

> First line of the note.
> Second line of the note.

_Recorded by @LOGIN via the issues dashboard._
```

Without a note, omit the `Note:` block and the blockquote:

```text
**Decision recorded: rejected**

_Recorded by @LOGIN via the issues dashboard._
```

Agents that know their login include the `Recorded by @LOGIN` line. Agents that do not, use `_Recorded via the issues dashboard._` instead. Do not put the decision only in the comment.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER/labels" \
  -d '{"labels":["decision:approved"]}'

curl -sS -X DELETE \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER/labels/decision:rejected"

curl -sS -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER/comments" \
  -d '{"body":"**Decision recorded: approved**\n\n_Recorded by @LOGIN via the issues dashboard._"}'
```

```bash
gh issue edit ISSUE_NUMBER --repo "$OWNER/$REPO" \
  --add-label "decision:approved" --remove-label "decision:rejected"
gh issue comment ISSUE_NUMBER --repo "$OWNER/$REPO" --body-file decision.md
```

Retrying after the label call succeeded and the comment call failed posts another comment. That is acceptable. Do not remove the label to "undo" a duplicate comment.

## Issue id versus issue number

The issue number is the `#12` shown in the UI and in `gh` commands. The issue id is the numeric `id` field on the REST issue object (GraphQL `databaseId`). Sub-issue and blocked-by REST bodies take the issue id. `gh` flags take the issue number or a URL.

```bash
gh api "repos/$OWNER/$REPO/issues/ISSUE_NUMBER" --jq .id
```

GraphQL node ids are a third identifier. `addBlockedBy` and `addSubIssue` take those node ids (`blockingIssueId`, `issueId`, `subIssueId`), not the REST numeric id and not the issue number.

## Sub-issues

Parent and child links use GitHub's native sub-issues. Do not encode them as a task list in the body. The body may mention the relationship in prose, but the API link is the source of truth.

An issue has at most one parent. GitHub allows nested sub-issues (the product limit is 8 levels and 100 children per parent). The dashboard shows whatever the API returns and flags a parent cycle if one appears.

`gh` uses issue numbers:

```bash
gh issue create --repo "$OWNER/$REPO" --title "[Example] Title" --body-file body.md --parent PARENT_NUMBER
gh issue edit PARENT_NUMBER --repo "$OWNER/$REPO" --add-sub-issue CHILD_NUMBER
gh issue edit CHILD_NUMBER --repo "$OWNER/$REPO" --remove-parent
gh issue view ISSUE_NUMBER --repo "$OWNER/$REPO" --json parent,subIssues
```

REST uses the child issue id:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/PARENT_NUMBER/sub_issues" \
  -d '{"sub_issue_id": CHILD_ISSUE_ID}'

curl -sS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/CHILD_NUMBER/parent"

curl -sS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/PARENT_NUMBER/sub_issues"
```

A parent request returns 404 when the issue has no parent.

GraphQL:

```graphql
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      parent { number title state }
      subIssues(first: 50) {
        nodes { number title state }
      }
    }
  }
}
```

```bash
gh api graphql -f owner="$OWNER" -f name="$REPO" -F number=1 -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        parent { number title state }
        subIssues(first: 50) { nodes { number title state } }
      }
    }
  }'
```

## Dependencies

Blocked-by and blocking use GitHub's native issue dependencies. Do not encode them as labels or as task-list items.

- `blocked-by`: issues that must be resolved before this issue.
- `blocking`: issues that this issue blocks.

The dashboard draws an arrow from the blocker to the blocked issue. The critical path is not stored. Do not add a label for it.

Rules the dashboard uses:

- The longest open chain is the longest simple path of issues whose state is `open`.
- Closed issues remain on the graph and do not extend that chain.
- If several open chains share that length, the view shows the one whose issue numbers are lowest at the first difference, and it says how many ties exist.
- A strongly connected component with more than one issue, or a self-loop, is a cycle. The view flags it. A cycle is not a valid critical path.
- GitHub may reject a new dependency that would create a cycle (HTTP 422). The seed script in the private repository `bbops-tw/issues-dashboard` tries one two-issue cycle and, if that run added the first half and the second half is rejected, deletes that first half. That script is not in this site repository.

`gh` uses issue numbers:

```bash
gh issue edit ISSUE_NUMBER --repo "$OWNER/$REPO" --add-blocked-by BLOCKER_NUMBER
gh issue edit ISSUE_NUMBER --repo "$OWNER/$REPO" --add-blocking OTHER_NUMBER
gh issue edit ISSUE_NUMBER --repo "$OWNER/$REPO" --remove-blocked-by BLOCKER_NUMBER
gh issue view ISSUE_NUMBER --repo "$OWNER/$REPO" --json blockedBy,blocking
```

REST uses the blocker issue id. This marks `ISSUE_NUMBER` as blocked by `BLOCKER_ISSUE_ID`:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER/dependencies/blocked_by" \
  -d '{"issue_id": BLOCKER_ISSUE_ID}'

curl -sS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER/dependencies/blocked_by"

curl -sS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER/dependencies/blocking"

curl -sS -X DELETE \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/ISSUE_NUMBER/dependencies/blocked_by/BLOCKER_ISSUE_ID"
```

GraphQL read, and the mutation that uses node ids:

```graphql
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      blockedBy(first: 50) { nodes { number title state } }
      blocking(first: 50) { nodes { number title state } }
    }
  }
}
```

```graphql
mutation($issueId: ID!, $blockingIssueId: ID!) {
  addBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) {
    issue { number }
    blockingIssue { number }
  }
}
```

## Creating an issue

```bash
gh issue create --repo "$OWNER/$REPO" \
  --title "[Example] Short title" \
  --body-file body.md \
  --label "type:issue,area:Case,severity:low"
```

Keep new placeholder titles prefixed with `[Example]`. Real work should not use that prefix.

## Seed script and example data

`scripts/seed.mjs`, `scripts/seed.sh`, `labels.json`, and `data/examples.json` live in the private repository `bbops-tw/issues-dashboard`. They are not in this site repository, and this site does not load them. Placeholder issues created there use the title prefix `[Example]`.

## Token

Use a fine-grained personal access token for this repository.

- Repository access: only this repository.
- Issues: Read and write.
- Metadata: Read.

Do not pass the token as a command argument. The dashboard sign-in form keeps the token in `sessionStorage` for the tab. Seed tooling in the private repository reads `GITHUB_TOKEN` from the environment. Optional for that tooling: `GITHUB_OWNER` and `GITHUB_REPO`, or `GITHUB_REPOSITORY=owner/repo`. Defaults are `bbops-tw` and `issues-dashboard`.

