export class ProgressRequestError extends Error {
  constructor(message: string, public confirmedRejection: boolean) { super(message); }
}
export async function progressRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new ProgressRequestError(typeof result?.error === "string" ? result.error : "Could not complete this request. Please retry.", response.status >= 400 && response.status < 500 && typeof result?.error === "string");
  return result as T;
}
