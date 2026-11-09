import { escapeHtml } from "./html.js";

const ALLOWED = new Set([
  "p", "br", "hr", "div", "span", "a", "ul", "ol", "li", "code", "pre",
  "blockquote", "strong", "em", "b", "i", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td", "del", "sup", "sub", "img",
  "tt", "kbd", "input",
]);

// GitHub already sanitizes issue HTML. This is a second pass so a crafted
// body cannot add a script, an event handler, or a javascript: URL.
export function sanitizeGithubHtml(html) {
  const input = String(html ?? "");
  if (!input) return "";
  const blockedBlock = /<(script|style|iframe|object|embed|link|meta|form|svg|math)\b[\s\S]*?<\/\1>/gi;
  const blockedVoid = /<(script|style|iframe|object|embed|link|meta|form|svg|math)\b[^>]*\/?>/gi;
  const stripped = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(blockedBlock, "")
    .replace(blockedVoid, "");
  return stripped.replace(/<\/?\s*([a-zA-Z0-9]+)([^>]*)>/g, (full, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED.has(tag)) return "";
    if (full.startsWith("</")) return `</${tag}>`;
    if (tag === "br" || tag === "hr") return `<${tag}>`;
    if (tag === "input") {
      const type = attr(rawAttrs, "type");
      if (type.toLowerCase() !== "checkbox") return "";
      const checked = /\bchecked\b/i.test(rawAttrs) ? " checked" : "";
      return `<input type="checkbox" disabled${checked}>`;
    }
    if (tag === "a") {
      const href = safeUrl(attr(rawAttrs, "href"));
      if (!href) return "<a>";
      return `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">`;
    }
    if (tag === "img") {
      const src = safeUrl(attr(rawAttrs, "src"));
      if (!src) return "";
      const alt = attr(rawAttrs, "alt");
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
    }
    return `<${tag}>`;
  });
}

function attr(source, name) {
  const match = new RegExp(String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`, "i").exec(source);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function safeUrl(value) {
  if (!value) return "";
  const compact = value.trim().replace(/[\u0000-\u001F\s]+/g, "");
  let decoded = compact;
  try {
    decoded = decodeURIComponent(compact);
  } catch {
    decoded = compact;
  }
  if (/^(https?:|mailto:)/i.test(decoded)) return decoded;
  return "";
}

