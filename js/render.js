import { escapeHtml } from "./html.js";
import {
  TAXONOMY,
  analyzeDependencies,
  filterHierarchy,
  hierarchyCounts,
  hierarchyTabs,
  matchesFilters,
  placeDependencies,
  statusLabel,
} from "./model.js";
import { sanitizeGithubHtml } from "./sanitize.js";

const BACK_LABEL = {
  dashboard: "Dashboard",
  hierarchy: "Hierarchy",
  critical: "Critical path",
};

export function renderSignedOut({ owner, repo, error = "", insecure = false }) {
  return `
    <div class="gate">
      <header class="topbar">
        <div class="brand">
          <span class="mark" aria-hidden="true">ID</span>
          <div>
            <strong>Issues dashboard</strong>
            <small>Private preview · no issues stored in this site</small>
          </div>
        </div>
      </header>
      <main class="gate-main">
        <section class="card-panel">
          <p class="eyebrow">Sign in to load issues</p>
          <h1>Nothing is fetched until you sign in.</h1>
          <p>This site ships with zero issues. After you sign in it reads and updates issues in the GitHub repository you name, using that repository as the only data store.</p>
          ${insecure ? '<p class="banner bad">This page is not on localhost and is not HTTPS. A token entered here can be read on the network.</p>' : ""}
          <p id="form-error" class="banner bad" ${error ? "" : "hidden"}>${escapeHtml(error)}</p>
          <form id="sign-in" autocomplete="off">
            <label for="owner">Repository owner</label>
            <input id="owner" name="owner" value="${escapeHtml(owner)}" autocomplete="off" spellcheck="false" required>
            <label for="repo">Repository name</label>
            <input id="repo" name="repo" value="${escapeHtml(repo)}" autocomplete="off" spellcheck="false" required>
            <label for="token">Fine-grained personal access token</label>
            <input id="token" name="token" type="password" autocomplete="off" spellcheck="false" required>
            <button type="button" data-action="sign-in">Sign in and load issues</button>
          </form>
          <div class="help">
            <h2>Token</h2>
            <p>The token stays in <code>sessionStorage</code> for this tab. Sign out removes it. Closing the tab removes it. It is sent only to <code>api.github.com</code>.</p>
            <ol>
              <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Fine-grained tokens</a> and generate a token. A typical token starts with <code>github_pat_</code>.</li>
              <li>Resource owner: the account that owns the repository.</li>
              <li>Repository access: only this repository.</li>
              <li>Permissions: <strong>Issues: Read and write</strong>. <strong>Metadata: Read</strong> is added automatically. No other permission is required.</li>
            </ol>
            <p>After sign-in you get a dashboard, a parent/sub-issue tree, a blocked-by graph, and an issue page with comments and Approve / Reject.</p>
          </div>
        </section>
      </main>
    </div>
  `;
}

export function renderLoading({ owner, repo }) {
  return `
    <div class="gate">
      ${renderTop({ owner, repo, login: null, showActions: true })}
      <main class="gate-main">
        <section class="card-panel">
          <h1>Loading issues from GitHub</h1>
          <p>Reading ${escapeHtml(owner)}/${escapeHtml(repo)}. This site still stores no issue data of its own.</p>
        </section>
      </main>
    </div>
  `;
}

export function renderLoadError({ owner, repo, message }) {
  return `
    <div class="gate">
      ${renderTop({ owner, repo, login: null, showActions: true })}
      <main class="gate-main">
        <section class="card-panel">
          <h1>GitHub did not return issues</h1>
          <p class="banner bad">${escapeHtml(message)}</p>
          <p>No issue list is shown. Try again repeats the request with the token already in this tab. Sign out clears that token.</p>
          <div class="row-actions">
            <button type="button" data-action="refresh">Try again</button>
            <button type="button" class="ghost" data-action="sign-out">Sign out</button>
          </div>
        </section>
      </main>
    </div>
  `;
}

export function renderShell({
  login,
  owner,
  repo,
  remaining,
  route,
  lastList,
  warnings = [],
  error = "",
  insecure = false,
  mainHtml,
}) {
  const active = route.name === "issue" ? lastList : route.name;
  const nav = [
    ["dashboard", "Dashboard", "#/dashboard"],
    ["hierarchy", "Hierarchy", "#/hierarchy"],
    ["critical", "Critical path", "#/critical"],
  ].map(([id, label, href]) => (
    `<a href="${href}" ${active === id ? 'aria-current="page"' : ""}>${label}</a>`
  )).join("");
  return `
    <div class="shell">
      ${renderTop({ owner, repo, login, showActions: true, remaining })}
      <div class="subbar">
        <nav aria-label="Views">${nav}</nav>
      </div>
      <main id="main">
        ${insecure ? '<p class="banner bad">This page is not on localhost and is not HTTPS. The token can be read on the network.</p>' : ""}
        ${error ? `<p class="banner bad">${escapeHtml(error)}</p>` : ""}
        ${warnings.map((warning) => `<p class="banner warn">${escapeHtml(warning)}</p>`).join("")}
        ${mainHtml}
      </main>
    </div>
  `;
}

function renderTop({ owner, repo, login, showActions, remaining }) {
  const who = login ? `Signed in as @${escapeHtml(login)}` : "Signed in";
  return `
    <header class="topbar">
      <div class="brand">
        <span class="mark" aria-hidden="true">ID</span>
        <div>
          <strong>Issues dashboard</strong>
          <small>${escapeHtml(owner)}/${escapeHtml(repo)}</small>
        </div>
      </div>
      ${showActions ? `
        <div class="session">
          <span>${who}</span>
          ${remaining != null ? `<span class="quiet">API remaining ${escapeHtml(remaining)}</span>` : ""}
          <button type="button" class="ghost" data-action="refresh">Refresh</button>
          <button type="button" data-action="sign-out">Sign out</button>
        </div>
      ` : ""}
    </header>
  `;
}

export function renderDashboard({ issues, filters, layout }) {
  const typeChips = chips("types", TAXONOMY.types, filters.types);
  const areaChips = chips("areas", TAXONOMY.areas, filters.areas);
  const severityChips = chips("severities", TAXONOMY.severities, filters.severities);
  const statusChips = chips("statuses", TAXONOMY.statuses, filters.statuses);
  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Dashboard</h1>
          <p>Issues and improvements in one list. Status is Closed, then Approved or Rejected, then Blocked, then In progress, otherwise Open.</p>
        </div>
        <div class="layout-toggle" role="group" aria-label="Layout">
          <button type="button" data-action="layout" data-layout="list" aria-pressed="${layout === "list"}">List</button>
          <button type="button" data-action="layout" data-layout="board" aria-pressed="${layout === "board"}">Board</button>
        </div>
      </div>
      <div class="filters">
        <label class="search" for="search">Search</label>
        <input id="search" type="search" value="${escapeHtml(filters.q)}" placeholder="Search title, body, or label. A bare number matches that issue.">
        <div class="facet"><span>Type</span><div role="group" aria-label="Type">${typeChips}</div></div>
        <div class="facet"><span>Area</span><div role="group" aria-label="Area">${areaChips}</div></div>
        <div class="facet"><span>Severity</span><div role="group" aria-label="Severity">${severityChips}</div></div>
        <div class="facet"><span>Status</span><div role="group" aria-label="Status">${statusChips}</div></div>
        <button type="button" class="ghost" data-action="clear-filters">Clear filters</button>
      </div>
      <div id="results">${renderIssueResults(issues, filters, layout)}</div>
    </section>
  `;
}

export function renderIssueResults(issues, filters, layout) {
  const shown = issues.filter((issue) => matchesFilters(issue, filters));
  const count = `<p id="result-count">${shown.length} of ${issues.length} shown</p>`;
  if (!issues.length) {
    return `${count}<div class="empty"><p>No issues in this repository yet.</p><p>Run <code>scripts/seed.mjs</code> to add placeholder issues. Seeded titles start with <code>[Example]</code>.</p></div>`;
  }
  if (!shown.length) {
    return `${count}<div class="empty"><p>No issues match these filters.</p></div>`;
  }
  const body = layout === "board" ? renderBoard(shown) : renderList(shown);
  return count + body;
}

export function renderHierarchy(issues, areaSlug = "all") {
  const filter = filterHierarchy(issues, areaSlug);
  const counts = hierarchyCounts(issues);
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const cycles = filter.slug === "all"
    ? filter.tree.cycles.map((cycle) => (
      `<p class="banner warn" data-cycle="${cycle.nodes.join(",")}">Parent cycle: ${cycleText(cycle.nodes)}</p>`
    )).join("")
    : "";
  const roots = filter.tree.roots.filter((number) => filter.visible.has(number));
  const nodes = roots.map((number) => renderTreeNode(filter, byNumber, number, 0, new Set())).join("");
  const tabs = hierarchyTabs().map((tab) => {
    const current = tab.slug === filter.slug;
    const href = tab.slug === "all" ? "#/hierarchy" : `#/hierarchy/${tab.slug}`;
    const count = counts[tab.slug] ?? 0;
    return `<a href="${href}" data-hierarchy-area="${tab.slug}" ${current ? 'aria-current="page"' : ""}>${escapeHtml(tab.label)} <span class="count">${count}</span></a>`;
  }).join("");
  let body;
  if (!issues.length) {
    body = '<div class="empty"><p>No issues to arrange.</p></div>';
  } else if (filter.directCount === 0) {
    body = `<div class="empty" data-empty-area="${escapeHtml(filter.slug)}"><p>No ${escapeHtml(filter.area)} issues yet.</p><p>An issue appears on this tab when it has the <code>area:${escapeHtml(filter.area)}</code> label. Parents stay in the tree when a child has the label.</p></div>`;
  } else {
    const note = filter.slug === "all"
      ? ""
      : `<p class="quiet">${filter.directCount} with <code>area:${escapeHtml(filter.area)}</code>. Dimmed rows are ancestors that do not have this area.</p>`;
    body = `${note}${cycles || (filter.slug === "all" ? '<p class="quiet">No parent cycles.</p>' : "")}<ol class="tree">${nodes}</ol>`;
  }
  const summary = filter.slug === "all"
    ? `${issues.length} issues, ${filter.tree.roots.length} at the root. Dashboard filters do not hide this tree.`
    : "A row stays when it, or a child below it, has this area. Ancestors without the area are dimmed.";
  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Hierarchy</h1>
          <p>Parent and sub-issue links from GitHub's sub-issues API. ${summary}</p>
        </div>
      </div>
      <div class="subtabs" role="tablist" aria-label="Areas">${tabs}</div>
      ${body}
    </section>
  `;
}

export function renderCritical(issues) {
  const analysis = analyzeDependencies(issues);
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const layout = placeDependencies(issues, analysis);
  const cycleHtml = analysis.cycles.length
    ? analysis.cycles.map((cycle) => (
      `<p class="banner warn" data-cycle="${cycle.nodes.join(",")}">Cycle: ${cycleText(cycle.nodes)}</p>`
    )).join("")
    : '<p class="quiet">No cycles.</p>';
  const chains = analysis.chains || (analysis.chain.length ? [analysis.chain] : []);
  const chainHtml = chains.length
    ? `<p class="quiet" data-chain-count="${chains.length}">${chainSummary(chains)}</p><ol class="chain-list">${chains.map((path) => `
        <li><ol class="chain" data-chain="${path.join(",")}">${path.map((number, index) => {
          const issue = byNumber.get(number);
          const title = issue ? issue.title : "Not in the loaded list";
          return `<li data-chain-step="${number}"><a href="#/issues/${number}">#${number} ${escapeHtml(title)}</a>${index < path.length - 1 ? '<span class="arrow-word">blocks</span>' : ""}</li>`;
        }).join("")}</ol></li>`).join("")}</ol>`
    : '<p class="empty">No open blocker chain. Nothing open is blocking another open issue.</p>';
  const approximate = analysis.approximate
    ? '<p class="banner warn">The chain search stopped early. The highlighted chain is the longest one found, and a longer one may exist.</p>'
    : "";
  const isolated = analysis.isolated.length
    ? `<h2>No dependency links</h2><ul class="plain">${analysis.isolated.map((number) => {
        const issue = byNumber.get(number);
        return `<li><a href="#/issues/${number}">#${number} ${escapeHtml(issue?.title || "")}</a></li>`;
      }).join("")}</ul>`
    : "";
  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Critical path</h1>
          <p>Built from GitHub blocked-by and blocking links. An arrow means the issue on the left blocks the issue on the right. The highlight is the longest chain of open issues. Closed blockers stay visible and do not extend that chain.</p>
        </div>
      </div>
      ${cycleHtml}
      ${approximate}
      <h2>${chains.length === 1 ? "Longest open chain" : "Longest open chains"}</h2>
      ${chainHtml}
      ${layout.nodes.length ? `<p class="quiet">Green marks every longest open chain. A dashed red arrow stays inside a cycle.</p><div class="graph-scroll">${renderGraph(layout, byNumber, analysis)}</div>` : ""}
      ${isolated}
    </section>
  `;
}

export function renderDetail({ issue, comments, loading, error, notice, pending, lastList, hierarchyArea = "all" }) {
  const back = listHref(lastList, hierarchyArea);
  if (!issue) {
    return `
      <section class="view">
        <h1>Issue not in the loaded list</h1>
        <p>Refresh to read the repository again.</p>
        <p><a href="${back}">Back to ${escapeHtml(BACK_LABEL[lastList] || "Dashboard")}</a></p>
      </section>
    `;
  }
  const github = safeHttps(issue.url);
  const body = renderedBody(issue.bodyHtml, issue.body);
  const commentHtml = loading
    ? '<p>Loading comments…</p>'
    : (comments.length
      ? `<ol class="comments">${comments.map(renderComment).join("")}</ol>`
      : '<p class="quiet">No comments yet.</p>');
  const disabled = pending ? "disabled" : "";
  return `
    <article class="detail">
      <p class="back"><a href="${back}">Back to ${escapeHtml(BACK_LABEL[lastList] || "Dashboard")}</a></p>
      <header class="detail-head">
        <p class="eyebrow">#${issue.number}</p>
        <h1>${escapeHtml(issue.title)}</h1>
        <div class="pills">${pills(issue)}</div>
      </header>
      <div class="detail-grid">
        <div>
          <div role="status">
            ${notice ? `<p class="banner ok">${escapeHtml(notice)}</p>` : ""}
            ${error ? `<p class="banner bad">${escapeHtml(error)}</p>` : ""}
          </div>
          <div class="markdown">${body}</div>
          <section class="thread">
            <h2>Comments</h2>
            ${commentHtml}
            <label for="comment-body">New comment</label>
            <textarea id="comment-body" ${disabled}></textarea>
            <button type="button" data-action="comment" ${disabled}>Post comment</button>
          </section>
        </div>
        <aside>
          <section>
            <h2>Details</h2>
            <dl>
              <div><dt>State</dt><dd>${escapeHtml(issue.state)}</dd></div>
              <div><dt>Status</dt><dd>${escapeHtml(statusLabel(issue.status))}</dd></div>
              <div><dt>Issue id</dt><dd>${issue.id == null ? "Unavailable" : escapeHtml(issue.id)}</dd></div>
              <div><dt>Author</dt><dd>${issue.author ? `@${escapeHtml(issue.author)}` : "Unknown"}</dd></div>
              <div><dt>Assignees</dt><dd>${issue.assignees.length ? issue.assignees.map((name) => `@${escapeHtml(name)}`).join(", ") : "Unassigned"}</dd></div>
              <div><dt>Updated</dt><dd><time datetime="${escapeHtml(issue.updatedAt)}">${escapeHtml(formatTime(issue.updatedAt))}</time></dd></div>
              <div><dt>On GitHub</dt><dd>${github ? `<a href="${escapeHtml(github)}" target="_blank" rel="noopener noreferrer">Open #${issue.number}</a>` : "No link"}</dd></div>
            </dl>
            <p class="quiet">REST blocked-by and sub-issue calls use the issue id, not the issue number.</p>
          </section>
          <section>
            <h2>Labels</h2>
            <div class="label-row">${issue.labels.length ? issue.labels.map(labelChip).join("") : '<span class="quiet">None</span>'}</div>
          </section>
          <section>
            <h2>Parent</h2>
            ${linkOrNone(issue.parent)}
            <h2>Sub-issues</h2>
            ${linkList(issue.subIssues)}
            <h2>Blocked by</h2>
            ${linkList(issue.blockedBy)}
            <h2>Blocking</h2>
            ${linkList(issue.blocking)}
          </section>
          <section class="decision">
            <h2>Decision</h2>
            <p>Current: <strong>${escapeHtml(decisionText(issue.decision))}</strong></p>
            <p class="quiet">Approve adds <code>decision:approved</code> and <code>status:approved</code>, removes <code>decision:rejected</code> and any other status label, and posts a comment. Reject does the opposite. Other labels stay as they are.</p>
            <label for="decision-note">Optional note</label>
            <textarea id="decision-note" ${disabled}></textarea>
            <div class="row-actions">
              <button type="button" data-action="decide" data-decision="approved" ${disabled}>Approve</button>
              <button type="button" class="danger" data-action="decide" data-decision="rejected" ${disabled}>Reject</button>
            </div>
          </section>
        </aside>
      </div>
    </article>
  `;
}

export function paintLabels(root) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll("[data-color]")) {
    const hex = el.getAttribute("data-color") || "";
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) continue;
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    el.style.backgroundColor = `#${hex}`;
    el.style.color = (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#1e1b16" : "#fffdf8";
  }
}

function renderList(issues) {
  const head = ["#", "Title", "Type", "Area", "Severity", "Status", "Updated"].map((label) => `<span>${label}</span>`).join("");
  const rows = issues.map((issue) => `
    <a class="row" href="#/issues/${issue.number}">
      <span class="num">#${issue.number}</span>
      <span class="title-cell"><strong>${escapeHtml(issue.title)}</strong><small>${escapeHtml(snippet(issue.body))}</small>${relationNote(issue)}</span>
      <span>${escapeHtml(issue.types.join(", ") || "—")}</span>
      <span>${escapeHtml(issue.areas.join(", ") || "—")}</span>
      <span>${issue.severity ? `<span class="pill pill-${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)}</span>` : "—"}</span>
      <span><span class="pill pill-${escapeHtml(issue.status)}">${escapeHtml(statusLabel(issue.status))}</span></span>
      <span class="when">${escapeHtml(formatTime(issue.updatedAt))}</span>
    </a>
  `).join("");
  return `<div class="list"><div class="list-head">${head}</div>${rows}</div>`;
}

function renderBoard(issues) {
  const columns = TAXONOMY.statuses.map((status) => {
    const items = issues.filter((issue) => issue.status === status.id);
    const cards = items.length
      ? items.map((issue) => `
          <a class="card" href="#/issues/${issue.number}">
            <span class="num">#${issue.number}</span>
            <strong>${escapeHtml(issue.title)}</strong>
            <span class="pills">${pills(issue)}</span>
            <small>${escapeHtml(snippet(issue.body))}</small>
            ${relationNote(issue)}
          </a>
        `).join("")
      : '<p class="empty-col">None</p>';
    return `<section class="column column-${status.id}" data-status="${status.id}"><h2>${escapeHtml(status.label)} <span>${items.length}</span></h2>${cards}</section>`;
  }).join("");
  return `<div class="board">${columns}</div>`;
}

function renderTreeNode(filter, byNumber, number, depth, ancestors) {
  if (!filter.visible.has(number)) return "";
  if (ancestors.has(number)) {
    return `<li class="repeat" data-number="${number}" data-depth="${depth}">#${number} repeats a parent already on this path</li>`;
  }
  const next = new Set(ancestors);
  next.add(number);
  const issue = byNumber.get(number);
  const dim = filter.slug !== "all" && !filter.direct.has(number);
  const kids = (filter.tree.children.get(number) || []).filter((child) => filter.visible.has(child));
  const row = issue
    ? `<a href="#/issues/${issue.number}"><span class="num">#${issue.number}</span> ${escapeHtml(issue.title)}</a> <span class="pills">${pills(issue)}</span>`
    : `<a href="#/issues/${number}">#${number}</a> <span class="quiet">not in the loaded list</span>`;
  const nested = kids.length
    ? `<ol class="tree">${kids.map((child) => renderTreeNode(filter, byNumber, child, depth + 1, next)).join("")}</ol>`
    : "";
  const dimAttr = dim ? ' data-dim="true"' : "";
  return `<li data-number="${number}" data-depth="${depth}"${dimAttr}><div class="tree-row${dim ? " dim" : ""}">${row}</div>${nested}</li>`;
}

function listHref(lastList, hierarchyArea) {
  if (lastList === "hierarchy" && hierarchyArea && hierarchyArea !== "all") return `#/hierarchy/${hierarchyArea}`;
  return `#/${lastList || "dashboard"}`;
}

function renderGraph(layout, byNumber, analysis) {
  const chain = new Set((analysis.chains || [analysis.chain]).flat());
  const paths = layout.edges.map((edge) => {
    const klass = edge.chain ? "edge chain" : edge.cycle ? "edge cycle" : "edge";
    return `<path class="${klass}" d="${edgePath(layout, edge)}" marker-end="url(#arrow)"></path>`;
  }).join("");
  const nodes = layout.nodes.map((node) => {
    const issue = byNumber.get(node.number);
    const title = issue?.title || "Not in the loaded list";
    const meta = issue ? `${issue.state}${issue.severity ? ` · ${issue.severity}` : ""}` : "outside this page";
    const shape = chain.has(node.number) ? "node-shape chain" : "node-shape";
    return `
      <g data-action="open-issue" data-issue="${node.number}" transform="translate(${node.x} ${node.y})">
        <title>#${node.number} ${escapeHtml(title)}</title>
        <rect class="${shape}" width="${layout.nodeWidth}" height="${layout.nodeHeight}" rx="8"></rect>
        <text class="node-num" x="12" y="24">#${node.number}</text>
        <text class="node-meta" x="48" y="24">${escapeHtml(meta)}</text>
        <text class="node-title" x="12" y="44">${escapeHtml(shorten(title, 22))}</text>
      </g>
    `;
  }).join("");
  return `
    <svg viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="Dependency graph">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6" class="arrow-head"></path>
        </marker>
      </defs>
      ${paths}
      ${nodes}
    </svg>
  `;
}

function edgePath(layout, edge) {
  const from = layout.nodes.find((node) => node.number === edge.blocker);
  const to = layout.nodes.find((node) => node.number === edge.blocked);
  const x1 = from.x + layout.nodeWidth;
  const y1 = from.y + layout.nodeHeight / 2;
  const x2 = to.x;
  const y2 = to.y + layout.nodeHeight / 2;
  if (to.column <= from.column) {
    const dip = Math.max(from.y, to.y) + layout.nodeHeight + 28;
    return `M ${x1 - 24} ${y1} C ${x1 + 36} ${dip}, ${x2 - 36} ${dip}, ${x2 + 16} ${y2}`;
  }
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function renderComment(comment) {
  const who = comment.author ? `@${escapeHtml(comment.author)}` : "Unknown";
  return `
    <li>
      <header><span>${who}</span> <time datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(formatTime(comment.createdAt))}</time></header>
      <div class="markdown">${renderedBody(comment.bodyHtml, "")}</div>
    </li>
  `;
}

function chips(group, options, selected) {
  const allOn = selected.size === 0;
  const all = `<button type="button" class="chip${allOn ? " on" : ""}" data-action="filter" data-group="${group}" data-value="" aria-pressed="${allOn}">All</button>`;
  const rest = options.map((option) => {
    const on = selected.has(option.id);
    return `<button type="button" class="chip${on ? " on" : ""}" data-action="filter" data-group="${group}" data-value="${escapeHtml(option.id)}" aria-pressed="${on}">${escapeHtml(option.label)}</button>`;
  }).join("");
  return all + rest;
}

function pills(issue) {
  const parts = [];
  for (const type of issue.types) parts.push(`<span class="pill pill-${escapeHtml(type)}">${escapeHtml(type)}</span>`);
  for (const area of issue.areas) parts.push(`<span class="pill">${escapeHtml(area)}</span>`);
  if (issue.severity) parts.push(`<span class="pill pill-${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)}</span>`);
  parts.push(`<span class="pill pill-${escapeHtml(issue.status)}">${escapeHtml(statusLabel(issue.status))}</span>`);
  if (issue.decision) parts.push(`<span class="pill pill-${escapeHtml(issue.decision)}">${escapeHtml(issue.decision)}</span>`);
  return parts.join("");
}

function labelChip(label) {
  const color = /^[0-9a-fA-F]{6}$/.test(label.color || "") ? label.color : "";
  const attr = color ? ` data-color="${color}"` : "";
  return `<span class="label"${attr}>${escapeHtml(label.name)}</span>`;
}

function linkOrNone(item) {
  if (!item) return '<p class="quiet">None</p>';
  return `<p><a href="#/issues/${item.number}">#${item.number} ${escapeHtml(item.title || "")}</a></p>`;
}

function linkList(items) {
  if (!items?.length) return '<p class="quiet">None</p>';
  return `<ul class="plain">${items.map((item) => `<li><a href="#/issues/${item.number}">#${item.number} ${escapeHtml(item.title || "")}</a></li>`).join("")}</ul>`;
}

function relationNote(issue) {
  const parts = [];
  if (issue.blockedBy.length) parts.push(`blocked by ${issue.blockedBy.length}`);
  if (issue.blocking.length) parts.push(`blocking ${issue.blocking.length}`);
  if (!parts.length) return "";
  return `<span class="rel">${parts.join(" · ")}</span>`;
}

function renderedBody(html, fallback) {
  const safe = sanitizeGithubHtml(html);
  if (safe.trim()) return safe;
  return `<pre>${escapeHtml(fallback || "No description.")}</pre>`;
}

function snippet(body) {
  const text = String(body || "")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

function shorten(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function chainSummary(chains) {
  const count = chains.length;
  const length = chains[0].length;
  const chainWord = count === 1 ? "chain" : "chains";
  const issueWord = length === 1 ? "issue" : "issues";
  return `${count} longest ${chainWord}, ${length} ${issueWord}${count === 1 ? "" : " each"}`;
}

function cycleText(nodes) {
  if (nodes.length === 1) return `#${nodes[0]} → #${nodes[0]}`;
  return [...nodes, nodes[0]].map((number) => `#${number}`).join(" → ");
}

function decisionText(decision) {
  if (decision === "approved") return "Approved";
  if (decision === "rejected") return "Rejected";
  if (decision === "conflict") return "Approved and rejected are both set";
  return "None";
}

function safeHttps(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}
