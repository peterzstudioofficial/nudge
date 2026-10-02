/** An error that becomes an HTTP response. `slab` is what the wall should show when it refuses. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public slab?: { icon: string; line: string; sub?: string },
    /** extra fields for the app, e.g. what reading a scanned document would cost */
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = "not found") => new HttpError(404, what);
export const forbidden = (why = "not allowed") => new HttpError(403, why, { icon: "lock", line: why });
export const refuse = (g: { icon: string; line: string; sub?: string }) => new HttpError(409, g.line, g);
