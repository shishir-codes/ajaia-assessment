// An error the client may see: HTTP status, a snake_case code and a safe human message.
// `extra` holds additional JSON fields for the error body, for example { document } on a 409.
// `headers` are extra response headers, for example Retry-After on a 429.
export class HttpError extends Error {
  constructor(status, code, message, extra = {}, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

export const invalidInput = (message) => new HttpError(400, 'invalid_input', message);
export const unauthenticated = () => new HttpError(401, 'unauthenticated', 'Please sign in first.');
export const forbidden = (message) => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Document not found.') => new HttpError(404, 'not_found', message);
export const tooLarge = (message) => new HttpError(413, 'too_large', message);
