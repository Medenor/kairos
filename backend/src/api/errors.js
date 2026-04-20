export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function toErrorEnvelope(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    }
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error',
      },
    },
  }
}
