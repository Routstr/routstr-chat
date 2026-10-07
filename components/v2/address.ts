/** Puts this query in the address bar without a navigation. Next follows the
 *  browser's own history calls (useSearchParams updates); its router would ask
 *  for the page again, which under a base path (/v2) is a file outside the base,
 *  so a full reload. */
export function showQuery(query: string): void {
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}
