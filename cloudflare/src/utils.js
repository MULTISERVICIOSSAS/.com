const encoder = new TextEncoder();

export function cleanText(value, limit = 240) {
  return String(value ?? "").replace(/\0/g, "").trim().slice(0, limit);
}

export function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function documentLast4(value) {
  const digits = onlyDigits(value);
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

export function maskDocument(value) {
  const last4 = documentLast4(value);
  return last4 ? `****${last4}` : cleanText(value || "No publicado", 80);
}

export function slugify(value) {
  return cleanText(value, 180)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayIso() {
  return nowIso().slice(0, 10);
}

export function integer(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(data);
}

export function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret, value) {
  if (!value) return "";
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function publicCertificateUrls(publicUrl, code) {
  const base = cleanText(publicUrl, 300).replace(/\/$/, "");
  const normalizedCode = cleanText(code, 80).toUpperCase();
  if (!base || !normalizedCode) return { validationUrl: "", qrUrl: "" };
  const validationUrl = `${base}/validar-certificado.html?codigo=${encodeURIComponent(normalizedCode)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(validationUrl)}`;
  return { validationUrl, qrUrl };
}

export function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!headers.has("Cache-Control") && headers.get("Content-Type")?.includes("text/html")) {
    headers.set("Cache-Control", "no-cache");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
