// Types for credential-scan.mjs, so e2e/global-teardown.ts can import it.
export const API_KEY_PATTERN: RegExp;
export function findKeys(buffer: Buffer, label?: string, depth?: number, speculative?: boolean): string[];
export function scanPaths(roots: string[]): { scanned: number; findings: string[] };
export function readZip(buffer: Buffer): {
  error?: string;
  entries: Array<{ name: string; data: Buffer; error?: undefined } | { name: string; error: string; data?: undefined }>;
};
