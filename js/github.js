import { deriveIssue } from "./model.js";

const API = "https://api.github.com";
const VERSION = "2026-03-10";

const SESSION_QUERY = `
  query Session($owner: String!, $name: String!) {
    viewer { login }
    repository(owner: $owner, name: $name) {
      nameWithOwner
      visibility
    }
  }
`;

const ISSUES_QUERY = `
  query Issues($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issues(
        first: 50
        after: $cursor
        states: [OPEN, CLOSED]
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          databaseId
          title
          state
          body
          bodyHTML
          createdAt
          updatedAt
          url
          author { login }
          assignees(first: 10) { nodes { login } }
          labels(first: 30) { nodes { name color } }
          comments { totalCount }
          parent { number title state }
          subIssues(first: 50) {
            pageInfo { hasNextPage }
            nodes { number title state }
          }
          blockedBy(first: 50) {
            pageInfo { hasNextPage }
            nodes { number title state }
          }
          blocking(first: 50) {
            pageInfo { hasNextPage }
            nodes { number title state }
          }
        }
      }
    }
  }
`;

const COMMENTS_QUERY = `
  query Comments($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        number
        comments(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            databaseId
            createdAt
            url
            author { login }
            bodyHTML
          }
        }
      }
    }
  }
`;

export class GithubError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

export function createClient({ token, owner, repo }) {
  const path = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = (extra = {}) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": VERSION,
    ...extra,
  });

  async function rest(pathname, { method = "GET", body, signal } = {}) {
    const response = await fetch(`${API}${pathname}`, {
      method,
      signal,
      headers: headers(body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 300) };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      remaining: response.headers.get("x-ratelimit-remaining"),
    };
  }

  async function graphql(query, variables, signal) {
    const response = await fetch(`${API}/graphql`, {
      method: "POST",
      signal,
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json().catch(() => null);
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (!response.ok) {
      throw new GithubError(payload?.message || `GitHub request failed (${response.status}).`, response.status);
    }
    return {
      data: payload?.data,
      errors: payload?.errors || [],
      remaining,
      status: response.status,
    };
  }

  return {
    owner,
    repo,
    path,
    rest,
    graphql,
    async getSession(signal) {
      const result = await graphql(SESSION_QUERY, { owner, name: repo }, signal);
      const repository = result.data?.repository;
      if (!repository) {
        const message = result.errors?.[0]?.message || "Repository not found, or this token cannot see it.";
        const status = /could not resolve|not found/i.test(message) ? 404 : 403;
        throw new GithubError(message, status);
      }
      return {
        login: result.data?.viewer?.login || null,
        repo: repository,
        remaining: result.remaining,
      };
    },
    async addLabels(number, labels, signal) {
      const result = await rest(`/repos/${path}/issues/${number}/labels`, {
        method: "POST",
        body: { labels },
        signal,
      });
      if (!result.ok) throw restError(result, `Could not add labels on #${number}.`);
      return result;
    },
    async removeLabel(number, name, signal) {
      const result = await rest(`/repos/${path}/issues/${number}/labels/${encodeURIComponent(name)}`, {
        method: "DELETE",
        signal,
      });
      if (result.status === 404) return result;
      if (!result.ok) throw restError(result, `Could not remove ${name} from #${number}.`);
      return result;
    },
    async addComment(number, body, signal) {
      const result = await rest(`/repos/${path}/issues/${number}/comments`, {
        method: "POST",
        body: { body },
        signal,
      });
      if (!result.ok) throw restError(result, `Could not comment on #${number}.`);
      return result;
    },
  };
}

export async function loadIssues(client, { signal } = {}) {
  const issues = [];
  const warnings = [];
  let cursor = null;
  let remaining = null;
  for (let page = 0; page < 20; page += 1) {
    const result = await client.graphql(ISSUES_QUERY, {
      owner: client.owner,
      name: client.repo,
      cursor,
    }, signal);
    remaining = result.remaining ?? remaining;
    const connection = result.data?.repository?.issues;
    if (!connection) {
      const message = result.errors?.[0]?.message || "GitHub did not return issues.";
      throw new GithubError(message, /could not resolve|not found/i.test(message) ? 404 : 502);
    }
    for (const node of connection.nodes || []) {
      if (!node?.number) continue;
      const normalized = normalizeIssue(node);
      if (normalized.subIssuesTruncated || normalized.blockedByTruncated || normalized.blockingTruncated) {
        warnings.push(`#${normalized.number} has more relationships than this view loaded (first 50).`);
      }
      issues.push(deriveIssue(normalized));
    }
    if (!connection.pageInfo?.hasNextPage) return { issues, warnings, remaining };
    cursor = connection.pageInfo.endCursor;
  }
  warnings.push("Stopped after 1000 issues. Narrow the repository or raise the page cap in js/github.js.");
  return { issues, warnings, remaining };
}

export async function loadComments(client, number, { signal } = {}) {
  const comments = [];
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const result = await client.graphql(COMMENTS_QUERY, {
      owner: client.owner,
      name: client.repo,
      number,
      cursor,
    }, signal);
    const issue = result.data?.repository?.issue;
    if (!issue) {
      const message = result.errors?.[0]?.message || `Issue #${number} was not found.`;
      throw new GithubError(message, 404);
    }
    const connection = issue.comments;
    for (const node of connection?.nodes || []) {
      if (!node) continue;
      comments.push({
        id: node.databaseId,
        createdAt: node.createdAt || "",
        url: node.url || "",
        author: node.author?.login || null,
        bodyHtml: node.bodyHTML || "",
      });
    }
    if (!connection?.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  comments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return comments;
}

export function normalizeIssue(node) {
  return {
    number: node.number,
    id: node.databaseId ?? null,
    title: node.title || "",
    state: String(node.state || "").toLowerCase(),
    body: node.body || "",
    bodyHtml: node.bodyHTML || "",
    createdAt: node.createdAt || "",
    updatedAt: node.updatedAt || "",
    url: node.url || "",
    author: node.author?.login || null,
    assignees: (node.assignees?.nodes || []).map((person) => person?.login).filter(Boolean),
    labels: (node.labels?.nodes || []).filter(Boolean).map((label) => ({
      name: label.name,
      color: label.color || "",
    })),
    commentCount: node.comments?.totalCount ?? 0,
    parent: brief(node.parent),
    subIssues: (node.subIssues?.nodes || []).filter(Boolean).map(brief),
    blockedBy: (node.blockedBy?.nodes || []).filter(Boolean).map(brief),
    blocking: (node.blocking?.nodes || []).filter(Boolean).map(brief),
    subIssuesTruncated: Boolean(node.subIssues?.pageInfo?.hasNextPage),
    blockedByTruncated: Boolean(node.blockedBy?.pageInfo?.hasNextPage),
    blockingTruncated: Boolean(node.blocking?.pageInfo?.hasNextPage),
  };
}

function brief(node) {
  if (!node?.number) return null;
  return {
    number: node.number,
    title: node.title || "",
    state: String(node.state || "").toLowerCase(),
  };
}

function restError(result, fallback) {
  const message = result.data?.message || fallback;
  const error = new GithubError(message, result.status);
  if (result.status === 404 && /label/i.test(message)) {
    error.message = `${message} Labels are created in the private repository, not by this site.`;
  }
  return error;
}

