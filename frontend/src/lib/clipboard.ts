/**
 * Copy text in both secure browser contexts and local-LAN HTTP deployments.
 *
 * The modern Clipboard API is intentionally restricted to secure contexts in
 * most browsers. Aeolus is often opened directly from a Raspberry Pi over
 * plain HTTP, so copy buttons need a small legacy fallback rather than silently
 * doing nothing when `navigator.clipboard` is unavailable or denied.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through. Permissions and non-secure LAN origins can reject here.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("Clipboard copy command was rejected");
  } finally {
    textarea.remove();
  }
}
