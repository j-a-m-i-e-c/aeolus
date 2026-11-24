// frontend/src/components/endpoints/AccessSection.tsx — which client may call which
// published route of this API, and granting or revoking one route at a time.

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { ApiClientSummary, ApiGrantWithClient, ApiRouteInfo } from "../../lib/project-api";
import { displayPath, formatWhen } from "./endpoint-format";
import { Button, Notice, Pill, Section } from "./ui";

export interface AccessSectionProps {
  publishedRoutes: ApiRouteInfo[] | null;
  grants: ApiGrantWithClient[];
  clients: ApiClientSummary[];
  busy: boolean;
  onGrant: (clientId: string, routeId: string) => void;
  onRevoke: (grant: ApiGrantWithClient) => void;
}

export function AccessSection({ publishedRoutes, grants, clients, busy, onGrant, onRevoke }: AccessSectionProps) {
  const activeClients = clients.filter((client) => client.status === "active");
  const [clientId, setClientId] = useState("");
  const [routeId, setRouteId] = useState("");
  const chosenClient = activeClients.some((client) => client.id === clientId) ? clientId : "";
  const chosenRoute = publishedRoutes?.some((route) => route.id === routeId) ? routeId : "";
  const alreadyGranted = grants.some((grant) => grant.clientId === chosenClient && grant.routeId === chosenRoute);

  return (
    <Section
      title="Access"
      hint="A grant lets one client call one published route. Routes published later are never included, and a grant is revoked if its route's contract changes when you republish."
    >
      {!publishedRoutes ? (
        <Notice tone="info">Publish the API before granting access to it. Only published routes can be granted.</Notice>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            {publishedRoutes.map((route) => {
              const holders = grants.filter((grant) => grant.routeId === route.id);
              return (
                <div key={route.id} className="rounded-md border border-[#202A36] bg-[#0B0F14] p-3">
                  <div className="flex items-center gap-2 text-[10px]">
                    <code className="font-mono text-[#5CE1E6]">{route.method}</code>
                    <code className="font-mono text-[#E6EDF3]">{displayPath(route.path)}</code>
                    <span className="text-[#6B7785]">route {route.id}</span>
                  </div>
                  {holders.length === 0 ? (
                    <div className="mt-1.5 text-[10px] text-[#7E8A98]">No client has access.</div>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {holders.map((grant) => (
                        <li key={grant.id} className="flex items-center gap-2 text-[10px] text-[#B9C4CF]">
                          <ShieldCheck size={11} className="text-[#86EFAC]" />
                          <span className="font-medium">{grant.clientName}</span>
                          {grant.clientStatus === "disabled" && <Pill tone="warn">Client disabled</Pill>}
                          <span className="text-[#6B7785]">since {formatWhen(grant.grantedAt)}</span>
                          <span className="flex-1" />
                          <Button tone="danger" onClick={() => onRevoke(grant)} disabled={busy} aria-label={`Revoke ${grant.clientName}'s access to ${route.id}`}>Revoke</Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <form
            className="flex flex-wrap items-end gap-2 rounded-md border border-[#202A36] p-3"
            onSubmit={(event) => { event.preventDefault(); if (chosenClient && chosenRoute && !alreadyGranted) onGrant(chosenClient, chosenRoute); }}
          >
            <label className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
              Client
              <select value={chosenClient} onChange={(event) => setClientId(event.target.value)} className="rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 text-[11px] text-[#E6EDF3]">
                <option value="">Choose a client…</option>
                {activeClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
              Published route
              <select value={chosenRoute} onChange={(event) => setRouteId(event.target.value)} className="rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 text-[11px] text-[#E6EDF3]">
                <option value="">Choose a route…</option>
                {publishedRoutes.map((route) => <option key={route.id} value={route.id}>{route.id} ({displayPath(route.path)})</option>)}
              </select>
            </label>
            <Button tone="primary" type="submit" disabled={busy || !chosenClient || !chosenRoute || alreadyGranted}>Grant access</Button>
            {alreadyGranted && <span className="text-[10px] text-[#7E8A98]">That client already has this route.</span>}
            {activeClients.length === 0 && <span className="basis-full text-[10px] text-[#7E8A98]">Create an active API client below first.</span>}
          </form>
        </div>
      )}
    </Section>
  );
}
