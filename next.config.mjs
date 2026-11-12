/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // BROWSER KEYSTORE PASS Gate 4: instrumentation.ts runs the production environment contract at boot
  experimental: { instrumentationHook: true },
  // DOCS UNDER APP (D-DOCS-UNDER-APP): the docs at /docs are a VitePress site whose section pages live at a trailing
  // slash (/docs/privacy/) and resolve their relative links from it, so Next's built-in "/x/ -> /x" redirect — which
  // runs before the middleware — would break every section page. It is switched off here and done by middleware.ts
  // instead, for every path EXCEPT /docs and /docs/* (the docs route makes its own redirects, the other way round).
  skipTrailingSlashRedirect: true,
};
export default nextConfig;
