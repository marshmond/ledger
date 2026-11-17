import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * CS-2: the build for the SEPARATE tablet app (`npm run build:tablet`). It is not part of Ledger's build and is not deployed by Ledger's workflow:
 * it must be served from its own web address (its own browser storage), never under Ledger's.
 * Production only: adds the tablet's own Content-Security-Policy. It may talk to this page's own address and to api.github.com, nothing else.
 */
const POLICY = "default-src 'self'; connect-src 'self' https://api.github.com; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'";
function tabletPolicy(): Plugin {
  return {
    name: 'tablet-content-security-policy',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: (html) => html.replace(/<meta charset="UTF-8"\s*\/?>/i, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />`) },
  };
}

const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: resolve(here, 'tablet-app'),
  base: './',
  plugins: [react(), tabletPolicy()],
  build: { outDir: resolve(here, 'dist-tablet'), emptyOutDir: true },
});
