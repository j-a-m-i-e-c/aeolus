// frontend/src/components/endpoints/EndpointsPanel.tsx — the Endpoints section of the
// Automation Project editor (ADR-0027, Phase 4).
//
// Every action here calls an admin-only server route; the server enforces that whatever
// this component shows. Status is read when the section opens, after each action, after
// a save (savedRevision) and on Refresh. It never polls.
//
// A newly issued key is held in `revealed` state only, shown once by KeyRevealDialog
// and dropped when the dialog closes or this component unmounts. It is never put in a
// store, a draft, the URL, a log or an error message.

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, Network, RefreshCw } from "lucide-react";
import {
  createClient, fetchApiAudit, fetchApiGrants, fetchClients, fetchEndpointStatus, grantRoute, issueKey, ProjectApiRequestError,
  publishApi, revokeKey, revokeRouteGrant, rotateKey, setApiSlug, setClientEnabled, unpublishApi,
  type ApiClientSummary, type ApiCredential, type ApiGrantWithClient, type AuditEvent, type EndpointStatus, type IssuedKey,
} from "../../lib/project-api";
import { AccessSection } from "./AccessSection";
import { ClientsSection } from "./ClientsSection";
import { DeveloperSection } from "./DeveloperSection";
import { AUDIT_LABELS, formatWhen, maskedKey, shortHash } from "./endpoint-format";
import { KeyRevealDialog } from "./KeyRevealDialog";
import { PublicationSection } from "./PublicationSection";
import { RoutesSection } from "./RoutesSection";
import { Button, ConfirmDialog, Notice, Section, type ConfirmRequest } from "./ui";

export interface EndpointsPanelProps {
  automationId: string;
  /** The revision the host last saved or loaded; a change re-reads the status. */
  savedRevision: number | null;
  /** True when the editor holds edits that are not saved, so are not shown here. */
  unsavedChanges: boolean;
}

interface Loaded {
  status: EndpointStatus;
  grants: ApiGrantWithClient[];
  clients: ApiClientSummary[];
  audit: AuditEvent[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "The request failed");

export function EndpointsPanel({ automationId, savedRevision, unsavedChanges }: EndpointsPanelProps) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [revealed, setRevealed] = useState<{ issued: IssuedKey; clientName: string; rotated: boolean } | null>(null);
  const [retiredSlug, setRetiredSlug] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const [status, grants, clients] = await Promise.all([fetchEndpointStatus(automationId), fetchApiGrants(automationId), fetchClients()]);
      const audit = status.api ? await fetchApiAudit(status.api.id) : [];
      if (request !== latest.current) return;
      setData({ status, grants, clients, audit });
      setLoadError(null);
    } catch (error) {
      if (request !== latest.current) return;
      setLoadError(messageOf(error));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [automationId]);

  useEffect(() => { void load(); }, [load, savedRevision]);
  // Drop a revealed key if the section goes away with the dialog still open.
  useEffect(() => () => setRevealed(null), []);

  /** Run one action, report its outcome, then re-read everything it may have changed. */
  const run = useCallback(async (action: () => Promise<string | null>) => {
    setBusy(true);
    setNotice(null);
    try {
      const done = await action();
      if (done) setNotice({ tone: "ok", text: done });
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
      setRefreshToken((value) => value + 1);
      await load();
    }
  }, [load]);

  const ask = (request: ConfirmRequest) => setConfirm(request);
  const confirmNow = async () => {
    if (!confirm) return;
    const request = confirm;
    await run(async () => { await request.action(); return null; });
    setConfirm(null);
  };

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[11px] text-[#7E8A98]">
        {loadError ? (
          <div className="space-y-2 text-center">
            <Notice tone="error">Endpoints could not be loaded: {loadError}</Notice>
            <Button onClick={() => void load()}><RefreshCw size={11} /> Try again</Button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading endpoints…</span>
        )}
      </div>
    );
  }

  const { status, grants, clients, audit } = data;
  const clientName = (id: string | null) => clients.find((client) => client.id === id)?.name ?? "a client";

  const onSetSlug = (slug: string, reclaim: boolean) => void run(async () => {
    try {
      const saved = await setApiSlug(automationId, slug, reclaim);
      setRetiredSlug(null);
      if (saved.reclaimedFrom) {
        return `Reclaimed “${saved.slug}”. It previously belonged to API ${saved.reclaimedFrom.slice(0, 8)}; nothing from that API carried over.`;
      }
      return `The API's URL is now /api/exposed/v1/${saved.slug}.`;
    } catch (error) {
      if (error instanceof ProjectApiRequestError && error.reason === "slug-retired") {
        setRetiredSlug(slug);
        return null;
      }
      throw error;
    }
  });

  const onPublish = () => {
    const declared = status.declared!;
    const revoked = status.routeChanges.filter((change) => change.change === "changed" || change.change === "removed");
    const lostGrants = grants.filter((grant) => revoked.some((change) => change.routeId === grant.routeId));
    const added = status.routeChanges.filter((change) => change.change === "added");
    ask({
      title: status.published ? "Republish the saved source?" : "Publish this API?",
      confirmLabel: lostGrants.length > 0 ? `Publish and revoke ${lostGrants.length} grant${lostGrants.length === 1 ? "" : "s"}` : "Publish",
      destructive: lostGrants.length > 0,
      body: (
        <>
          <p>You are approving revision {status.revision} (content <code className="font-mono">{shortHash(declared.contentHash)}</code>) with {declared.routes.length} route{declared.routes.length === 1 ? "" : "s"}. Clients will be served exactly this snapshot until you publish again.</p>
          {unsavedChanges && <p className="text-amber-200">Unsaved editor changes are not part of it.</p>}
          {lostGrants.length > 0 && (
            <p className="text-[#FCA5A5]">
              Route contracts changed, so these grants are revoked: {lostGrants.map((grant) => `${grant.clientName} → ${grant.routeId}`).join(", ")}. Grant them again if they should still have access.
            </p>
          )}
          {added.length > 0 && <p>New routes ({added.map((change) => change.routeId).join(", ")}) start with no access.</p>}
        </>
      ),
      action: async () => {
        try {
          await publishApi(automationId, declared.contentHash);
          setNotice({ tone: "ok", text: `Published revision ${status.revision}.` });
        } catch (error) {
          if (error instanceof ProjectApiRequestError && (error.reason === "content-changed" || error.reason === "revision-changed")) {
            throw new Error("The saved source changed after you reviewed it, so nothing was published. The view has been reloaded: review it and publish again.");
          }
          throw error;
        }
      },
    });
  };

  const onUnpublish = () => ask({
    title: `Unpublish ${status.api?.slug ?? "this API"}?`,
    destructive: true,
    confirmLabel: grants.length > 0 ? `Unpublish and revoke ${grants.length} grant${grants.length === 1 ? "" : "s"}` : "Unpublish",
    body: (
      <>
        <p>Serving stops on the next request, and <strong>every grant to this API is revoked permanently</strong> ({grants.length} now). Publishing again, even identical source, restores none of them: you will need to grant access again.</p>
        <p>API clients and their keys are not affected, and keep any access they have to other APIs.</p>
        <p className="text-[#9AA6B2]">To pause serving temporarily instead, disable the automation. That keeps every grant, and serving resumes when it is enabled.</p>
      </>
    ),
    action: async () => {
      const { revokedGrants } = await unpublishApi(automationId);
      setNotice({ tone: "ok", text: `Unpublished. ${revokedGrants} grant${revokedGrants === 1 ? "" : "s"} revoked.` });
    },
  });

  const onGrant = (clientId: string, routeId: string) => void run(async () => {
    await grantRoute(automationId, clientId, routeId);
    return `${clientName(clientId)} can now call ${routeId}.`;
  });

  const onRevokeGrant = (grant: ApiGrantWithClient) => ask({
    title: `Revoke ${grant.clientName}'s access to ${grant.routeId}?`,
    destructive: true,
    confirmLabel: "Revoke access",
    body: <p>Their next request to this route gets 404. The client and its key keep working for any other route or API it is granted.</p>,
    action: async () => {
      await revokeRouteGrant(automationId, grant.clientId, grant.routeId);
      setNotice({ tone: "ok", text: `Revoked ${grant.clientName}'s access to ${grant.routeId}.` });
    },
  });

  const onCreateClient = (name: string) => void run(async () => {
    const created = await createClient(name);
    return `Created client ${created.name}. Issue it a key, then grant it routes.`;
  });

  const onIssue = (client: ApiClientSummary, expiresAt: number | null) => void run(async () => {
    const issued = await issueKey(client.id, expiresAt);
    setRevealed({ issued, clientName: client.name, rotated: false });
    return null;
  });

  const onRotate = (client: ApiClientSummary, credential: ApiCredential, expiresAt: number | null, overlapSeconds: number) => void run(async () => {
    const issued = await rotateKey(client.id, credential.id, expiresAt, overlapSeconds);
    setRevealed({ issued, clientName: client.name, rotated: true });
    return null;
  });

  const onRevokeKey = (client: ApiClientSummary, credential: ApiCredential) => ask({
    title: `Revoke key ${maskedKey(credential)}?`,
    destructive: true,
    confirmLabel: "Revoke key",
    body: <p>Requests with this key are refused (401) from the next one. {client.name}'s other keys and its grants are not affected. This cannot be undone; issue a new key if needed.</p>,
    action: async () => {
      await revokeKey(client.id, credential.id);
      setNotice({ tone: "ok", text: `Revoked key ${maskedKey(credential)}.` });
    },
  });

  const onSetEnabled = (client: ApiClientSummary, enabled: boolean) => {
    if (enabled) {
      void run(async () => { await setClientEnabled(client.id, true); return `${client.name} is enabled again.`; });
      return;
    }
    ask({
      title: `Disable ${client.name}?`,
      destructive: true,
      confirmLabel: "Disable client",
      body: <p>Every key of this client is refused from the next request, on every API. This is temporary: its keys and grants are kept, and enabling it restores access.</p>,
      action: async () => {
        await setClientEnabled(client.id, false);
        setNotice({ tone: "ok", text: `${client.name} is disabled.` });
      },
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#2A3441] px-4">
        <Network size={14} className="text-[#5CE1E6]" />
        <div className="flex-1">
          <div className="text-xs font-semibold text-[#E6EDF3]">Endpoints</div>
          <div className="text-[9px] text-[#6B7785]">Read-only HTTP endpoints published from this project · admin only</div>
        </div>
        {loading && <Loader2 size={12} className="animate-spin text-[#6B7785]" aria-label="Refreshing" />}
        <Button onClick={() => void load()} disabled={loading} aria-label="Refresh endpoints"><RefreshCw size={11} /> Refresh</Button>
      </div>
      <div className="flex-1 overflow-auto">
        {(notice || loadError) && (
          <div className="px-4 pt-3">
            {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
            {loadError && <Notice tone="error">Could not refresh: {loadError}</Notice>}
          </div>
        )}
        <PublicationSection
          status={status}
          grants={grants}
          unsavedChanges={unsavedChanges}
          busy={busy}
          retiredSlug={retiredSlug}
          onSetSlug={onSetSlug}
          onCancelReclaim={() => setRetiredSlug(null)}
          onPublish={onPublish}
          onUnpublish={onUnpublish}
        />
        <RoutesSection status={status} />
        <AccessSection publishedRoutes={status.publishedRoutes} grants={grants} clients={clients} busy={busy} onGrant={onGrant} onRevoke={onRevokeGrant} />
        <ClientsSection
          clients={clients}
          apiId={status.api?.id ?? null}
          busy={busy}
          refreshToken={refreshToken}
          onCreate={onCreateClient}
          onIssue={onIssue}
          onRotate={onRotate}
          onRevokeKey={onRevokeKey}
          onSetEnabled={onSetEnabled}
        />
        <DeveloperSection automationId={automationId} status={status} />
        {status.api && (
          <Section title="Activity" hint="Changes to this API's publication and access, newest first. Kept permanently.">
            {audit.length === 0 ? (
              <div className="text-[10px] text-[#7E8A98]">No changes recorded yet.</div>
            ) : (
              <ul className="space-y-1">
                {audit.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-x-2 text-[10px] text-[#B9C4CF]">
                    <History size={10} className="text-[#6B7785]" />
                    <span className="text-[#7E8A98]">{formatWhen(event.at)}</span>
                    <span className="font-medium">{AUDIT_LABELS[event.action] ?? event.action}</span>
                    {event.routeId && <code className="font-mono">{event.routeId}</code>}
                    {event.clientId && <span>for {clientName(event.clientId)}</span>}
                    {typeof event.metadata.reason === "string" && <span className="text-[#7E8A98]">({event.metadata.reason})</span>}
                    <span className="text-[#6B7785]">by {event.actorUsername}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>

      {confirm && <ConfirmDialog request={confirm} busy={busy} onConfirm={() => void confirmNow()} onCancel={() => setConfirm(null)} />}
      {revealed && (
        <KeyRevealDialog issued={revealed.issued} clientName={revealed.clientName} rotated={revealed.rotated} onClose={() => setRevealed(null)} />
      )}
    </div>
  );
}
