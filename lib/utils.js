// lib/utils.js
export function match1(re, str) {
  const m = re.exec(str);
  return m && m[1] ? m[1].trim() : null;
}

export function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function cleanText(text = "", maxLength = null) {
  if (!text) return "";
  let t = text.replace(/[\r\n]+/g, " ").trim();
  if (maxLength && t.length > maxLength) {
    return t.slice(0, maxLength - 1).trim() + "…";
  }
  return t;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export function domainFromUrl(u = "") {
  try {
    const parsed = new URL(u);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return u;
  }
}

export async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
