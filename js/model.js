const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

export const TAXONOMY = {
  types: [
    { id: "issue", label: "Issue" },
    { id: "improvement", label: "Improvement" },
  ],
  areas: ["Case", "Gearbox", "Battery", "Electronics", "Software", "QA", "Decision"].map((id) => ({ id, label: id })),
  severities: SEVERITY_ORDER.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
  statuses: [
    { id: "open", label: "Open" },
    { id: "in-progress", label: "In progress" },
    { id: "blocked", label: "Blocked" },
    { id: "closed", label: "Closed" },
  ],
};

const NODE_W = 168;
const NODE_H = 58;
const COL_GAP = 40;
const ROW_GAP = 18;
const PAD = 12;
const SEARCH_BUDGET = 100000;

export function emptyFilters() {
  return {
    q: "",
    types: new Set(),
    areas: new Set(),
    severities: new Set(),
    statuses: new Set(),
  };
}

export function statusLabel(status) {
  return TAXONOMY.statuses.find((item) => item.id === status)?.label || status || "";
}

export function hierarchyTabs() {
  return [
    { slug: "all", label: "All" },
    ...TAXONOMY.areas.map((area) => ({ slug: area.id.toLowerCase(), label: area.label, area: area.id })),
  ];
}

export function parseRoute(hash) {
  const path = String(hash || "#/dashboard").replace(/^#/, "").replace(/^\//, "");
  const issueMatch = path.match(/^issues\/(\d+)$/);
  if (issueMatch) return { name: "issue", number: Number(issueMatch[1]) };
  const hierarchyMatch = path.match(/^hierarchy(?:\/([a-z0-9-]+))?$/);
  if (hierarchyMatch) {
    const slug = (hierarchyMatch[1] || "all").toLowerCase();
    const known = slug === "all" || TAXONOMY.areas.some((area) => area.id.toLowerCase() === slug);
    return { name: "hierarchy", area: known ? slug : "all" };
  }
  if (path === "critical" || path.startsWith("critical/")) return { name: "critical" };
  return { name: "dashboard" };
}

// An area tab keeps an issue when that issue, or any descendant, carries the
// area. Ancestors stay so the parent chain is still visible.
export function filterHierarchy(issues, slug) {
  const tree = buildHierarchy(issues);
  const tabs = hierarchyTabs();
  const tab = tabs.find((item) => item.slug === String(slug || "all").toLowerCase()) || tabs[0];
  const numbers = new Set();
  for (const issue of issues) numbers.add(issue.number);
  for (const root of tree.roots) numbers.add(root);
  for (const [parent, kids] of tree.children) {
    numbers.add(parent);
    for (const kid of kids) numbers.add(kid);
  }
  if (tab.slug === "all") {
    return {
      slug: "all",
      area: null,
      visible: numbers,
      direct: new Set(issues.map((issue) => issue.number)),
      directCount: issues.length,
      tree,
    };
  }
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const memo = new Map();
  const subtreeHas = (number, stack) => {
    if (memo.has(number)) return memo.get(number);
    if (stack.has(number)) return false;
    const next = new Set(stack);
    next.add(number);
    let hit = hasArea(byNumber.get(number), tab.area);
    for (const child of tree.children.get(number) || []) {
      if (subtreeHas(child, next)) hit = true;
    }
    memo.set(number, hit);
    return hit;
  };
  const visible = new Set();
  for (const number of numbers) {
    if (subtreeHas(number, new Set())) visible.add(number);
  }
  const direct = new Set(issues.filter((issue) => hasArea(issue, tab.area)).map((issue) => issue.number));
  return { slug: tab.slug, area: tab.area, visible, direct, directCount: direct.size, tree };
}

export function hierarchyCounts(issues) {
  const counts = { all: issues.length };
  for (const area of TAXONOMY.areas) {
    counts[area.id.toLowerCase()] = issues.filter((issue) => hasArea(issue, area.id)).length;
  }
  return counts;
}

function hasArea(issue, areaId) {
  if (!issue || !areaId) return false;
  const wanted = areaId.toLowerCase();
  return (issue.areas || []).some((area) => String(area).toLowerCase() === wanted);
}

// Primary status is derived for display and filtering. It is not a stored field.
// Closed wins, then the status:blocked label, then status:in-progress, otherwise Open.
export function deriveIssue(raw) {
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const names = labels.map((label) => label?.name).filter(Boolean);
  const types = unique(names.filter((name) => name.startsWith("type:")).map((name) => name.slice("type:".length)));
  const areas = unique(names.filter((name) => name.startsWith("area:")).map((name) => name.slice("area:".length)));
  const severities = unique(names.filter((name) => name.startsWith("severity:")).map((name) => name.slice("severity:".length)));
  const severity = SEVERITY_ORDER.find((level) => severities.includes(level)) || severities[0] || null;
  const state = String(raw.state || "").toLowerCase() === "closed" ? "closed" : "open";
  let status = "open";
  if (state === "closed") status = "closed";
  else if (names.includes("status:blocked")) status = "blocked";
  else if (names.includes("status:in-progress")) status = "in-progress";
  const decisions = unique(names.filter((name) => name.startsWith("decision:")).map((name) => name.slice("decision:".length)));
  let decision = null;
  if (decisions.includes("approved") && decisions.includes("rejected")) decision = "conflict";
  else if (decisions.includes("approved")) decision = "approved";
  else if (decisions.includes("rejected")) decision = "rejected";
  return {
    number: raw.number,
    id: raw.id ?? null,
    title: raw.title || "",
    state,
    body: raw.body || "",
    bodyHtml: raw.bodyHtml || "",
    createdAt: raw.createdAt || "",
    updatedAt: raw.updatedAt || "",
    url: raw.url || "",
    author: raw.author || null,
    assignees: Array.isArray(raw.assignees) ? raw.assignees : [],
    labels,
    commentCount: raw.commentCount ?? 0,
    parent: raw.parent || null,
    subIssues: Array.isArray(raw.subIssues) ? raw.subIssues : [],
    blockedBy: Array.isArray(raw.blockedBy) ? raw.blockedBy : [],
    blocking: Array.isArray(raw.blocking) ? raw.blocking : [],
    types,
    areas,
    severities,
    severity,
    status,
    decision,
  };
}

export function matchesFilters(issue, filters) {
  const q = String(filters.q || "").trim().toLowerCase();
  if (q) {
    const numberQuery = q.match(/^#?(\d+)$/);
    if (numberQuery) {
      if (String(issue.number) !== numberQuery[1]) return false;
    } else {
      const hay = [issue.title, issue.body, ...issue.labels.map((label) => label?.name || "")].join("\n").toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  if (filters.types.size && !issue.types.some((type) => filters.types.has(type))) return false;
  if (filters.areas.size) {
    const wanted = new Set([...filters.areas].map((area) => String(area).toLowerCase()));
    if (!issue.areas.some((area) => wanted.has(String(area).toLowerCase()))) return false;
  }
  if (filters.severities.size && !issue.severities.some((severity) => filters.severities.has(severity))) return false;
  if (filters.statuses.size && !filters.statuses.has(issue.status)) return false;
  return true;
}

export function decisionComment({ decision, note, login }) {
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("decision must be approved or rejected");
  }
  const lines = [`**Decision recorded: ${decision}**`, ""];
  const trimmed = String(note || "").trim();
  if (trimmed) {
    lines.push("Note:", "");
    for (const line of trimmed.split(/\r?\n/)) lines.push(`> ${line}`);
    lines.push("");
  }
  lines.push(login
    ? `_Recorded by @${String(login).replace(/^@/, "")} via the issues dashboard._`
    : "_Recorded via the issues dashboard._");
  return lines.join("\n");
}

export function buildHierarchy(issues) {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const children = new Map();
  const ensure = (parent) => {
    if (!children.has(parent)) children.set(parent, []);
    return children.get(parent);
  };
  for (const issue of issues) {
    const listed = unique((issue.subIssues || []).map((item) => item.number).filter((number) => number != null));
    if (listed.length) children.set(issue.number, listed);
  }
  for (const issue of issues) {
    if (issue.parent?.number == null) continue;
    const list = ensure(issue.parent.number);
    if (!list.includes(issue.number)) list.push(issue.number);
  }
  const childSet = new Set([...children.values()].flat());
  const roots = [];
  for (const issue of issues) {
    if (!childSet.has(issue.number)) roots.push(issue.number);
  }
  for (const parent of children.keys()) {
    if (!byNumber.has(parent) && !childSet.has(parent) && !roots.includes(parent)) roots.push(parent);
  }
  const seen = reachable(roots, children);
  for (const issue of issues) {
    if (seen.has(issue.number)) continue;
    roots.push(issue.number);
    for (const number of reachable([issue.number], children)) seen.add(number);
  }

  const parentNodes = new Set();
  const parentAdj = new Map();
  for (const [parent, list] of children) {
    parentNodes.add(parent);
    if (!parentAdj.has(parent)) parentAdj.set(parent, []);
    for (const child of list) {
      parentNodes.add(child);
      if (!parentAdj.has(child)) parentAdj.set(child, []);
      parentAdj.get(parent).push(child);
    }
  }
  const ordered = [...parentNodes].sort((a, b) => a - b);
  const { adj } = adjacency(ordered, [...parentAdj.entries()].flatMap(([blocker, list]) => (
    list.map((blocked) => ({ blocker, blocked }))
  )));
  const cycles = cyclicComponents(tarjan(ordered, adj), adj);
  return { roots, children, cycles };
}

// Edges point from the blocker to the issue it blocks.
// The highlighted chain is the longest simple path through open issues.
// Closed issues stay on the graph and do not extend that chain.
export function analyzeDependencies(issues) {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const edgeKeys = new Set();
  const edges = [];
  const addEdge = (blocker, blocked) => {
    if (blocker == null || blocked == null) return;
    const key = `${blocker}->${blocked}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ blocker, blocked });
  };
  for (const issue of issues) {
    for (const blocker of issue.blockedBy || []) addEdge(blocker.number, issue.number);
    for (const blocked of issue.blocking || []) addEdge(issue.number, blocked.number);
  }
  const numbers = new Set(issues.map((issue) => issue.number));
  for (const edge of edges) {
    numbers.add(edge.blocker);
    numbers.add(edge.blocked);
  }
  const ordered = [...numbers].sort((a, b) => a - b);
  const { adj } = adjacency(ordered, edges);
  const cycles = cyclicComponents(tarjan(ordered, adj), adj);
  const open = ordered.filter((number) => byNumber.get(number)?.state === "open");
  const openSet = new Set(open);
  const openAdj = new Map(open.map((number) => [
    number,
    (adj.get(number) || []).filter((next) => openSet.has(next)),
  ]));
  const { chain, ties, approximate } = longestChain(open, openAdj);
  const linked = new Set();
  for (const edge of edges) {
    linked.add(edge.blocker);
    linked.add(edge.blocked);
  }
  const isolated = issues.map((issue) => issue.number).filter((number) => !linked.has(number));
  return { edges, cycles, chain, ties, approximate, isolated };
}

export function placeDependencies(issues, analysis) {
  const numbers = new Set();
  for (const edge of analysis.edges) {
    numbers.add(edge.blocker);
    numbers.add(edge.blocked);
  }
  const ordered = [...numbers].sort((a, b) => a - b);
  if (!ordered.length) {
    return { nodes: [], edges: [], width: 0, height: 0, nodeWidth: NODE_W, nodeHeight: NODE_H };
  }
  const { adj } = adjacency(ordered, analysis.edges);
  const components = tarjan(ordered, adj);
  const sccId = new Map();
  components.forEach((component, id) => {
    for (const node of component) sccId.set(node, id);
  });
  const sccCount = components.length;
  const sccAdj = new Map(Array.from({ length: sccCount }, (_, id) => [id, new Set()]));
  const indeg = new Array(sccCount).fill(0);
  for (const edge of analysis.edges) {
    const from = sccId.get(edge.blocker);
    const to = sccId.get(edge.blocked);
    if (from === to || sccAdj.get(from).has(to)) continue;
    sccAdj.get(from).add(to);
    indeg[to] += 1;
  }
  const rank = new Array(sccCount).fill(0);
  const queue = [];
  for (let id = 0; id < sccCount; id += 1) if (indeg[id] === 0) queue.push(id);
  while (queue.length) {
    const current = queue.shift();
    for (const next of sccAdj.get(current)) {
      rank[next] = Math.max(rank[next], rank[current] + 1);
      indeg[next] -= 1;
      if (indeg[next] === 0) queue.push(next);
    }
  }
  const columns = new Map();
  for (const node of ordered) {
    const column = rank[sccId.get(node)];
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(node);
  }
  const positions = new Map();
  const columnIndexes = [...columns.keys()].sort((a, b) => a - b);
  const rowOf = new Map();
  let maxRow = 0;
  columnIndexes.forEach((column, index) => {
    const desired = columns.get(column).map((node) => {
      const predecessors = analysis.edges
        .filter((edge) => edge.blocked === node)
        .map((edge) => rowOf.get(edge.blocker))
        .filter((row) => row != null);
      const want = predecessors.length
        ? predecessors.reduce((sum, row) => sum + row, 0) / predecessors.length
        : 0;
      return { node, want };
    }).sort((a, b) => a.want - b.want || a.node - b.node);
    let nextFree = 0;
    for (const item of desired) {
      const row = Math.max(Math.round(item.want), nextFree);
      rowOf.set(item.node, row);
      maxRow = Math.max(maxRow, row);
      positions.set(item.node, {
        x: PAD + index * (NODE_W + COL_GAP),
        y: PAD + row * (NODE_H + ROW_GAP),
        column: index,
      });
      nextFree = row + 1;
    }
  });
  const chainEdges = new Set();
  for (let i = 0; i < analysis.chain.length - 1; i += 1) {
    chainEdges.add(`${analysis.chain[i]}->${analysis.chain[i + 1]}`);
  }
  const cycleIds = new Set(analysis.cycles.map((cycle) => sccId.get(cycle.nodes[0])).filter((id) => id != null));
  return {
    nodes: ordered.map((number) => ({ number, ...positions.get(number) })),
    edges: analysis.edges.map((edge) => ({
      ...edge,
      chain: chainEdges.has(`${edge.blocker}->${edge.blocked}`),
      cycle: sccId.get(edge.blocker) === sccId.get(edge.blocked) && cycleIds.has(sccId.get(edge.blocker)),
    })),
    width: PAD * 2 + columnIndexes.length * NODE_W + Math.max(0, columnIndexes.length - 1) * COL_GAP,
    height: PAD * 2 + (maxRow + 1) * NODE_H + maxRow * ROW_GAP,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function reachable(starts, children) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const node = stack.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const child of children.get(node) || []) stack.push(child);
  }
  return seen;
}

function adjacency(nodes, edges) {
  const adj = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) {
    if (!adj.has(edge.blocker)) adj.set(edge.blocker, []);
    if (!adj.has(edge.blocked)) adj.set(edge.blocked, []);
    adj.get(edge.blocker).push(edge.blocked);
  }
  for (const [node, list] of adj) adj.set(node, [...new Set(list)].sort((a, b) => a - b));
  return { adj };
}

function tarjan(nodes, adj) {
  let index = 0;
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const strongconnect = (node) => {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of adj.get(node) || []) {
      if (!indices.has(next)) {
        strongconnect(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), indices.get(next)));
      }
    }
    if (low.get(node) === indices.get(node)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      components.push(component);
    }
  };
  for (const node of nodes) {
    if (!indices.has(node)) strongconnect(node);
  }
  return components;
}

function cyclicComponents(components, adj) {
  const cycles = [];
  for (const component of components) {
    const loop = component.length === 1 && (adj.get(component[0]) || []).includes(component[0]);
    if (component.length > 1 || loop) cycles.push({ nodes: cycleOrder(component, adj) });
  }
  cycles.sort((a, b) => a.nodes[0] - b.nodes[0] || a.nodes.length - b.nodes.length);
  return cycles;
}

function cycleOrder(component, adj) {
  const members = new Set(component);
  if (component.length === 1) return [...component];
  const start = Math.min(...component);
  const path = [];
  const seen = new Set();
  const walk = (node) => {
    path.push(node);
    seen.add(node);
    for (const next of adj.get(node) || []) {
      if (!members.has(next)) continue;
      if (next === start && path.length > 1) return true;
      if (!seen.has(next) && walk(next)) return true;
    }
    path.pop();
    seen.delete(node);
    return false;
  };
  if (walk(start)) return path;
  return [...component].sort((a, b) => a - b);
}

function longestChain(nodes, adj) {
  let chain = [];
  let ties = 0;
  let visits = 0;
  let approximate = false;
  const walk = (node, stack) => {
    if (approximate) return;
    visits += 1;
    if (visits > SEARCH_BUDGET) {
      approximate = true;
      return;
    }
    stack.push(node);
    let extended = false;
    for (const next of adj.get(node) || []) {
      if (stack.includes(next)) continue;
      extended = true;
      walk(next, stack);
    }
    if (!extended && stack.length > 1) {
      if (stack.length > chain.length) {
        chain = stack.slice();
        ties = 1;
      } else if (stack.length === chain.length) {
        ties += 1;
        if (comparePath(stack, chain) < 0) chain = stack.slice();
      }
    }
    stack.pop();
  };
  for (const start of [...nodes].sort((a, b) => a - b)) {
    walk(start, []);
    if (approximate) break;
  }
  return { chain, ties, approximate };
}

function comparePath(left, right) {
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}
