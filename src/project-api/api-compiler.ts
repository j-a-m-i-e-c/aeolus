// src/project-api/api-compiler.ts — compile a Project API's handlers (ADR-0027).
//
// The handlers are a separate bundle from the project's Logic. The Logic bundle
// registers `automation()` and runs every imported file's top-level code, and esbuild
// drops a named export nothing imports, so it cannot provide handlers. This bundle:
//
//   - starts from a generated entry that imports exactly the handlers the manifest
//     names, so a handler the manifest promises but the source does not export is a
//     compile error, not a runtime 500;
//   - may only reach files under api/ and lib/. Every import in the graph is resolved
//     through the plugin below, so the whole graph is checked, including imports made
//     by lib/ files. Nothing from logic/ or ui/ and no packages, which keeps the
//     project's Logic (and its top-level side effects) out of request handling;
//   - is never executed here. esbuild only parses and transforms.
//
// Called from compileAutomationProject() on every save, for validation. What is served
// is a published snapshot of this output (publication-store.ts), never the live result.

import { createHash } from "node:crypto";
import path from "node:path";
import { build, type Loader, type Message, type Plugin } from "esbuild";
import type { AutomationProjectFile } from "../automations/automation-project.js";
import { AutomationProjectCompileError, type ProjectCompileError } from "../automations/project-compile-error.js";
import { API_MANIFEST_PATH, parseApiManifest, type ApiManifest, type CompiledApiRoute } from "./manifest.js";

export const API_HANDLERS_ENTRY = "api/handlers.ts";
/** Directories an API bundle may import from. lib/ is for code shared with Logic. */
export const API_IMPORT_ROOTS = ["api/", "lib/"] as const;
/** Global the bundle publishes its handler table on, read by the API bootstrap. */
export const API_HANDLER_TABLE = "__aeolusApi";

const ENTRY = "__aeolus_api_entry__";
const EXTENSIONS = [".ts", ".js", ".json"];
// Resolution also looks for the UI's file types, so importing ui/index reports that
// it is outside api/ and lib/ rather than that it does not exist.
const RESOLVABLE = [...EXTENSIONS, ".tsx", ".jsx"];

export interface CompiledProjectApi {
  manifest: ApiManifest;
  routes: CompiledApiRoute[];
  /** IIFE script for isolated-vm. Publishes {@link API_HANDLER_TABLE}. */
  bundle: string;
  /** The manifest and every file in the handlers' import graph, sorted by path. */
  sources: AutomationProjectFile[];
  /** {@link hashSources} of `sources`: what a publication snapshot approves. */
  contentHash: string;
  /** SHA-256 of `bundle`, checked before a stored snapshot is executed. */
  bundleHash: string;
}

const insideRoots = (file: string) => API_IMPORT_ROOTS.some((root) => file.startsWith(root));

function apiPlugin(files: Map<string, string>, handlers: string[]): Plugin {
  return {
    name: "aeolus-project-api",
    setup(buildApi) {
      buildApi.onResolve({ filter: new RegExp(`^${ENTRY}$`) }, () => ({ path: ENTRY, namespace: "aeolus-api" }));
      buildApi.onResolve({ filter: /.*/, namespace: "aeolus-api" }, (args) => {
        const spec = args.path;
        if (!spec.startsWith(".")) return { errors: [{ text: `API code may only import project files under api/ or lib/, not packages: ${spec}` }] };
        const base = args.importer === ENTRY ? "" : path.posix.dirname(args.importer);
        const requested = path.posix.normalize(path.posix.join(base, spec));
        if (requested === ".." || requested.startsWith("../")) return { errors: [{ text: `Import escapes Automation Project: ${spec}` }] };
        const found = [requested, ...RESOLVABLE.map((ext) => requested + ext), ...RESOLVABLE.map((ext) => `${requested}/index${ext}`)]
          .find((candidate) => files.has(candidate));
        if (!found) return { errors: [{ text: `Project import not found: ${spec} from ${args.importer}` }] };
        if (!insideRoots(found)) {
          return { errors: [{ text: `API code may only import files under api/ or lib/: ${found} is outside them` }] };
        }
        if (!EXTENSIONS.includes(path.posix.extname(found))) {
          return { errors: [{ text: `API code may only import .ts, .js or .json files: ${found}` }] };
        }
        return { path: found, namespace: "aeolus-api" };
      });
      buildApi.onLoad({ filter: /.*/, namespace: "aeolus-api" }, (args) => {
        if (args.path === ENTRY) {
          const imports = handlers.map((name, i) => `${name} as h${i}`).join(", ");
          const table = handlers.map((name, i) => `${JSON.stringify(name)}: h${i}`).join(", ");
          return {
            contents: `import { ${imports} } from ${JSON.stringify("./" + API_HANDLERS_ENTRY)};\n`
              + `globalThis.${API_HANDLER_TABLE} = Object.freeze({ ${table} });`,
            loader: "ts",
            resolveDir: "/",
          };
        }
        const contents = files.get(args.path);
        if (contents === undefined) return { errors: [{ text: `Project file not found: ${args.path}` }] };
        const ext = path.posix.extname(args.path);
        const loader: Loader = ext === ".json" ? "json" : ext === ".js" ? "js" : "ts";
        return { contents, loader, resolveDir: `/${path.posix.dirname(args.path)}` };
      });
    },
  };
}

function mapErrors(messages: Message[]): ProjectCompileError[] {
  return messages.map((msg) => ({
    // esbuild prefixes a plugin namespace ("aeolus-api:api/handlers.ts").
    path: msg.location?.file?.replace(/^aeolus-api:/, "") || undefined,
    line: msg.location?.line ?? 1,
    column: msg.location?.column ?? 0,
    message: msg.text,
  }));
}

/**
 * Compile a project's API, or return null when it declares none. Files are assumed
 * already normalized and size-checked by compileAutomationProject().
 */
export async function compileProjectApi(files: AutomationProjectFile[]): Promise<CompiledProjectApi | null> {
  const map = new Map(files.map((file) => [file.path, file.content]));
  const manifestSource = map.get(API_MANIFEST_PATH);
  // The manifest alone declares an API. Projects saved before Project APIs may hold
  // files under api/ for their own reasons; without a manifest those stay ordinary
  // project files and the project compiles exactly as before.
  if (manifestSource === undefined) return null;
  const { manifest, routes } = parseApiManifest(manifestSource);
  if (!map.has(API_HANDLERS_ENTRY)) {
    throw new AutomationProjectCompileError([{ path: API_MANIFEST_PATH, line: 1, column: 0, message: `Handlers file not found: ${API_HANDLERS_ENTRY}` }]);
  }

  const handlers = [...new Set(routes.map((route) => route.handler))];
  let bundle: string;
  let graph: string[];
  try {
    const result = await build({
      entryPoints: [ENTRY],
      bundle: true,
      write: false,
      target: "es2022",
      platform: "neutral",
      format: "iife",
      // Authored files are ES modules, which are strict; an IIFE script is not unless
      // told. Without this, writing to the frozen `state` or request is silently
      // ignored instead of throwing.
      banner: { js: '"use strict";' },
      sourcemap: false,
      logLevel: "silent",
      metafile: true,
      plugins: [apiPlugin(map, handlers)],
    });
    bundle = result.outputFiles[0]?.text ?? "";
    // Every project file esbuild loaded, i.e. the whole transitive import graph.
    graph = Object.keys(result.metafile?.inputs ?? {})
      .map((input) => input.replace(/^aeolus-api:/, ""))
      .filter((file) => file !== ENTRY && map.has(file));
  } catch (error) {
    const failure = error as { errors?: Message[] };
    if (failure.errors?.length) throw new AutomationProjectCompileError(mapErrors(failure.errors));
    throw error;
  }

  const sources = [API_MANIFEST_PATH, ...graph]
    .filter((file, i, all) => all.indexOf(file) === i)
    .sort()
    .map((file) => ({ path: file, content: map.get(file)! }));
  return { manifest, routes, bundle, sources, contentHash: hashSources(sources), bundleHash: sha256(bundle) };
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Identity of what an admin reviews: the manifest and the source of every file in the
 * handlers' import graph, by path. Source rather than bundle, so an esbuild upgrade
 * that changes the output byte for byte does not read as an unreviewed code change.
 */
export function hashSources(sources: AutomationProjectFile[]): string {
  const hash = createHash("sha256");
  for (const { path: file, content } of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file).update("\0").update(String(Buffer.byteLength(content, "utf8"))).update("\0").update(content);
  }
  return hash.digest("hex");
}
