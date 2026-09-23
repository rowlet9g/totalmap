const KEY = 'totalmap-v1';
const empty = () => ({ version: 1, captures: [], input: null });
export const isExtension = Boolean(globalThis.chrome?.runtime?.id);
export async function load() {
  if (isExtension) return (await chrome.storage.local.get(KEY))[KEY] ?? empty();
  try { return JSON.parse(localStorage.getItem(KEY)) ?? empty(); } catch { return empty(); }
}
export async function save(value) {
  if (isExtension) await chrome.storage.local.set({ [KEY]: value });
  else localStorage.setItem(KEY, JSON.stringify(value));
}
export function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
