// frontend/src/components/endpoints/DeveloperSection.tsx — how a client calls the published
// API: effective URLs, curl examples with a placeholder key, the OpenAPI document of the
// snapshot, a test request through the real pipeline, and what each status means.

import { useEffect, useId, useState } from "react";
import { Download, Play } from "lucide-react";
import { API_URL } from "../../lib/env";
import { fetchOpenApiDocument, tryRoute, type ApiRouteInfo, type EndpointStatus, type TryResult } from "../../lib/project-api";
import { curlExample, displayPath, RESPONSE_STATUSES } from "./endpoint-format";
import { Button, CodeBlock, Notice, Section } from "./ui";

const paramsOf = (route: ApiRouteInfo) => [...route.path.matchAll(/:([a-zA-Z][a-zA-Z0-9_]*)/g)].map((match) => match[1]!);

export function DeveloperSection({ automationId, status }: { automationId: string; status: EndpointStatus }) {
  const routes = status.publishedRoutes;
  const base = status.api ? `${API_URL}${status.api.path}` : null;
  const plaintext = API_URL.startsWith("http:");

  return (
    <Section title="Calling the API" hint="What a client needs. Examples use a placeholder for the key: a stored key can never be shown again.">
      <div className="space-y-4">
        {plaintext ? (
          <Notice tone="warn">
            This dashboard reaches Aeolus over plain HTTP, so these URLs are HTTP too. An API key sent over plain HTTP crosses the network
            unencrypted and works for anyone who sees it until it is revoked. That is acceptable only as an explicit choice on a trusted
            LAN for development. Otherwise put Aeolus behind HTTPS and set <code className="font-mono">EXPOSED_API_REQUIRE_HTTPS=true</code>,
            which refuses plain-HTTP API requests.
          </Notice>
        ) : (
          <Notice tone="info">Served over HTTPS. Keep the backend port unreachable except through your proxy.</Notice>
        )}
        <div className="text-[10px] leading-relaxed text-[#7E8A98]">
          Supported networks: a private LAN or a VPN (WireGuard, Tailscale). Exposing Aeolus to the internet through your own reverse proxy
          is possible but not a supported target. Keys go only in the <code className="font-mono text-[#B9C4CF]">Authorization: Bearer</code> header;
          a key in a URL is refused.
        </div>

        {!routes || !base ? (
          <Notice tone="info">Publish the API to get its URLs, examples and OpenAPI document.</Notice>
        ) : (
          <>
            <div className="space-y-3">
              {routes.map((route) => {
                const url = `${base}${displayPath(route.path)}`;
                return (
                  <div key={route.id} className="space-y-1">
                    <div className="text-[10px] text-[#9AA6B2]"><code className="font-mono text-[#5CE1E6]">{route.method}</code> <code className="font-mono text-[#E6EDF3]">{url}</code></div>
                    <CodeBlock code={curlExample(url)} copyLabel={`Copy curl example for ${route.id}`} />
                  </div>
                );
              })}
            </div>
            {/* Keyed by snapshot: a new snapshot remounts it, so neither its document nor a request still in flight for the old one survives. */}
            <OpenApiDocument key={status.published?.id ?? ""} automationId={automationId} slug={status.api!.slug} />
            <TryRequest automationId={automationId} routes={routes} />
          </>
        )}

        <div>
          <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-[#6B7785]">Responses</div>
          <table className="w-full text-left text-[10px]">
            <tbody>
              {RESPONSE_STATUSES.map(([code, meaning]) => (
                <tr key={code} className="border-t border-[#202A36] align-top">
                  <td className="w-12 py-1 pr-2 font-mono text-[#E6EDF3]">{code}</td>
                  <td className="py-1 text-[#B9C4CF]">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

function OpenApiDocument({ automationId, slug }: { automationId: string; slug: string }) {
  const [document, setDocument] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!document || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(new Blob([document], { type: "application/json" }));
    setHref(url);
    return () => { URL.revokeObjectURL(url); setHref(null); };
  }, [document]);

  const load = async () => {
    try {
      setError(null);
      setDocument(await fetchOpenApiDocument(automationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the document");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold text-[#9AA6B2]">OpenAPI 3.1</span>
        <span className="text-[10px] text-[#7E8A98]">Generated from the published snapshot, not the editable source.</span>
        <span className="flex-1" />
        {!document && <Button onClick={load}>Generate document</Button>}
        {document && href && (
          <a href={href} download={`${slug}.openapi.json`} className="inline-flex items-center gap-1.5 rounded-md border border-[#2A3441] px-2.5 py-1.5 text-[10px] font-semibold text-[#9AA6B2] hover:text-[#E6EDF3]">
            <Download size={11} /> Download {slug}.openapi.json
          </a>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {document && (
        <details>
          <summary className="cursor-pointer text-[10px] text-[#7E8A98] hover:text-[#B9C4CF]">Show document</summary>
          <div className="mt-1"><CodeBlock code={document} copyLabel="Copy OpenAPI document" /></div>
        </details>
      )}
    </div>
  );
}

function TryRequest({ automationId, routes }: { automationId: string; routes: ApiRouteInfo[] }) {
  const [routeId, setRouteId] = useState(routes[0]?.id ?? "");
  const [params, setParams] = useState<Record<string, string>>({});
  const [key, setKey] = useState("");
  const [result, setResult] = useState<TryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const keyId = useId();
  const route = routes.find((candidate) => candidate.id === routeId) ?? routes[0];
  const names = route ? paramsOf(route) : [];
  const ready = Boolean(route && key.trim() && names.every((name) => params[name]?.trim()));

  const send = async () => {
    if (!route || !ready) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const values = Object.fromEntries(names.map((name) => [name, params[name]!.trim()]));
      setResult(await tryRoute(automationId, route.id, values, key.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The test request failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-[#202A36] p-3">
      <div className="text-[10px] font-semibold text-[#9AA6B2]">Test a route</div>
      <div className="text-[10px] text-[#7E8A98]">
        Aeolus sends the request to its own API endpoint, so it meets the same key, grant, limit and sandbox checks a client does, and it
        counts against the key's rate limit. The key is used for this one request and is not stored.
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
          Route
          <select value={route?.id ?? ""} onChange={(event) => { setRouteId(event.target.value); setParams({}); }} className="rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 text-[11px] text-[#E6EDF3]">
            {routes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id} ({displayPath(candidate.path)})</option>)}
          </select>
        </label>
        {names.map((name) => (
          <label key={name} className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
            {name}
            <input value={params[name] ?? ""} maxLength={128} onChange={(event) => setParams((current) => ({ ...current, [name]: event.target.value }))} className="w-32 rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 font-mono text-[11px] text-[#E6EDF3]" />
          </label>
        ))}
        <label htmlFor={keyId} className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
          API key
          <input id={keyId} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} placeholder="aeo_…" className="w-64 rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 font-mono text-[11px] text-[#E6EDF3]" />
        </label>
        <Button tone="primary" type="submit" disabled={!ready || sending}><Play size={11} /> {sending ? "Sending…" : "Send request"}</Button>
        {key && <Button onClick={() => setKey("")}>Clear key</Button>}
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <div className="space-y-1" aria-live="polite">
          <div className="text-[10px] text-[#B9C4CF]">
            <span className={`font-mono font-semibold ${result.status < 300 ? "text-[#86EFAC]" : "text-[#FCA5A5]"}`}>{result.status}</span>
            <span className="ml-2 font-mono text-[#7E8A98]">GET {result.path}</span>
            <span className="ml-2 text-[#7E8A98]">{result.durationMs} ms</span>
            {result.retryAfter && <span className="ml-2 text-[#7E8A98]">Retry-After {result.retryAfter}s</span>}
            {result.requestId && <span className="ml-2 font-mono text-[#566170]">request {result.requestId}</span>}
          </div>
          <pre className="max-h-48 overflow-auto rounded bg-[#0B0F14] p-2 text-[10px] text-[#B9C4CF]">{typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
