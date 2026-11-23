// src/api/middleware/url-credential-guard.ts — refuse credentials sent in a URL.
//
// Credentials belong in the Authorization header (or, for the dashboard's refresh
// token, an httpOnly cookie). A URL is copied into browser history, proxy and server
// logs, Referer headers and shell history, so a token in a query string is exposed
// whether or not the request succeeds. No Aeolus route reads a credential from the
// query string, so a request carrying one is refused before authentication, and the
// value is never echoed.
//
// This complements request-logger.ts, which never logs the query string at all.

import type { NextFunction, Request, Response } from "express";

/** Query parameter names that carry credentials in common APIs. Compared case-insensitively. */
export const CREDENTIAL_QUERY_PARAMS = [
  "token", "access_token", "id_token", "refresh_token", "auth", "authorization", "bearer",
  "jwt", "api_key", "apikey", "api-key", "key_secret", "password", "passwd", "secret", "client_secret",
] as const;

const NAMES = new Set<string>(CREDENTIAL_QUERY_PARAMS);
// An Aeolus API key or a JWT is refused under any parameter name.
const CREDENTIAL_VALUE = /aeo_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

function queryOf(url: string): string | null {
  const start = url.indexOf("?");
  if (start === -1) return null;
  const end = url.indexOf("#", start);
  return url.slice(start + 1, end === -1 ? undefined : end);
}

/** True when the URL's query string carries something that looks like a credential. */
export function urlCarriesCredential(url: string): boolean {
  const query = queryOf(url);
  if (!query) return false;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const rawName = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    let name = rawName;
    let value = rawValue;
    try { name = decodeURIComponent(rawName.replace(/\+/g, " ")); } catch { /* compare the raw form */ }
    try { value = decodeURIComponent(rawValue.replace(/\+/g, " ")); } catch { /* compare the raw form */ }
    if (NAMES.has(name.trim().toLowerCase()) || CREDENTIAL_VALUE.test(value) || CREDENTIAL_VALUE.test(rawValue)) return true;
  }
  return false;
}

export function urlCredentialGuard(req: Request, res: Response, next: NextFunction): void {
  if (urlCarriesCredential(String(req.originalUrl ?? req.url ?? ""))) {
    res.status(400).json({ error: "Credentials must be sent in the Authorization header, not in the URL" });
    return;
  }
  next();
}
