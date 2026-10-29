// Production and local-preview routes select independent project pages.
// Query parameters deliberately do not select a tool; legacy redirects are server-owned.
export function inferProjectMode(pathname = '/') {
  return /^\/(?:compressed\/)?converter(?:\/|$)/.test(pathname) ? 'convert' : 'compress';
}
