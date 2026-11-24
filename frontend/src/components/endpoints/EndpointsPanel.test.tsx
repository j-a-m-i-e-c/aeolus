import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  ApiClientDetail, ApiClientSummary, ApiCredential, ApiGrantWithClient, ApiRouteInfo, AuditEvent, EndpointStatus, IssuedKey,
} from "../../lib/project-api";

const api = vi.hoisted(() => ({
  fetchEndpointStatus: vi.fn(), fetchApiGrants: vi.fn(), fetchClients: vi.fn(), fetchApiAudit: vi.fn(),
  setApiSlug: vi.fn(), publishApi: vi.fn(), unpublishApi: vi.fn(), grantRoute: vi.fn(), revokeRouteGrant: vi.fn(),
  createClient: vi.fn(), fetchClient: vi.fn(), setClientEnabled: vi.fn(), issueKey: vi.fn(), rotateKey: vi.fn(), revokeKey: vi.fn(),
  fetchOpenApiDocument: vi.fn(), tryRoute: vi.fn(),
}));
const clip = vi.hoisted(() => ({ copyTextToClipboard: vi.fn() }));
const env = vi.hoisted(() => ({ API_URL: "http://aeolus.local:3001", PUBLIC_DEMO: false }));
vi.mock("../../lib/project-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/project-api")>()), ...api }));
vi.mock("../../lib/clipboard", () => clip);
vi.mock("../../lib/env", () => env);

import { ProjectApiRequestError } from "../../lib/project-api";
import { EndpointsPanel } from "./EndpointsPanel";

const NOW = Date.UTC(2026, 10, 24, 9);
const DAY = 24 * 3600 * 1000;
const HASH = "c0ffee".padEnd(64, "0");
const ROUTES: ApiRouteInfo[] = [
  { id: "level", method: "GET", path: "/level", handler: "getLevel", description: "Current level", response: { type: "object" } },
  { id: "tank", method: "GET", path: "/tanks/:id", handler: "getTank", response: { type: "object", properties: { level: { type: "number" } } } },
];
const SECRET = "aeo_0123456789abcdef_S3cretS3cretS3cretS3cretS3cretS3cretS3cr";

function status(over: Partial<EndpointStatus> = {}): EndpointStatus {
  return {
    automationId: "a1",
    revision: 4,
    declared: { contentHash: HASH, routes: ROUTES, files: ["api/handlers.ts", "api/routes.json"] },
    compileErrors: null,
    api: { id: "api-1", slug: "tank-levels", path: "/api/exposed/v1/tank-levels" },
    published: { id: "snap-1", apiId: "api-1", automationRevision: 4, runtimeContract: 1, contentHash: HASH, bundleHash: "b", publishedBy: "u", publishedAt: NOW - DAY, routeIds: ["level", "tank"] },
    publishedRoutes: ROUTES,
    routeChanges: [{ routeId: "level", change: "unchanged" }, { routeId: "tank", change: "unchanged" }],
    unpublishedChanges: false,
    status: "serving",
    lastPublicationEvent: { action: "api.published", at: NOW - DAY, actorUsername: "admin", reason: null },
    ...over,
  };
}
const client = (over: Partial<ApiClientSummary> = {}): ApiClientSummary => ({
  id: "c1", name: "Remote farm", status: "active", createdBy: "u", createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY, activeKeys: 1, activeGrants: 1, ...over,
});
const grant = (over: Partial<ApiGrantWithClient> = {}): ApiGrantWithClient => ({
  id: "g1", clientId: "c1", apiId: "api-1", routeId: "level", routeFingerprint: "f", access: "read", grantedBy: "u", grantedAt: NOW - DAY,
  revokedAt: null, revokedBy: null, revokeReason: null, clientName: "Remote farm", clientStatus: "active", ...over,
});
const credential = (over: Partial<ApiCredential> = {}): ApiCredential => ({
  id: "k1", clientId: "c1", keyId: "0123456789abcdef", last4: "S3cr", expiresAt: NOW + 30 * DAY, revokedAt: null, lastUsedAt: NOW - 3600_000, createdBy: "u", createdAt: NOW - DAY, ...over,
});
const issued = (over: Partial<ApiCredential> = {}): IssuedKey => ({ key: SECRET, credential: credential({ id: "k2", ...over }) });

function serve({ s = status(), grants = [grant()], clients = [client()], audit = [] as AuditEvent[], detail }: {
  s?: EndpointStatus; grants?: ApiGrantWithClient[]; clients?: ApiClientSummary[]; audit?: AuditEvent[]; detail?: ApiClientDetail;
} = {}) {
  api.fetchEndpointStatus.mockResolvedValue(s);
  api.fetchApiGrants.mockResolvedValue(grants);
  api.fetchClients.mockResolvedValue(clients);
  api.fetchApiAudit.mockResolvedValue(audit);
  api.fetchClient.mockResolvedValue(detail ?? { client: clients[0], credentials: [credential()], grants: [grant()] });
}

const show = (props: Partial<Parameters<typeof EndpointsPanel>[0]> = {}) =>
  render(<EndpointsPanel automationId="a1" savedRevision={4} unsavedChanges={false} {...props} />);
const region = async (name: string) => within(await screen.findByRole("region", { name }));
const dialog = () => within(screen.getByRole("alertdialog"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const fn of Object.values(api)) fn.mockReset();
  clip.copyTextToClipboard.mockReset().mockResolvedValue(undefined);
  env.API_URL = "http://aeolus.local:3001";
  serve();
});
afterEach(() => { vi.useRealTimers(); });

describe("loading", () => {
  it("shows a loading state, then the sections", async () => {
    show();
    expect(screen.getByText(/Loading endpoints/)).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Publication" })).toBeInTheDocument();
    for (const name of ["Declared routes", "Access", "API clients", "Calling the API", "Activity"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(api.fetchApiAudit).toHaveBeenCalledWith("api-1");
  });

  it("reports a failed load and retries", async () => {
    api.fetchEndpointStatus.mockRejectedValueOnce(new Error("Forbidden"));
    show();
    expect(await screen.findByText(/Endpoints could not be loaded: Forbidden/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByRole("region", { name: "Publication" })).toBeInTheDocument();
  });

  it("re-reads after a save, on Refresh, and reports a failed refresh without losing the view", async () => {
    const { rerender } = show();
    await screen.findByRole("region", { name: "Publication" });
    rerender(<EndpointsPanel automationId="a1" savedRevision={5} unsavedChanges={false} />);
    await waitFor(() => expect(api.fetchEndpointStatus).toHaveBeenCalledTimes(2));
    api.fetchEndpointStatus.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh endpoints" }));
    expect(await screen.findByText(/Could not refresh: offline/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Publication" })).toBeInTheDocument();
  });

  it("skips the audit read when there is no API yet", async () => {
    serve({ s: status({ api: null, published: null, publishedRoutes: null, routeChanges: [], status: "no-api", lastPublicationEvent: null }), grants: [] });
    show();
    await screen.findByRole("region", { name: "Publication" });
    expect(api.fetchApiAudit).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Activity" })).not.toBeInTheDocument();
  });
});

describe("source and publication", () => {
  it("separates the editable saved source from the immutable snapshot", async () => {
    show();
    const pub = (await region("Publication"));
    expect(await pub.findByText("Saved source · editable")).toBeInTheDocument();
    expect(pub.getByText("Published snapshot · immutable")).toBeInTheDocument();
    expect(pub.getByText("Matches saved source")).toBeInTheDocument();
    expect(pub.getByText("/api/exposed/v1/tank-levels")).toBeInTheDocument();
    expect(pub.getByRole("button", { name: /Republish saved source/ })).toBeDisabled();
    expect(pub.getByText("Published and up to date.")).toBeInTheDocument();
    const routes = (await region("Declared routes"));
    expect(routes.getByText("/tanks/{id}")).toBeInTheDocument();
    expect(routes.getByText("Current level")).toBeInTheDocument();
    expect(routes.getAllByText("In snapshot")).toHaveLength(2);
  });

  it("warns that unsaved editor changes are not shown or published", async () => {
    show({ unsavedChanges: true });
    expect(await screen.findByText(/The editor has unsaved changes/)).toBeInTheDocument();
  });

  it("shows stale publication state and what a republish would do to each route", async () => {
    serve({
      s: status({
        unpublishedChanges: true,
        declared: { contentHash: "d".repeat(64), routes: [ROUTES[0]!, { ...ROUTES[1]!, id: "summary", path: "/summary" }], files: [] },
        routeChanges: [{ routeId: "level", change: "changed" }, { routeId: "tank", change: "removed" }, { routeId: "summary", change: "added" }],
      }),
      grants: [grant(), grant({ id: "g2", clientId: "c2", clientName: "Office", routeId: "level" }), grant({ id: "g3", routeId: "tank" })],
    });
    show();
    const pub = (await region("Publication"));
    expect(await pub.findByText("Unpublished changes")).toBeInTheDocument();
    expect(pub.getByText(/If you republish/)).toBeInTheDocument();
    expect(pub.getByText(/Contract changed.*revoked on republish.*\(2 grants\)/)).toBeInTheDocument();
    expect(pub.getByText(/Removed: its grants are revoked on republish \(1 grant\)/)).toBeInTheDocument();
    expect(pub.getByText(/New route: no client has access until you grant it/)).toBeInTheDocument();
    expect(pub.getByText("Republishing revokes 3 grants.")).toBeInTheDocument();
    expect((await region("Declared routes")).getByText("Not published")).toBeInTheDocument();

    fireEvent.click(pub.getByRole("button", { name: /Republish saved source/ }));
    expect(dialog().getByText(/these grants are revoked: Remote farm → level, Office → level, Remote farm → tank/)).toBeInTheDocument();
    expect(dialog().getByText(/New routes \(summary\) start with no access/)).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Cancel" })).toHaveFocus();
    api.publishApi.mockResolvedValue({});
    fireEvent.click(dialog().getByRole("button", { name: "Publish and revoke 3 grants" }));
    await waitFor(() => expect(api.publishApi).toHaveBeenCalledWith("a1", "d".repeat(64)));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Published revision 4.")).toBeInTheDocument();
  });

  it("publishes only the reviewed content hash, after confirmation", async () => {
    serve({ s: status({ published: null, publishedRoutes: null, routeChanges: [], status: "unpublished", lastPublicationEvent: null }), grants: [] });
    show({ unsavedChanges: true });
    const pub = (await region("Publication"));
    expect(await pub.findByText("Not published")).toBeInTheDocument();
    fireEvent.click(pub.getByRole("button", { name: /^Publish$/ }));
    expect(dialog().getByText(/approving revision 4 \(content/)).toBeInTheDocument();
    expect(dialog().getByText("Unsaved editor changes are not part of it.")).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Publish" })).toHaveFocus();
    // Cancelling publishes nothing.
    fireEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(api.publishApi).not.toHaveBeenCalled();
    fireEvent.click(pub.getByRole("button", { name: /^Publish$/ }));
    api.publishApi.mockResolvedValue({});
    fireEvent.click(dialog().getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.publishApi).toHaveBeenCalledWith("a1", HASH));
  });

  it("refuses to publish source that changed after review, and reloads", async () => {
    serve({ s: status({ unpublishedChanges: true, routeChanges: [] }) });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Republish saved source/ }));
    api.publishApi.mockRejectedValue(new ProjectApiRequestError(409, "changed", "content-changed"));
    const reads = api.fetchEndpointStatus.mock.calls.length;
    fireEvent.click(dialog().getByRole("button", { name: "Publish" }));
    expect(await screen.findByText(/changed after you reviewed it, so nothing was published/)).toBeInTheDocument();
    expect(api.fetchEndpointStatus.mock.calls.length).toBeGreaterThan(reads);
  });

  it("passes other publish failures through", async () => {
    serve({ s: status({ unpublishedChanges: true, routeChanges: [] }) });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Republish saved source/ }));
    api.publishApi.mockRejectedValue(new ProjectApiRequestError(400, "The project does not compile"));
    fireEvent.click(dialog().getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("The project does not compile")).toBeInTheDocument();
  });

  it("blocks publishing a project that does not compile, and lists the errors", async () => {
    serve({ s: status({ declared: null, compileErrors: [{ path: "api/routes.json", line: 1, column: 0, message: "routes[0].path must start with /" }] }) });
    show();
    expect(await screen.findByText(/api\/routes.json:1:0 routes\[0\].path must start with/)).toBeInTheDocument();
    expect(screen.getByText("Fix the compile errors first.")).toBeInTheDocument();
    expect(screen.getByText(/Does not compile; see the errors below/)).toBeInTheDocument();
  });

  it("offers an example manifest and handler when nothing is declared", async () => {
    serve({ s: status({ declared: null, api: null, published: null, publishedRoutes: null, routeChanges: [], status: "no-api", lastPublicationEvent: null }), grants: [] });
    show();
    const routes = (await region("Declared routes"));
    expect(await routes.findByText("api/routes.json", { selector: "div" })).toBeInTheDocument();
    expect(routes.getByText(/"handler": "getTank"/)).toBeInTheDocument();
    fireEvent.click(routes.getByRole("button", { name: "Copy example api/handlers.ts" }));
    await waitFor(() => expect(clip.copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining("export function getTank")));
    expect(await routes.findByText("Copied")).toBeInTheDocument();
    expect(screen.getByText("Create the API with a slug first.")).toBeInTheDocument();
    expect((await region("Access")).getByText(/Publish the API before granting access/)).toBeInTheDocument();
    expect((await region("Calling the API")).getByText(/Publish the API to get its URLs/)).toBeInTheDocument();
  });

  it("says when the copy fails", async () => {
    serve({ s: status({ declared: null, api: null, published: null, publishedRoutes: null, routeChanges: [], status: "no-api" }) });
    clip.copyTextToClipboard.mockRejectedValue(new Error("denied"));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Copy example api/routes.json" }));
    expect(await screen.findByText(/Copy failed/)).toBeInTheDocument();
  });

  it("asks for confirmation before unpublishing, and says grants are revoked for good", async () => {
    serve({ grants: [grant(), grant({ id: "g2", routeId: "tank" })] });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Unpublish/ }));
    const confirm = dialog();
    expect(confirm.getByText(/every grant to this API is revoked permanently/)).toBeInTheDocument();
    expect(confirm.getByText(/restores none of them/)).toBeInTheDocument();
    expect(confirm.getByText(/clients and their keys are not affected/i)).toBeInTheDocument();
    expect(confirm.getByText(/To pause serving temporarily instead, disable the automation/)).toBeInTheDocument();
    expect(confirm.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.unpublishApi).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Unpublish/ }));
    api.unpublishApi.mockResolvedValue({ success: true, revokedGrants: 2 });
    fireEvent.click(dialog().getByRole("button", { name: "Unpublish and revoke 2 grants" }));
    expect(await screen.findByText("Unpublished. 2 grants revoked.")).toBeInTheDocument();
    // Clients and keys are not touched by an unpublish.
    expect(api.revokeKey).not.toHaveBeenCalled();
    expect(api.setClientEnabled).not.toHaveBeenCalled();
  });

  it("unpublishes an API with no grants with a plain label", async () => {
    serve({ grants: [] });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Unpublish/ }));
    api.unpublishApi.mockResolvedValue({ success: true, revokedGrants: 1 });
    fireEvent.click(dialog().getByRole("button", { name: "Unpublish" }));
    expect(await screen.findByText("Unpublished. 1 grant revoked.")).toBeInTheDocument();
  });

  it("explains temporary unavailability apart from permanent unpublication", async () => {
    serve({ s: status({ status: "disabled" }) });
    show();
    expect(await screen.findByText("Temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByText(/This is temporary. It is not the same as unpublishing/)).toBeInTheDocument();
    // Republishing the same snapshot is allowed while it is not serving.
    expect(screen.getByRole("button", { name: /Republish saved source/ })).toBeEnabled();
  });

  it("explains a withdrawn approval", async () => {
    serve({ s: status({ status: "unpublished", published: null, publishedRoutes: null, lastPublicationEvent: { action: "api.approval.revoked", at: NOW, actorUsername: "user-management", reason: "publisher-demoted" } }), grants: [] });
    show();
    expect(await screen.findByText("Approval withdrawn")).toBeInTheDocument();
    expect(screen.getByText(/Regaining the admin role restores nothing/)).toBeInTheDocument();
  });
});

describe("slugs", () => {
  const noApi = () => status({ api: null, published: null, publishedRoutes: null, routeChanges: [], status: "no-api", lastPublicationEvent: null });

  it("creates the API with a valid slug", async () => {
    serve({ s: noApi(), grants: [] });
    show();
    const pub = (await region("Publication"));
    const input = await pub.findByLabelText("/api/exposed/v1/");
    fireEvent.change(input, { target: { value: "Bad--Slug" } });
    expect(pub.getByText("That slug is not allowed.")).toBeInTheDocument();
    expect(pub.getByRole("button", { name: "Create API" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "tank-levels" } });
    api.setApiSlug.mockResolvedValue({ id: "api-1", slug: "tank-levels" });
    serve();
    fireEvent.click(pub.getByRole("button", { name: "Create API" }));
    await waitFor(() => expect(api.setApiSlug).toHaveBeenCalledWith("a1", "tank-levels", false));
    expect(await screen.findByText("The API's URL is now /api/exposed/v1/tank-levels.")).toBeInTheDocument();
    expect(await pub.findByRole("button", { name: "Change slug" })).toBeInTheDocument();
  });

  it("warns that a retired slug belongs to a different API identity before reclaiming it", async () => {
    show();
    const pub = (await region("Publication"));
    fireEvent.click(await pub.findByRole("button", { name: "Change slug" }));
    fireEvent.change(pub.getByLabelText("/api/exposed/v1/"), { target: { value: "old-levels" } });
    expect(pub.getByText(/Changing it stops the current URL at once and retires it/)).toBeInTheDocument();
    api.setApiSlug.mockRejectedValueOnce(new ProjectApiRequestError(409, "retired", "slug-retired"));
    fireEvent.click(pub.getByRole("button", { name: "Save slug" }));
    expect(await pub.findByText(/belonged to a different API before/)).toBeInTheDocument();
    expect(pub.getByText(/Nothing carries over from the previous API: no publication, keys or\s+grants/)).toBeInTheDocument();

    fireEvent.click(pub.getByRole("button", { name: "Choose another slug" }));
    expect(pub.queryByText(/belonged to a different API before/)).not.toBeInTheDocument();

    api.setApiSlug.mockRejectedValueOnce(new ProjectApiRequestError(409, "retired", "slug-retired"));
    fireEvent.click(pub.getByRole("button", { name: "Save slug" }));
    api.setApiSlug.mockResolvedValueOnce({ id: "api-1", slug: "old-levels", reclaimedFrom: "9f8e7d6c-0000-0000-0000-000000000000" });
    fireEvent.click(await pub.findByRole("button", { name: "Reclaim “old-levels” for this API" }));
    await waitFor(() => expect(api.setApiSlug).toHaveBeenLastCalledWith("a1", "old-levels", true));
    expect(await screen.findByText(/Reclaimed “old-levels”. It previously belonged to API 9f8e7d6c; nothing from that API carried over./)).toBeInTheDocument();
  });

  it("reports other slug refusals and lets the change be cancelled", async () => {
    show();
    const pub = (await region("Publication"));
    fireEvent.click(await pub.findByRole("button", { name: "Change slug" }));
    fireEvent.change(pub.getByLabelText("/api/exposed/v1/"), { target: { value: "taken-one" } });
    api.setApiSlug.mockRejectedValueOnce(new ProjectApiRequestError(409, "Slug is already used by another API", "slug-taken"));
    fireEvent.submit(pub.getByLabelText("/api/exposed/v1/").closest("form")!);
    expect(await screen.findByText("Slug is already used by another API")).toBeInTheDocument();
    fireEvent.click(pub.getByRole("button", { name: "Cancel" }));
    expect(pub.getByRole("button", { name: "Change slug" })).toBeInTheDocument();
  });
});

describe("grants", () => {
  it("grants one published route to an active client, and only once", async () => {
    serve({ clients: [client(), client({ id: "c2", name: "Office", activeGrants: 0 }), client({ id: "c3", name: "Paused", status: "disabled" })] });
    show();
    const access = (await region("Access"));
    expect(await access.findByText(/Routes published later are never included/)).toBeInTheDocument();
    expect(access.getByText("No client has access.")).toBeInTheDocument();
    const [clientSelect, routeSelect] = access.getAllByRole("combobox");
    expect(within(clientSelect!).queryByText("Paused")).not.toBeInTheDocument();
    fireEvent.change(clientSelect!, { target: { value: "c1" } });
    fireEvent.change(routeSelect!, { target: { value: "level" } });
    expect(access.getByText("That client already has this route.")).toBeInTheDocument();
    expect(access.getByRole("button", { name: "Grant access" })).toBeDisabled();
    fireEvent.change(clientSelect!, { target: { value: "c2" } });
    api.grantRoute.mockResolvedValue({});
    fireEvent.click(access.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(api.grantRoute).toHaveBeenCalledWith("a1", "c2", "level"));
    expect(await screen.findByText("Office can now call level.")).toBeInTheDocument();
  });

  it("shows disabled clients' grants and asks before revoking one", async () => {
    serve({ grants: [grant({ clientStatus: "disabled" })], clients: [client({ status: "disabled" })] });
    show();
    const access = (await region("Access"));
    expect(await access.findByText("Client disabled")).toBeInTheDocument();
    expect(access.getByText("Create an active API client below first.")).toBeInTheDocument();
    fireEvent.click(access.getByRole("button", { name: "Revoke Remote farm's access to level" }));
    expect(dialog().getByText(/next request to this route gets 404/)).toBeInTheDocument();
    api.revokeRouteGrant.mockResolvedValue({ revoked: true });
    fireEvent.click(dialog().getByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(api.revokeRouteGrant).toHaveBeenCalledWith("a1", "c1", "level"));
    expect(await screen.findByText("Revoked Remote farm's access to level.")).toBeInTheDocument();
  });
});

describe("clients and keys", () => {
  const openClient = async (name = "Remote farm") => {
    const clients = (await region("API clients"));
    fireEvent.click(await clients.findByRole("button", { name: new RegExp(name) }));
    return clients;
  };

  it("creates a client", async () => {
    show();
    const clients = (await region("API clients"));
    const name = await clients.findByLabelText("New client name");
    expect(clients.getByRole("button", { name: /Create client/ })).toBeDisabled();
    fireEvent.change(name, { target: { value: "  Office Aeolus " } });
    api.createClient.mockResolvedValue({ name: "Office Aeolus" });
    fireEvent.click(clients.getByRole("button", { name: /Create client/ }));
    await waitFor(() => expect(api.createClient).toHaveBeenCalledWith("Office Aeolus"));
    expect(await screen.findByText(/Created client Office Aeolus/)).toBeInTheDocument();
    expect(name).toHaveValue("");
  });

  it("lists no clients", async () => {
    serve({ clients: [] });
    show();
    expect(await screen.findByText("No API clients yet.")).toBeInTheDocument();
  });

  it("shows only safe key details: id, last four, dates and state", async () => {
    serve({ detail: { client: client(), credentials: [
      credential(),
      credential({ id: "k2", keyId: "1111111111111111", expiresAt: NOW - 1000 }),
      credential({ id: "k3", keyId: "2222222222222222", revokedAt: NOW - DAY, expiresAt: null, lastUsedAt: null }),
    ], grants: [grant(), grant({ id: "g9", apiId: "api-other", revokedAt: NOW, revokeReason: "unpublished" })] } });
    show();
    const clients = await openClient();
    expect(await clients.findByText("aeo_0123456789abcdef_…S3cr")).toBeInTheDocument();
    expect(clients.getByText("active")).toBeInTheDocument();
    expect(clients.getByText("expired")).toBeInTheDocument();
    expect(clients.getByText(/^Revoked /)).toBeInTheDocument();
    expect(clients.getAllByText("never", { selector: "td" })).toHaveLength(2);
    // Only an active key can be rotated or revoked.
    expect(clients.getAllByRole("button", { name: /^Rotate key/ })).toHaveLength(1);
    expect(clients.getByText(/on this API/)).toBeInTheDocument();
    expect(clients.getByText(/on another API/)).toBeInTheDocument();
    expect(clients.getByText(/revoked .*\(unpublished\)/)).toBeInTheDocument();
    fireEvent.click(clients.getByRole("button", { name: /Remote farm/ }));
    expect(clients.queryByText("aeo_0123456789abcdef_…S3cr")).not.toBeInTheDocument();
  });

  it("reports a client that cannot be loaded, and a client with nothing yet", async () => {
    api.fetchClient.mockRejectedValueOnce(new Error("API client not found"));
    show();
    const clients = await openClient();
    expect(await clients.findByText("API client not found")).toBeInTheDocument();
    serve({ detail: { client: client(), credentials: [], grants: [] } });
    fireEvent.click(clients.getByRole("button", { name: /Remote farm/ }));
    fireEvent.click(clients.getByRole("button", { name: /Remote farm/ }));
    expect(await clients.findByText("No keys issued.")).toBeInTheDocument();
    expect(clients.getByText("No grants.")).toBeInTheDocument();
  });

  it("issues a key with an explicit expiry and reveals it exactly once", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    show();
    const clients = await openClient();
    const expiry = await clients.findByLabelText("New key expires");
    expect(expiry).toHaveValue("90");
    fireEvent.change(expiry, { target: { value: "30" } });
    api.issueKey.mockResolvedValue(issued({ expiresAt: NOW + 30 * DAY }));
    fireEvent.click(clients.getByRole("button", { name: "Issue key" }));
    await waitFor(() => expect(api.issueKey).toHaveBeenCalledWith("c1", NOW + 30 * DAY));

    const reveal = within(await screen.findByRole("dialog", { name: "New API key for Remote farm" }));
    expect(reveal.getByLabelText("API key")).toHaveValue(SECRET);
    expect(reveal.getByText(/cannot be shown again/)).toBeInTheDocument();
    fireEvent.click(reveal.getByRole("button", { name: "Copy API key" }));
    await waitFor(() => expect(clip.copyTextToClipboard).toHaveBeenCalledWith(SECRET));
    fireEvent.click(reveal.getByRole("button", { name: "I have saved the key" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRET.slice(21));
    for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET.slice(21));
    expect(JSON.stringify(localStorage)).not.toContain(SECRET.slice(21));
    expect(JSON.stringify(sessionStorage)).not.toContain(SECRET.slice(21));
  });

  it("issues a key that never expires, or until a chosen date", async () => {
    show();
    const clients = await openClient();
    const expiry = await clients.findByLabelText("New key expires");
    fireEvent.change(expiry, { target: { value: "custom" } });
    expect(clients.getByText("Choose the date the key should stop working.")).toBeInTheDocument();
    expect(clients.getByRole("button", { name: "Issue key" })).toBeDisabled();
    fireEvent.change(clients.getByLabelText("Date"), { target: { value: "2027-01-31" } });
    api.issueKey.mockResolvedValue(issued({ expiresAt: null }));
    fireEvent.click(clients.getByRole("button", { name: "Issue key" }));
    await waitFor(() => expect(api.issueKey).toHaveBeenCalledWith("c1", new Date("2027-01-31T23:59:59").getTime()));
    expect(within(await screen.findByRole("dialog")).getByText(/Expires: never/)).toBeInTheDocument();
  });

  it("rotates with a separately chosen new expiry and old-key overlap", async () => {
    show();
    const clients = await openClient();
    fireEvent.click(await clients.findByRole("button", { name: "Rotate key 0123456789abcdef" }));
    expect(clients.getByText(/not copied from the old key/)).toBeInTheDocument();
    fireEvent.change(clients.getByLabelText("Replacement expires"), { target: { value: "never" } });
    fireEvent.change(clients.getByRole("combobox", { name: "Old key" }), { target: { value: String(24 * 3600) } });
    api.rotateKey.mockResolvedValue(issued());
    fireEvent.click(clients.getByRole("button", { name: "Rotate key" }));
    await waitFor(() => expect(api.rotateKey).toHaveBeenCalledWith("c1", "k1", null, 24 * 3600));
    expect(await screen.findByRole("dialog", { name: "Replacement key for Remote farm" })).toBeInTheDocument();
  });

  it("refuses a rotation to a past date, and can be cancelled", async () => {
    show();
    const clients = await openClient();
    fireEvent.click(await clients.findByRole("button", { name: "Rotate key 0123456789abcdef" }));
    fireEvent.change(clients.getByLabelText("Replacement expires"), { target: { value: "custom" } });
    fireEvent.change(clients.getByLabelText("Date"), { target: { value: "2020-01-01" } });
    expect(clients.getByText("Choose a date in the future.")).toBeInTheDocument();
    expect(clients.getByRole("button", { name: "Rotate key" })).toBeDisabled();
    fireEvent.click(clients.getByRole("button", { name: "Cancel" }));
    expect(clients.getByRole("button", { name: "Rotate key 0123456789abcdef" })).toBeInTheDocument();
    expect(api.rotateKey).not.toHaveBeenCalled();
  });

  it("asks before revoking a key", async () => {
    show();
    const clients = await openClient();
    fireEvent.click(await clients.findByRole("button", { name: "Revoke key 0123456789abcdef" }));
    expect(dialog().getByText(/refused \(401\) from the next one/)).toBeInTheDocument();
    api.revokeKey.mockResolvedValue({});
    fireEvent.click(dialog().getByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(api.revokeKey).toHaveBeenCalledWith("c1", "k1"));
    expect(await screen.findByText("Revoked key aeo_0123456789abcdef_…S3cr.")).toBeInTheDocument();
  });

  it("asks before disabling a client, says it is temporary, and enables without asking", async () => {
    show();
    const clients = (await region("API clients"));
    fireEvent.click(await clients.findByRole("button", { name: "Disable" }));
    expect(dialog().getByText(/This is temporary: its keys and grants are kept/)).toBeInTheDocument();
    api.setClientEnabled.mockResolvedValue({});
    fireEvent.click(dialog().getByRole("button", { name: "Disable client" }));
    await waitFor(() => expect(api.setClientEnabled).toHaveBeenCalledWith("c1", false));
    expect(await screen.findByText("Remote farm is disabled.")).toBeInTheDocument();

    serve({ clients: [client({ status: "disabled" })] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh endpoints" }));
    fireEvent.click(await clients.findByRole("button", { name: "Enable" }));
    await waitFor(() => expect(api.setClientEnabled).toHaveBeenCalledWith("c1", true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Remote farm is enabled again.")).toBeInTheDocument();
  });

  it("does not issue keys to a disabled client", async () => {
    serve({ clients: [client({ status: "disabled" })] });
    show();
    const clients = await openClient();
    expect(await clients.findByText(/every key of this client is refused/)).toBeInTheDocument();
    expect(clients.getByRole("button", { name: "Issue key" })).toBeDisabled();
    expect(clients.getByText("Enable the client to issue keys.")).toBeInTheDocument();
  });

  it("reports a failed action and keeps the view", async () => {
    show();
    const clients = await openClient();
    api.issueKey.mockRejectedValue(new ProjectApiRequestError(409, "A client may hold at most 10 active keys"));
    fireEvent.click(await clients.findByRole("button", { name: "Issue key" }));
    expect(await screen.findByText("A client may hold at most 10 active keys")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("calling the API", () => {
  it("shows effective URLs and curl examples with a placeholder key, and warns about plain HTTP", async () => {
    show();
    const dev = (await region("Calling the API"));
    expect(await dev.findByText("http://aeolus.local:3001/api/exposed/v1/tank-levels/tanks/{id}")).toBeInTheDocument();
    expect(dev.getAllByText(/\$AEOLUS_API_KEY/)).toHaveLength(2);
    expect(dev.getByText(/crosses the network\s+unencrypted/)).toBeInTheDocument();
    expect(dev.getByText(/private LAN or a VPN/)).toBeInTheDocument();
    for (const code of ["401", "404", "429", "500", "503", "504"]) expect(dev.getByText(code)).toBeInTheDocument();
  });

  it("says HTTPS is in use when it is", async () => {
    env.API_URL = "https://aeolus.example";
    show();
    expect(await screen.findByText(/Served over HTTPS/)).toBeInTheDocument();
  });

  it("generates and offers the OpenAPI document of the snapshot", async () => {
    const create = vi.fn(() => "blob:openapi");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    api.fetchOpenApiDocument.mockResolvedValue('{ "openapi": "3.1.0" }');
    const { unmount } = show();
    const dev = (await region("Calling the API"));
    fireEvent.click(await dev.findByRole("button", { name: "Generate document" }));
    const link = await dev.findByRole("link", { name: /Download tank-levels.openapi.json/ });
    expect(link).toHaveAttribute("href", "blob:openapi");
    expect(link).toHaveAttribute("download", "tank-levels.openapi.json");
    expect(dev.getByText(/"openapi": "3.1.0"/)).toBeInTheDocument();
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:openapi");
  });

  it("reports a document that cannot be generated", async () => {
    api.fetchOpenApiDocument.mockRejectedValue(new Error("This automation has no published API"));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Generate document" }));
    expect(await screen.findByText("This automation has no published API")).toBeInTheDocument();
  });

  it("tests a route through the server with a key that is then cleared", async () => {
    show();
    const dev = (await region("Calling the API"));
    const send = await dev.findByRole("button", { name: /Send request/ });
    expect(send).toBeDisabled();
    fireEvent.change(dev.getByRole("combobox"), { target: { value: "tank" } });
    fireEvent.change(dev.getByLabelText("id"), { target: { value: " main " } });
    const key = dev.getByLabelText("API key");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("autocomplete", "off");
    fireEvent.change(key, { target: { value: SECRET } });
    api.tryRoute.mockResolvedValue({ path: "/api/exposed/v1/tank-levels/tanks/main", status: 200, durationMs: 12, requestId: "req-1", retryAfter: null, body: { level: 7 } });
    fireEvent.click(send);
    await waitFor(() => expect(api.tryRoute).toHaveBeenCalledWith("a1", "tank", { id: "main" }, SECRET));
    expect(await dev.findByText("200", { selector: "span" })).toBeInTheDocument();
    expect(dev.getByText(/"level": 7/)).toBeInTheDocument();
    expect(dev.getByText("request req-1")).toBeInTheDocument();
    fireEvent.click(dev.getByRole("button", { name: "Clear key" }));
    expect(key).toHaveValue("");
  });

  it("shows refusals and failures of a test request", async () => {
    show();
    const dev = (await region("Calling the API"));
    fireEvent.change(await dev.findByLabelText("API key"), { target: { value: "aeo_bad" } });
    api.tryRoute.mockResolvedValueOnce({ path: "/x", status: 429, durationMs: 1, requestId: null, retryAfter: "30", body: "Too many" });
    fireEvent.click(dev.getByRole("button", { name: /Send request/ }));
    expect(await dev.findByText("429", { selector: "span" })).toBeInTheDocument();
    expect(dev.getByText("Retry-After 30s")).toBeInTheDocument();
    expect(dev.getByText("Too many")).toBeInTheDocument();
    api.tryRoute.mockRejectedValueOnce(new Error("Publish the API before testing it"));
    fireEvent.click(dev.getByRole("button", { name: /Send request/ }));
    expect(await dev.findByText("Publish the API before testing it")).toBeInTheDocument();
  });
});

describe("activity", () => {
  it("lists recent changes with readable labels", async () => {
    serve({ audit: [
      { id: 3, at: NOW, actorUsername: "admin", action: "grant.revoked", clientId: "c1", credentialId: null, routeId: "tank", metadata: { reason: "route-changed" } },
      { id: 2, at: NOW - 1, actorUsername: "admin", action: "api.published", clientId: null, credentialId: null, routeId: null, metadata: {} },
      { id: 1, at: NOW - 2, actorUsername: "admin", action: "something.new", clientId: "gone", credentialId: null, routeId: null, metadata: {} },
    ] });
    show();
    const activity = (await region("Activity"));
    expect(await activity.findByText("Access revoked")).toBeInTheDocument();
    expect(activity.getByText("for Remote farm")).toBeInTheDocument();
    expect(activity.getByText("(route-changed)")).toBeInTheDocument();
    expect(activity.getByText("Published")).toBeInTheDocument();
    expect(activity.getByText("something.new")).toBeInTheDocument();
    expect(activity.getByText("for a client")).toBeInTheDocument();
  });

  it("says when nothing is recorded", async () => {
    show();
    expect(await screen.findByText("No changes recorded yet.")).toBeInTheDocument();
  });
});

describe("stale responses", () => {
  it("ignores a slow read that a newer one overtook", async () => {
    let resolveSlow: (value: EndpointStatus) => void = () => undefined;
    api.fetchEndpointStatus.mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }));
    api.fetchEndpointStatus.mockResolvedValueOnce(status({ revision: 9 }));
    const { rerender } = show();
    rerender(<EndpointsPanel automationId="a1" savedRevision={9} unsavedChanges={false} />);
    expect(await screen.findByText(/Revision 9/)).toBeInTheDocument();
    await act(async () => { resolveSlow(status({ revision: 1 })); });
    expect(screen.getByText(/Revision 9/)).toBeInTheDocument();
  });
});
