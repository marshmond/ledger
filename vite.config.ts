import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { buildPolicy } from './src/shell/csp.ts';

/** Production build only: adds the Content-Security-Policy tag (the dev server needs inline scripts, so it is left alone). */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'ledger-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
        const tag = `<meta http-equiv="Content-Security-Policy" content="${buildPolicy(hashes)}" />`;
        return html.replace(/<meta charset="UTF-8"\s*\/?>/i, (m) => `${m}\n    ${tag}`);
      },
    },
  };
}

// base './' keeps asset paths relative so the build works on GitHub Pages sub-paths.
export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  test: { environment: 'node', setupFiles: ['./src/lib/test-setup.ts'] },
});
