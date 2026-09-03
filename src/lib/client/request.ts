export async function requestJson(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        ...(typeof options.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
    if (
      response.status === 401 ||
      (response.redirected && new URL(response.url).pathname === "/login")
    ) {
      window.location.assign("/login");
      throw new Error("Your session expired. Please sign in again.");
    }
    if (response.status === 403)
      throw new Error(
        url.includes("/boq/excel")
          ? "You do not have permission to import BOQ files."
          : "You do not have permission to perform this action.",
      );
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        typeof data?.error === "string"
          ? `${data.error}${data.detail && data.detail !== data.error ? ` ${data.detail}` : ""}`
          : response.status === 413
            ? "The upload request was too large. Please select the file again."
            : `The service could not complete the request (${response.status}). Please retry.`,
      );
    if (!data)
      throw new Error(
        "The service returned an unreadable response. Please retry.",
      );
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("The request timed out. Please retry.");
    if (error instanceof TypeError)
      throw new Error(
        "Unable to connect. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
