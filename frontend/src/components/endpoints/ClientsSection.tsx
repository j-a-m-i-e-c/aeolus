// frontend/src/components/endpoints/ClientsSection.tsx — machine clients and their keys.
//
// Clients belong to the installation, not to one automation: a client may hold grants
// to several APIs. After a key is issued only its public id, last four characters and
// dates are ever shown again.

import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { fetchClient, type ApiClientDetail, type ApiClientSummary, type ApiCredential } from "../../lib/project-api";
import {
  credentialState, EXPIRY_CHOICES, expiryFromChoice, formatWhen, maskedKey, OVERLAP_CHOICES, type ExpiryChoice,
} from "./endpoint-format";
import { Button, Notice, Pill, Section } from "./ui";

export interface ClientActions {
  onIssue: (client: ApiClientSummary, expiresAt: number | null) => void;
  onRotate: (client: ApiClientSummary, credential: ApiCredential, expiresAt: number | null, overlapSeconds: number) => void;
  onRevokeKey: (client: ApiClientSummary, credential: ApiCredential) => void;
  onSetEnabled: (client: ApiClientSummary, enabled: boolean) => void;
}

export interface ClientsSectionProps extends ClientActions {
  clients: ApiClientSummary[];
  apiId: string | null;
  busy: boolean;
  /** Changes after every mutation, so open client details are re-read. */
  refreshToken: number;
  onCreate: (name: string) => void;
}

export function ClientsSection({ clients, apiId, busy, refreshToken, onCreate, ...actions }: ClientsSectionProps) {
  const [name, setName] = useState("");
  const nameId = useId();
  return (
    <Section
      title="API clients"
      hint="A client is a machine, such as another Aeolus or a script, not a dashboard user. It cannot log in. Clients are shared by every API on this installation."
    >
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => { event.preventDefault(); const trimmed = name.trim(); if (trimmed) { onCreate(trimmed); setName(""); } }}
      >
        <label htmlFor={nameId} className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
          New client name
          <input
            id={nameId}
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="Remote farm Aeolus"
            className="w-56 rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 text-[11px] text-[#E6EDF3]"
          />
        </label>
        <Button tone="primary" type="submit" disabled={busy || !name.trim()}><Plus size={11} /> Create client</Button>
      </form>

      {clients.length === 0 ? (
        <div className="text-[10px] text-[#7E8A98]">No API clients yet.</div>
      ) : (
        <ul className="space-y-2">
          {clients.map((client) => (
            <ClientRow key={client.id} client={client} apiId={apiId} busy={busy} refreshToken={refreshToken} {...actions} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ClientRow({ client, apiId, busy, refreshToken, onIssue, onRotate, onRevokeKey, onSetEnabled }: ClientActions & {
  client: ApiClientSummary; apiId: string | null; busy: boolean; refreshToken: number;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ApiClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issueChoice, setIssueChoice] = useState<ExpiryChoice>("90");
  const [issueDate, setIssueDate] = useState("");
  const [rotating, setRotating] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchClient(client.id)
      .then((loaded) => { if (!cancelled) { setDetail(loaded); setError(null); } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the client"); });
    return () => { cancelled = true; };
  }, [open, client.id, refreshToken]);

  const issueExpiry = expiryFromChoice(issueChoice, issueDate);
  const disabled = client.status === "disabled";

  return (
    <li className="rounded-md border border-[#202A36] bg-[#0B0F14]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[11px] text-[#E6EDF3]"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="truncate font-medium">{client.name}</span>
          <Pill tone={disabled ? "warn" : "ok"}>{disabled ? "Disabled" : "Active"}</Pill>
          <span className="text-[10px] text-[#7E8A98]">{client.activeKeys} key{client.activeKeys === 1 ? "" : "s"} · {client.activeGrants} grant{client.activeGrants === 1 ? "" : "s"}</span>
        </button>
        <Button
          tone={disabled ? "primary" : "danger"}
          onClick={() => onSetEnabled(client, disabled)}
          disabled={busy}
        >
          {disabled ? "Enable" : "Disable"}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-[#202A36] px-3 py-3">
          {error && <Notice tone="error">{error}</Notice>}
          {disabled && <Notice tone="warn">Disabled: every key of this client is refused (401). Its grants are kept, so enabling it restores access.</Notice>}
          {detail && (
            <>
              <div>
                <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-[#6B7785]">Keys</div>
                {detail.credentials.length === 0 ? (
                  <div className="text-[10px] text-[#7E8A98]">No keys issued.</div>
                ) : (
                  <table className="w-full text-left text-[10px]">
                    <thead className="text-[9px] uppercase tracking-[0.12em] text-[#6B7785]">
                      <tr><th className="py-1 pr-2 font-medium">Key</th><th className="py-1 pr-2 font-medium">Created</th><th className="py-1 pr-2 font-medium">Expires</th><th className="py-1 pr-2 font-medium">Last used</th><th className="py-1 pr-2 font-medium">State</th><th /></tr>
                    </thead>
                    <tbody>
                      {detail.credentials.map((credential) => {
                        const state = credentialState(credential);
                        return (
                          <CredentialRow
                            key={credential.id}
                            credential={credential}
                            state={state}
                            busy={busy}
                            rotating={rotating === credential.id}
                            onStartRotate={() => setRotating(credential.id)}
                            onCancelRotate={() => setRotating(null)}
                            onRotate={(expiresAt, overlap) => { setRotating(null); onRotate(client, credential, expiresAt, overlap); }}
                            onRevoke={() => onRevokeKey(client, credential)}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => { event.preventDefault(); if (issueExpiry.ok) onIssue(client, issueExpiry.expiresAt); }}
              >
                <ExpiryPicker label="New key expires" choice={issueChoice} date={issueDate} onChoice={setIssueChoice} onDate={setIssueDate} />
                <Button tone="primary" type="submit" disabled={busy || disabled || !issueExpiry.ok}>Issue key</Button>
                {!issueExpiry.ok && <span className="text-[10px] text-[#FCA5A5]">{issueExpiry.error}</span>}
                {disabled && <span className="text-[10px] text-[#7E8A98]">Enable the client to issue keys.</span>}
              </form>

              <div>
                <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-[#6B7785]">Grants, including revoked history</div>
                {detail.grants.length === 0 ? (
                  <div className="text-[10px] text-[#7E8A98]">No grants.</div>
                ) : (
                  <ul className="space-y-0.5">
                    {detail.grants.map((grant) => (
                      <li key={grant.id} className="text-[10px] text-[#B9C4CF]">
                        <code className="font-mono">{grant.routeId}</code>
                        <span className="text-[#6B7785]"> on {grant.apiId === apiId ? "this API" : "another API"}, granted {formatWhen(grant.grantedAt)}</span>
                        {grant.revokedAt !== null && <span className="text-[#FCA5A5]"> · revoked {formatWhen(grant.revokedAt)} ({grant.revokeReason})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function CredentialRow({ credential, state, busy, rotating, onStartRotate, onCancelRotate, onRotate, onRevoke }: {
  credential: ApiCredential;
  state: ReturnType<typeof credentialState>;
  busy: boolean;
  rotating: boolean;
  onStartRotate: () => void;
  onCancelRotate: () => void;
  onRotate: (expiresAt: number | null, overlapSeconds: number) => void;
  onRevoke: () => void;
}) {
  const [choice, setChoice] = useState<ExpiryChoice>("90");
  const [date, setDate] = useState("");
  const [overlap, setOverlap] = useState(0);
  const expiry = expiryFromChoice(choice, date);
  const tone = state === "active" ? "ok" : state === "expired" ? "warn" : "off";
  return (
    <>
      <tr className="border-t border-[#202A36]">
        <td className="py-1.5 pr-2 font-mono text-[#E6EDF3]">{maskedKey(credential)}</td>
        <td className="py-1.5 pr-2 text-[#B9C4CF]">{formatWhen(credential.createdAt)}</td>
        <td className="py-1.5 pr-2 text-[#B9C4CF]">{credential.expiresAt === null ? "never" : formatWhen(credential.expiresAt)}</td>
        <td className="py-1.5 pr-2 text-[#B9C4CF]">{formatWhen(credential.lastUsedAt)}</td>
        <td className="py-1.5 pr-2"><Pill tone={tone}>{state === "revoked" ? `Revoked ${formatWhen(credential.revokedAt)}` : state}</Pill></td>
        <td className="py-1.5 text-right">
          {state === "active" && !rotating && (
            <span className="inline-flex gap-1">
              <Button onClick={onStartRotate} disabled={busy} aria-label={`Rotate key ${credential.keyId}`}>Rotate</Button>
              <Button tone="danger" onClick={onRevoke} disabled={busy} aria-label={`Revoke key ${credential.keyId}`}>Revoke</Button>
            </span>
          )}
        </td>
      </tr>
      {rotating && (
        <tr>
          <td colSpan={6} className="pb-2">
            <form
              className="flex flex-wrap items-end gap-2 rounded-md border border-[#2A3441] p-2"
              onSubmit={(event) => { event.preventDefault(); if (expiry.ok) onRotate(expiry.expiresAt, overlap); }}
            >
              <ExpiryPicker label="Replacement expires" choice={choice} date={date} onChoice={setChoice} onDate={setDate} />
              <label className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
                Old key
                <select value={overlap} onChange={(event) => setOverlap(Number(event.target.value))} className="rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 text-[11px] text-[#E6EDF3]">
                  {OVERLAP_CHOICES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <Button tone="primary" type="submit" disabled={busy || !expiry.ok}>Rotate key</Button>
              <Button onClick={onCancelRotate}>Cancel</Button>
              <div className="basis-full text-[10px] text-[#7E8A98]">
                The replacement's expiry is its own; it is not copied from the old key. The old key never outlives its own expiry.
              </div>
              {!expiry.ok && <div className="basis-full text-[10px] text-[#FCA5A5]">{expiry.error}</div>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function ExpiryPicker({ label, choice, date, onChoice, onDate }: {
  label: string; choice: ExpiryChoice; date: string; onChoice: (choice: ExpiryChoice) => void; onDate: (date: string) => void;
}) {
  const selectId = useId();
  const dateId = useId();
  return (
    <div className="flex items-end gap-2">
      <label htmlFor={selectId} className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
        {label}
        <select id={selectId} value={choice} onChange={(event) => onChoice(event.target.value as ExpiryChoice)} className="rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 text-[11px] text-[#E6EDF3]">
          {EXPIRY_CHOICES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {choice === "custom" && (
        <label htmlFor={dateId} className="flex flex-col gap-1 text-[10px] text-[#9AA6B2]">
          Date
          <input id={dateId} type="date" value={date} onChange={(event) => onDate(event.target.value)} className="rounded-md border border-[#2A3441] bg-[#10161F] px-2 py-1 text-[11px] text-[#E6EDF3]" />
        </label>
      )}
    </div>
  );
}
