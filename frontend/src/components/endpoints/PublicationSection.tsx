// frontend/src/components/endpoints/PublicationSection.tsx — slug, publication status, and
// the difference between the saved source and the immutable published snapshot.

import { useEffect, useState } from "react";
import { Globe, Upload, XCircle } from "lucide-react";
import type { ApiGrantWithClient, EndpointStatus, RouteChangeKind } from "../../lib/project-api";
import { explainStatus, formatWhen, shortHash } from "./endpoint-format";
import { Button, Notice, Pill, Section } from "./ui";

const CHANGE_TEXT: Record<RouteChangeKind, string> = {
  unchanged: "Unchanged: grants are kept",
  changed: "Contract changed (path, handler or response schema): its grants are revoked on republish",
  removed: "Removed: its grants are revoked on republish",
  added: "New route: no client has access until you grant it",
};

export interface PublicationSectionProps {
  status: EndpointStatus;
  grants: ApiGrantWithClient[];
  unsavedChanges: boolean;
  busy: boolean;
  /** Set when a slug was refused because it is retired: offer an explicit reclaim. */
  retiredSlug: string | null;
  onSetSlug: (slug: string, reclaim: boolean) => void;
  onCancelReclaim: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
}

export function PublicationSection({ status, grants, unsavedChanges, busy, retiredSlug, onSetSlug, onCancelReclaim, onPublish, onUnpublish }: PublicationSectionProps) {
  const savedSlug = status.api?.slug ?? null;
  const [slugDraft, setSlugDraft] = useState(savedSlug ?? "");
  const [editingSlug, setEditingSlug] = useState(!savedSlug);
  // A saved slug (created, changed or reclaimed) closes the form.
  useEffect(() => {
    setEditingSlug(!savedSlug);
    if (savedSlug) setSlugDraft(savedSlug);
  }, [savedSlug]);
  const explanation = explainStatus(status);
  const published = status.published;
  const grantsLost = (routeId: string) => grants.filter((grant) => grant.routeId === routeId).length;
  const revokedOnRepublish = status.routeChanges
    .filter((change) => change.change === "changed" || change.change === "removed")
    .reduce((total, change) => total + grantsLost(change.routeId), 0);
  const upToDate = Boolean(published && !status.unpublishedChanges && status.status === "serving");
  const canPublish = Boolean(status.api && status.declared && !status.compileErrors) && !upToDate;
  const slugValid = /^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$/.test(slugDraft) && !slugDraft.includes("--");

  return (
    <Section
      title="Publication"
      hint="Clients are served an immutable snapshot an admin published, never the editable source. Saving the project changes nothing that is served until you publish again."
      actions={<Pill tone={explanation.tone}>{explanation.label}</Pill>}
    >
      <div className="space-y-3">
        <Notice tone={explanation.tone === "ok" ? "ok" : explanation.tone === "error" ? "error" : explanation.tone === "warn" ? "warn" : "info"}>
          {explanation.detail}
          {explanation.temporary && <span className="block mt-1 text-[#9AA6B2]">This is temporary. It is not the same as unpublishing, which revokes every grant permanently.</span>}
        </Notice>

        {unsavedChanges && (
          <Notice tone="warn">The editor has unsaved changes. Endpoints shows the last saved revision ({status.revision}); save the project to review and publish your edits.</Notice>
        )}

        <div className="rounded-md border border-[#202A36] bg-[#0B0F14] p-3">
          <div className="mb-2 text-[9px] uppercase tracking-[0.14em] text-[#6B7785]">Slug and URL</div>
          {status.api && !editingSlug ? (
            <div className="flex flex-wrap items-center gap-2">
              <Globe size={12} className="text-[#5CE1E6]" />
              <code className="font-mono text-[11px] text-[#E6EDF3]">{status.api.path}</code>
              <Button onClick={() => { setSlugDraft(status.api!.slug); setEditingSlug(true); }} disabled={busy}>Change slug</Button>
            </div>
          ) : (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => { event.preventDefault(); if (slugValid) onSetSlug(slugDraft, false); }}
            >
              <label className="text-[10px] text-[#9AA6B2]" htmlFor="endpoint-slug">/api/exposed/v1/</label>
              <input
                id="endpoint-slug"
                value={slugDraft}
                onChange={(event) => setSlugDraft(event.target.value.toLowerCase())}
                placeholder="tank-levels"
                maxLength={48}
                className="w-48 rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 font-mono text-[11px] text-[#E6EDF3]"
              />
              <Button tone="primary" type="submit" disabled={busy || !slugValid}>{status.api ? "Save slug" : "Create API"}</Button>
              {status.api && <Button onClick={() => { setEditingSlug(false); onCancelReclaim(); }} disabled={busy}>Cancel</Button>}
              <div className="basis-full text-[10px] text-[#7E8A98]">
                3 to 48 lowercase letters, digits and single hyphens. {status.api
                  ? "Changing it stops the current URL at once and retires it, so no other API can take it over silently."
                  : "This becomes the API's permanent URL; renaming the automation never changes it."}
              </div>
              {slugDraft && !slugValid && <div className="basis-full text-[10px] text-[#FCA5A5]">That slug is not allowed.</div>}
            </form>
          )}
          {retiredSlug && (
            <div className="mt-3 space-y-2">
              <Notice tone="warn">
                <strong className="font-semibold">“{retiredSlug}” belonged to a different API before.</strong> Reclaiming it points that URL
                at this API, which is a different API identity. Nothing carries over from the previous API: no publication, keys or
                grants. Any client still calling the old URL gets 404 until you grant it access here.
              </Notice>
              <div className="flex gap-2">
                <Button tone="danger" onClick={() => onSetSlug(retiredSlug, true)} disabled={busy}>Reclaim “{retiredSlug}” for this API</Button>
                <Button onClick={onCancelReclaim} disabled={busy}>Choose another slug</Button>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-md border border-[#202A36] bg-[#0B0F14] p-3">
            <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-[#6B7785]">Saved source · editable</div>
            {status.declared ? (
              <div className="space-y-0.5 text-[10px] text-[#B9C4CF]">
                <div>Revision {status.revision}, {status.declared.routes.length} route{status.declared.routes.length === 1 ? "" : "s"}</div>
                <div className="font-mono text-[#7E8A98]" title={status.declared.contentHash}>content {shortHash(status.declared.contentHash)}</div>
              </div>
            ) : (
              <div className="text-[10px] text-[#7E8A98]">{status.compileErrors ? "Does not compile; see the errors below." : "Declares no endpoints."}</div>
            )}
          </div>
          <div className="rounded-md border border-[#202A36] bg-[#0B0F14] p-3">
            <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-[#6B7785]">Published snapshot · immutable</div>
            {published ? (
              <div className="space-y-0.5 text-[10px] text-[#B9C4CF]">
                <div>From revision {published.automationRevision}, published {formatWhen(published.publishedAt)}</div>
                <div className="font-mono text-[#7E8A98]" title={published.contentHash}>content {shortHash(published.contentHash)}</div>
                <div>{status.unpublishedChanges ? <Pill tone="warn">Unpublished changes</Pill> : <Pill tone="ok">Matches saved source</Pill>}</div>
              </div>
            ) : (
              <div className="text-[10px] text-[#7E8A98]">Nothing published.</div>
            )}
          </div>
        </div>

        {published && status.unpublishedChanges && status.routeChanges.some((change) => change.change !== "unchanged") && (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3">
            <div className="mb-2 text-[10px] font-semibold text-amber-200">If you republish</div>
            <ul className="space-y-1">
              {status.routeChanges.map((change) => (
                <li key={change.routeId} className="text-[10px] text-[#B9C4CF]">
                  <code className="font-mono text-[#E6EDF3]">{change.routeId}</code>: {CHANGE_TEXT[change.change]}
                  {(change.change === "changed" || change.change === "removed") && grantsLost(change.routeId) > 0 && ` (${grantsLost(change.routeId)} grant${grantsLost(change.routeId) === 1 ? "" : "s"})`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button tone="primary" onClick={onPublish} disabled={busy || !canPublish}>
            <Upload size={11} /> {published ? "Republish saved source" : "Publish"}
          </Button>
          {published && (
            <Button tone="danger" onClick={onUnpublish} disabled={busy}>
              <XCircle size={11} /> Unpublish
            </Button>
          )}
          <span className="text-[10px] text-[#7E8A98]">
            {status.compileErrors ? "Fix the compile errors first."
              : !status.api ? "Create the API with a slug first."
                : !status.declared ? "Declare endpoints in api/routes.json first."
                  : upToDate ? "Published and up to date."
                    : revokedOnRepublish > 0 ? `Republishing revokes ${revokedOnRepublish} grant${revokedOnRepublish === 1 ? "" : "s"}.`
                      : null}
          </span>
        </div>
      </div>
    </Section>
  );
}
