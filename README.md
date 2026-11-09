# issues-dashboard-site

Static site code for the issues dashboard. Holds no issue data; issues load from a private repo only after token sign-in.

The files in this repository are the site. There is no install step and no build step. GitHub Pages serves the `main` branch from the repository root. An empty `.nojekyll` file is included so Pages publishes the files as-is.

After you sign in, the site reads and updates GitHub Issues in the repository you name. The default repository is `bbops-tw/issues-dashboard`.

Placeholder issues in that repository, when present, are labeled EXAMPLE DATA and use titles that start with `[Example]`. This site does not include those issues.

## Open the site locally

From this directory:

```bash
python3 -m http.server 4173
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/).

Or, if you prefer a small static server:

```bash
npx --yes serve .
```

Serve the directory as-is. Do not put a token in the files.

## Sign in

The first screen is empty of issues. Enter the repository owner, the repository name, and a fine-grained personal access token, then choose **Sign in and load issues**.

The token is kept in `sessionStorage` for this tab only. It is not written to `localStorage`, and it is not sent anywhere except `https://api.github.com`. **Sign out** removes it. Closing the tab removes it. Owner and repository name are remembered in `localStorage` so you do not retype them. A refresh in the same tab loads issues again.

The owner and name fields accept letters, numbers, dots, underscores, and hyphens. The API host is fixed to `api.github.com`.

While you are signed out, every view stays on the sign-in screen. No issue request is made.

## Create the token

1. Open [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens/new).
2. Name the token and set an expiration. A token from this page starts with `github_pat_`.
3. Resource owner: the account that owns the repository (`bbops-tw` for the default).
4. Repository access: **Only select repositories**, then choose that repository.
5. Repository permissions:
   - **Issues: Read and write**
   - **Metadata: Read** (GitHub selects this automatically)
6. Generate the token and paste it into the sign-in form.

No Contents, Administration, or Pull requests permission is required. Do not commit the token. Do not pass it as a command argument.

## What the views do

- **Dashboard.** Issues and improvements in one list or board. Filter by type (`type:issue`, `type:improvement`), area (`area:Case`, `area:Gearbox`, `area:Battery`, `area:Electronics`, `area:QA`, `area:Decision`), severity (`severity:critical`, `severity:high`, `severity:medium`, `severity:low`), status, and text.
- **Hierarchy.** Parent and sub-issue tree from GitHub's sub-issues API.
- **Critical path.** Blocked-by / blocking graph from GitHub's issue dependencies. The highlight is the longest chain of open blockers. Cycles are flagged.
- **Issue.** Rendered body, labels, status, assignees, parent, sub-issues, blocked-by, blocking, Approve / Reject, and comments.

Status is the GitHub open/closed state plus the labels `status:in-progress` and `status:blocked`. Approve adds `decision:approved`, removes `decision:rejected`, and posts a comment. Reject does the opposite. The rules for agents are in [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Private repository tooling

Seeding labels and placeholder issues is not part of this site. `labels.json`, `data/examples.json`, `scripts/seed.sh`, `scripts/seed.mjs`, and the offline tests live in the private repository `bbops-tw/issues-dashboard`. This site does not import that data. The signed-out page stays empty until a token sign-in.

## Open choices

- **Hosting.** GitHub Pages for this public repository uses the `main` branch and the root folder (`/`). There is no Actions deploy workflow and no build. The token is still entered in the browser and stays in `sessionStorage`.
- **OAuth versus a pasted token.** This site uses a fine-grained token in `sessionStorage`. OAuth, or a GitHub App, needs a small backend to hold the client secret and exchange the authorization code. That backend is not part of this site, and choosing it is open.
- **Label taxonomy.** The names in the private repository's `labels.json` are a starting set. Changing them means updating that file, `docs/CONVENTIONS.md`, and the filter lists in `js/model.js` together.
