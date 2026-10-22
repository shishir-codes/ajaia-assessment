// Browser side calls to our own /api functions. Every request sends the session cookie and
// every failure becomes an ApiError with a message that is safe to show, including when the
// server answers with something that is not JSON (for example a hosting error page).

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// Shown for every 429, whichever limit was hit (saves, sharing, sign in, new documents).
export const RATE_LIMIT_MESSAGE = 'You are making changes very quickly. Please wait a moment and try again.';

const FALLBACK_MESSAGES = {
  400: 'That request was not valid. Please check it and try again.',
  401: 'Please sign in again.',
  403: 'You do not have permission to do that.',
  404: 'We could not find that. It may have been deleted, or you may not have access.',
  409: 'Someone else changed this at the same time.',
  413: 'That is too large. Please make it smaller and try again.',
  415: 'That file type is not supported.',
  422: 'We could not read that file.',
  429: RATE_LIMIT_MESSAGE,
  500: 'Something went wrong on the server. Please try again.',
  502: 'The server is not reachable right now. Please try again.',
  503: 'The service is not available right now. Please try again shortly.',
  504: 'The server took too long to answer. Please try again.',
};

let unauthenticatedHandler = null;

// App registers this so any 401 (expired or missing session) sends people back to sign in.
export function setUnauthenticatedHandler(fn) {
  unauthenticatedHandler = fn;
}

async function request(path, { method = 'GET', body, signal, ignore401 = false } = {}) {
  const init = { method, credentials: 'include', headers: { Accept: 'application/json' }, signal };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', { code: 'network_error' });
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Not JSON. Fall back to a message based on the status below.
  }

  if (response.ok && data && data.ok === true) return data;

  const message =
    (response.status === 429 && RATE_LIMIT_MESSAGE) ||
    (data && typeof data.error === 'string' && data.error) ||
    (response.ok ? 'The server sent an unexpected response. Please try again.' : FALLBACK_MESSAGES[response.status]) ||
    `Request failed (HTTP ${response.status}). Please try again.`;
  const error = new ApiError(message, {
    status: response.status,
    code: (data && data.code) || `http_${response.status}`,
    body: data,
  });
  if (response.status === 401 && !ignore401 && unauthenticatedHandler) unauthenticatedHandler(error);
  throw error;
}

const q = encodeURIComponent;

export const api = {
  getSession: (opts) => request('/api/session', { ...opts, ignore401: true }),
  signIn: (email) => request('/api/session', { method: 'POST', body: { email }, ignore401: true }),
  signOut: () => request('/api/session', { method: 'DELETE', ignore401: true }),
  listUsers: (opts) => request('/api/users', { ...opts, ignore401: true }),

  listDocuments: (opts) => request('/api/documents', opts),
  createDocument: (input = {}) => request('/api/documents', { method: 'POST', body: input }),
  getDocument: (id, opts) => request(`/api/document?id=${q(id)}`, opts),
  updateDocument: (id, patch) => request(`/api/document?id=${q(id)}`, { method: 'PATCH', body: patch }),
  deleteDocument: (id) => request(`/api/document?id=${q(id)}`, { method: 'DELETE' }),

  listShares: (documentId, opts) => request(`/api/shares?documentId=${q(documentId)}`, opts),
  share: (documentId, email, role) => request('/api/shares', { method: 'POST', body: { documentId, email, role } }),
  unshare: (documentId, userId) =>
    request(`/api/shares?documentId=${q(documentId)}&userId=${q(userId)}`, { method: 'DELETE' }),

  importFile: (filename, contentBase64) =>
    request('/api/import', { method: 'POST', body: { filename, contentBase64 } }),
};
