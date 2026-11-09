import { createClient, loadComments, loadIssues } from "./github.js";
import { applyDecision, emptyFilters, parseRoute } from "./model.js";
import {
  paintLabels,
  renderCritical,
  renderDashboard,
  renderDetail,
  renderHierarchy,
  renderIssueResults,
  renderLoadError,
  renderLoading,
  renderShell,
  renderSignedOut,
} from "./render.js";

const TOKEN_KEY = "issues-dashboard.token";
const OWNER_KEY = "issues-dashboard.owner";
const REPO_KEY = "issues-dashboard.repo";
const LAYOUT_KEY = "issues-dashboard.layout";
const FILTER_KEY = "issues-dashboard.filters";
const DEFAULT_OWNER = "bbops-tw";
const DEFAULT_REPO = "issues-dashboard";

const state = {
  owner: storedName(OWNER_KEY, DEFAULT_OWNER),
  repo: storedName(REPO_KEY, DEFAULT_REPO),
  token: sessionStorage.getItem(TOKEN_KEY) || "",
  login: null,
  issues: [],
  warnings: [],
  remaining: null,
  error: "",
  loading: false,
  layout: localStorage.getItem(LAYOUT_KEY) === "board" ? "board" : "list",
  filters: loadFilters(),
  lastList: "dashboard",
  hierarchyArea: "all",
  detail: null,
  detailError: "",
  notice: "",
  pending: false,
};

let generation = 0;
let controller = null;
const app = document.querySelector("#app");

document.body.addEventListener("click", onClick);
document.body.addEventListener("input", onInput);
document.body.addEventListener("submit", onSubmit);
window.addEventListener("hashchange", onHashChange);

boot();

async function boot() {
  rememberList(currentRoute());
  if (!state.token) {
    render();
    return;
  }
  state.loading = true;
  render();
  const result = await reload();
  if (result.aborted) return;
  render();
  if (result.ok && currentRoute().name === "issue") await loadDetail(currentRoute().number);
}

async function reload() {
  const gen = ++generation;
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const hadIssues = state.issues.length > 0;
  if (!hadIssues) state.loading = true;
  try {
    const client = currentClient();
    const session = await client.getSession(signal);
    const loaded = await loadIssues(client, { signal });
    if (gen !== generation) return { ok: false, aborted: true };
    state.login = session.login;
    state.issues = loaded.issues;
    state.warnings = loaded.warnings;
    state.remaining = loaded.remaining || session.remaining;
    state.error = "";
    state.loading = false;
    sessionStorage.setItem(TOKEN_KEY, state.token);
    localStorage.setItem(OWNER_KEY, state.owner);
    localStorage.setItem(REPO_KEY, state.repo);
    return { ok: true };
  } catch (error) {
    if (signal.aborted || gen !== generation || error.name === "AbortError") return { ok: false, aborted: true };
    state.loading = false;
    state.error = explain(error);
    if (!hadIssues) state.issues = [];
    return { ok: false };
  }
}

async function loadDetail(number) {
  const gen = generation;
  state.detail = { number, comments: [], loading: true, error: "" };
  render();
  try {
    const comments = await loadComments(currentClient(), number, { signal: controller?.signal });
    if (gen !== generation) return;
    state.detail = { number, comments, loading: false, error: "" };
  } catch (error) {
    if (error.name === "AbortError" || gen !== generation) return;
    state.detail = { number, comments: [], loading: false, error: explain(error) };
  }
  render();
}

function render() {
  const route = currentRoute();
  if (!state.token) {
    app.innerHTML = renderSignedOut({
      owner: state.owner,
      repo: state.repo,
      error: state.error,
      insecure: insecurePage(),
    });
    return;
  }
  if (state.loading && !state.issues.length) {
    app.innerHTML = renderLoading({ owner: state.owner, repo: state.repo });
    return;
  }
  if (state.error && !state.issues.length) {
    app.innerHTML = renderLoadError({ owner: state.owner, repo: state.repo, message: state.error });
    return;
  }
  app.innerHTML = renderShell({
    login: state.login,
    owner: state.owner,
    repo: state.repo,
    remaining: state.remaining,
    route,
    lastList: state.lastList,
    warnings: state.warnings,
    error: state.error,
    insecure: insecurePage(),
    mainHtml: renderMain(route),
  });
  paintLabels(app);
  const title = route.name === "issue" ? `Issue #${route.number}` : route.name;
  document.title = `${title} · Issues dashboard`;
}

function renderMain(route) {
  if (route.name === "hierarchy") return renderHierarchy(state.issues, route.area);
  if (route.name === "critical") return renderCritical(state.issues);
  if (route.name === "issue") {
    const issue = state.issues.find((item) => item.number === route.number) || null;
    const detail = state.detail?.number === route.number ? state.detail : { comments: [], loading: true, error: "" };
    return renderDetail({
      issue,
      comments: detail.comments || [],
      loading: detail.loading,
      error: detail.error || state.detailError,
      notice: state.notice,
      pending: state.pending,
      lastList: state.lastList,
      hierarchyArea: state.hierarchyArea,
    });
  }
  return renderDashboard({ issues: state.issues, filters: state.filters, layout: state.layout });
}

async function onSignIn() {
  const owner = cleanName(document.querySelector("#owner")?.value || "");
  const repo = cleanName(document.querySelector("#repo")?.value || "");
  const token = cleanToken(document.querySelector("#token")?.value || "");
  if (!owner || !repo) {
    showFormError("Enter the repository owner and name. Use letters, numbers, dots, underscores, or hyphens.");
    return;
  }
  if (!token) {
    showFormError("Paste a fine-grained personal access token. It stays in this tab only.");
    return;
  }
  const tokenInput = document.querySelector("#token");
  if (tokenInput) tokenInput.value = "";
  state.owner = owner;
  state.repo = repo;
  state.token = token;
  state.issues = [];
  state.error = "";
  state.login = null;
  state.loading = true;
  localStorage.setItem(OWNER_KEY, owner);
  localStorage.setItem(REPO_KEY, repo);
  render();
  const result = await reload();
  if (!result.aborted) render();
  if (result.ok && currentRoute().name === "issue") await loadDetail(currentRoute().number);
}

function signOut() {
  generation += 1;
  controller?.abort();
  sessionStorage.removeItem(TOKEN_KEY);
  state.token = "";
  state.login = null;
  state.issues = [];
  state.warnings = [];
  state.remaining = null;
  state.error = "";
  state.loading = false;
  state.detail = null;
  state.detailError = "";
  state.notice = "";
  state.pending = false;
  render();
}

function onSubmit(event) {
  event.preventDefault();
  if (event.target.id === "sign-in") onSignIn();
}

function onInput(event) {
  if (event.target.id !== "search") return;
  state.filters.q = event.target.value;
  saveFilters();
  const results = document.querySelector("#results");
  if (!results) return;
  results.innerHTML = renderIssueResults(state.issues, state.filters, state.layout);
  paintLabels(results);
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "sign-in") {
    onSignIn();
    return;
  }
  if (action === "sign-out") {
    signOut();
    return;
  }
  if (action === "refresh") {
    const result = await reload();
    if (result.aborted) return;
    render();
    if (result.ok && currentRoute().name === "issue") await loadDetail(currentRoute().number);
    return;
  }
  if (action === "layout") {
    state.layout = button.dataset.layout === "board" ? "board" : "list";
    localStorage.setItem(LAYOUT_KEY, state.layout);
    render();
    return;
  }
  if (action === "clear-filters") {
    state.filters = emptyFilters();
    saveFilters();
    render();
    return;
  }
  if (action === "filter") {
    const group = state.filters[button.dataset.group];
    const value = button.dataset.value || "";
    if (!group) return;
    if (!value) group.clear();
    else if (group.has(value)) group.delete(value);
    else group.add(value);
    saveFilters();
    render();
    return;
  }
  if (action === "open-issue") {
    location.hash = `#/issues/${button.dataset.issue}`;
    return;
  }
  if (action === "decide") {
    await onDecide(button.dataset.decision);
    return;
  }
  if (action === "comment") {
    await onComment();
  }
}

async function onDecide(decision) {
  if (state.pending) return;
  const route = currentRoute();
  if (route.name !== "issue") return;
  const note = document.querySelector("#decision-note")?.value || "";
  state.pending = true;
  state.detailError = "";
  state.notice = "";
  render();
  try {
    await applyDecision(currentClient(), {
      number: route.number,
      decision,
      note,
      login: state.login,
    });
    state.notice = `Recorded ${decision}.`;
    const result = await reload();
    if (!result.aborted && result.ok) await loadDetail(route.number);
  } catch (error) {
    if (error.name === "AbortError") return;
    state.detailError = error.step ? error.message : explain(error);
  } finally {
    state.pending = false;
    if (state.token) render();
  }
}

async function onComment() {
  if (state.pending) return;
  const route = currentRoute();
  if (route.name !== "issue") return;
  const body = document.querySelector("#comment-body")?.value.trim() || "";
  if (!body) {
    state.detailError = "Write a comment before posting.";
    render();
    return;
  }
  state.pending = true;
  state.detailError = "";
  state.notice = "";
  render();
  try {
    await currentClient().addComment(route.number, body);
    state.notice = "Comment posted.";
    const result = await reload();
    if (!result.aborted && result.ok) await loadDetail(route.number);
  } catch (error) {
    if (error.name === "AbortError") return;
    state.detailError = explain(error);
  } finally {
    state.pending = false;
    if (state.token) render();
  }
}

function onHashChange() {
  const route = currentRoute();
  state.notice = "";
  state.detailError = "";
  rememberList(route);
  if (!state.token || state.loading || (state.error && !state.issues.length)) {
    render();
    return;
  }
  if (route.name === "issue") {
    loadDetail(route.number);
    return;
  }
  state.detail = null;
  render();
}

function rememberList(route) {
  if (route.name === "dashboard" || route.name === "hierarchy" || route.name === "critical") {
    state.lastList = route.name;
  }
  if (route.name === "hierarchy") state.hierarchyArea = route.area || "all";
}

function currentRoute() {
  return parseRoute(location.hash);
}

function currentClient() {
  return createClient({ token: state.token, owner: state.owner, repo: state.repo });
}

function explain(error) {
  if (error?.status === 401) return "GitHub rejected the token (401). Use a fine-grained personal access token for this repository.";
  if (error?.status === 403) return "GitHub refused the token (403). It needs Issues read and write, and Metadata read, on this repository.";
  if (error?.status === 404) return "Repository or issue not found, or this token cannot see it (404).";
  return error?.message || "GitHub request failed.";
}

function showFormError(message) {
  const el = document.querySelector("#form-error");
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
}

function cleanName(value) {
  const name = String(value || "").trim();
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) ? name : "";
}

function cleanToken(value) {
  const token = String(value || "").trim();
  if (token.length < 20 || token.length > 500 || /\s/.test(token)) return "";
  return token;
}

function storedName(key, fallback) {
  const stored = localStorage.getItem(key);
  return cleanName(stored) || fallback;
}

function loadFilters() {
  const filters = emptyFilters();
  try {
    const saved = JSON.parse(sessionStorage.getItem(FILTER_KEY) || "null");
    if (!saved) return filters;
    filters.q = String(saved.q || "");
    for (const group of ["types", "areas", "severities", "statuses"]) {
      for (const value of saved[group] || []) filters[group].add(String(value));
    }
  } catch {
    return emptyFilters();
  }
  return filters;
}

function saveFilters() {
  sessionStorage.setItem(FILTER_KEY, JSON.stringify({
    q: state.filters.q,
    types: [...state.filters.types],
    areas: [...state.filters.areas],
    severities: [...state.filters.severities],
    statuses: [...state.filters.statuses],
  }));
}

function insecurePage() {
  return location.protocol === "http:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1";
}
