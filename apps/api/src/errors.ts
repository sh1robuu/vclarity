export type ErrorStatus = 400 | 401 | 403 | 404 | 408 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504;

/** Only messages deliberately written here cross the server boundary. */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: ErrorStatus) {
    super(message);
    this.name = 'ApiError';
  }
}

export function publicError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('internal_error', 'Analysis failed. Try again or check the backend configuration.', 500);
}
