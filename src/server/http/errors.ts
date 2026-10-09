export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown, requestId: string): Response {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  const body = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.fields ? { fields: appError.fields } : {}),
    },
    requestId,
  };
  return Response.json(body, { status: appError.status });
}
