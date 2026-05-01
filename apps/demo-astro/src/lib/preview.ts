export function setPreviewNoStore(response: { headers: Headers }): void {
  response.headers.set("cache-control", "no-store, max-age=0")
}
