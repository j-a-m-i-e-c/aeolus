// frontend/src/components/endpoints/RoutesSection.tsx — the endpoints the saved source
// declares, its compile errors, and a starting point when it declares none.

import type { EndpointStatus } from "../../lib/project-api";
import { displayPath, EXAMPLE_HANDLER, EXAMPLE_MANIFEST } from "./endpoint-format";
import { CodeBlock, Notice, Pill, Section } from "./ui";

export function RoutesSection({ status }: { status: EndpointStatus }) {
  const published = new Set(status.published?.routeIds ?? []);
  return (
    <Section
      title="Declared routes"
      hint={<>From the saved source: <code className="font-mono">api/routes.json</code> and the handlers it names. Read-only GET routes; each runs in its own sandbox with read access to this automation's state only.</>}
    >
      {status.compileErrors && (
        <div className="mb-3 space-y-1">
          <Notice tone="error">The saved project does not compile, so it cannot be published. Fix these and save:</Notice>
          <ul className="space-y-0.5">
            {status.compileErrors.map((error, index) => (
              <li key={`${error.path}-${error.line}-${index}`} className="font-mono text-[10px] text-[#FCA5A5]">
                {error.path ?? "project"}:{error.line}:{error.column} {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.declared ? (
        <div className="space-y-2">
          <table className="w-full text-left text-[10px]">
            <thead className="text-[9px] uppercase tracking-[0.12em] text-[#6B7785]">
              <tr><th className="py-1 pr-2 font-medium">Method</th><th className="py-1 pr-2 font-medium">Path</th><th className="py-1 pr-2 font-medium">Route id</th><th className="py-1 pr-2 font-medium">Handler</th><th className="py-1 font-medium">Published</th></tr>
            </thead>
            <tbody>
              {status.declared.routes.map((route) => (
                <tr key={route.id} className="border-t border-[#202A36] align-top">
                  <td className="py-1.5 pr-2 font-mono text-[#5CE1E6]">{route.method}</td>
                  <td className="py-1.5 pr-2">
                    <div className="font-mono text-[#E6EDF3]">{displayPath(route.path)}</div>
                    {route.description && <div className="text-[#7E8A98]">{route.description}</div>}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[#7E8A98] hover:text-[#B9C4CF]">Response schema</summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-[#0B0F14] p-2 text-[9px] text-[#B9C4CF]">{JSON.stringify(route.response, null, 2)}</pre>
                    </details>
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-[#B9C4CF]">{route.id}</td>
                  <td className="py-1.5 pr-2 font-mono text-[#B9C4CF]">{route.handler}</td>
                  <td className="py-1.5">{published.has(route.id) ? <Pill tone="ok">In snapshot</Pill> : <Pill tone="off">Not published</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-[#7E8A98]">
            Files in the API bundle: {status.declared.files.map((file) => <code key={file} className="mr-1.5 font-mono text-[#9AA6B2]">{file}</code>)}
          </div>
        </div>
      ) : !status.compileErrors && (
        <div className="space-y-3">
          <Notice tone="info">
            This project declares no endpoints. Add these two files with Files → New, adapt them, and save. Handlers may import from
            <code className="mx-1 font-mono">api/</code>and<code className="mx-1 font-mono">lib/</code>only.
          </Notice>
          <div className="text-[10px] font-semibold text-[#9AA6B2]">api/routes.json</div>
          <CodeBlock code={EXAMPLE_MANIFEST} copyLabel="Copy example api/routes.json" />
          <div className="text-[10px] font-semibold text-[#9AA6B2]">api/handlers.ts</div>
          <CodeBlock code={EXAMPLE_HANDLER} copyLabel="Copy example api/handlers.ts" />
        </div>
      )}
    </Section>
  );
}
