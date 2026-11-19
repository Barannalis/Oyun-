/**
 * Domain errors carry a stable machine-readable `code`, which is also the
 * i18n key suffix (`error.<code>`). Human text is never embedded here.
 */
export class DomainError extends Error {
  /**
   * @param {string} code
   * @param {{status?: number, details?: unknown}} [opts]
   */
  constructor(code, { status = 400, details = undefined } = {}) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  constructor(code, details) { super(code, { status: 400, details }); this.name = 'ValidationError'; }
}
export class AuthError extends DomainError {
  constructor(code = 'unauthorized') { super(code, { status: 401 }); this.name = 'AuthError'; }
}
export class ForbiddenError extends DomainError {
  /** @param {Array<{code: string, params?: object}>} reasons */
  constructor(reasons) { super('forbidden', { status: 403, details: { reasons } }); this.name = 'ForbiddenError'; }
}
export class NotFoundError extends DomainError {
  constructor(what = 'resource') { super('not_found', { status: 404, details: { what } }); this.name = 'NotFoundError'; }
}
export class ConflictError extends DomainError {
  constructor(code) { super(code, { status: 409 }); this.name = 'ConflictError'; }
}
export class InsufficientFundsError extends DomainError {
  constructor() { super('insufficient_funds', { status: 422 }); this.name = 'InsufficientFundsError'; }
}
/** Thrown at boot when configuration is invalid. Startup must fail. */
export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}
