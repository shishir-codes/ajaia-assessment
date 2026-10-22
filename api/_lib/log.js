// One JSON line per event, so Vercel's log search can filter on fields.
// Never log document content, file contents or secrets.

const SECRET_PATTERN = /(sk-[A-Za-z0-9_*-]{6,}|Bearer\s+\S+|postgres(?:ql)?:\/\/\S+)/gi;

export function scrub(text) {
  return String(text ?? '').replace(SECRET_PATTERN, '[redacted]');
}

export function log(level, fields) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
