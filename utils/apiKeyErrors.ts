export function isInvalidApiKeyError(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;

  const data = body as {
    error?: { code?: string };
    detail?: { error?: { code?: string } };
  };
  const code = data.error?.code ?? data.detail?.error?.code;
  return code === "invalid_api_key" || code === "key_not_found";
}
