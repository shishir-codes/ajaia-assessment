// Small display helpers shared by the home list, the editor and the share dialog.

let relative = null;
try {
  relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
} catch {
  relative = null;
}

export function timeAgo(iso, now = Date.now()) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const seconds = (time - now) / 1000; // negative for the past
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (relative) {
    if (abs < 45 * 60) return relative.format(Math.round(seconds / 60), 'minute');
    if (abs < 22 * 3600) return relative.format(Math.round(seconds / 3600), 'hour');
    if (abs < 6 * 86400) return relative.format(Math.round(seconds / 86400), 'day');
  }
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fullDate(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return letters.toUpperCase();
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || name;
}

const AVATAR_COLORS = ['#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c', '#047857', '#4338ca'];

export function avatarColor(key) {
  let hash = 0;
  for (const ch of String(key || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
