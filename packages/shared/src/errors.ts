/** Error safe to show to end users. Anything else is reported as a generic failure. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly code: string = 'bad_request',
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export class ForbiddenError extends UserFacingError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 'forbidden', 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends UserFacingError {
  constructor(message = 'Not found.') {
    super(message, 'not_found', 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends UserFacingError {
  constructor(message: string, code = 'conflict') {
    super(message, code, 409);
    this.name = 'ConflictError';
  }
}
