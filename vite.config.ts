import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { buildPolicy } from './src/shell/csp.ts';
import { buildId, injectBuild, precacheList } from './src/swBuild.ts';

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

/**
 * Production build only: writes this build's fingerprint and the exact list of built script and style files into the service worker
 * (dist/sw.js). Nothing is typed by hand, so the list can never go stale; and the worker file differs in every release, so the browser
 * installs the new one, which saves every file and trims the cache of older builds. See src/swBuild.ts and public/sw.js.
 */
function serviceWorkerBuild(): Plugin {
  let outDir = 'dist';
  const emitted: string[] = [];
  return {
    name: 'ledger-service-worker-build',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    generateBundle(_o, bundle) { emitted.push(...Object.keys(bundle)); },
    closeBundle: {
      order: 'post',
      handler() {
        const swPath = resolve(outDir, 'sw.js');
        const sw = readFileSync(swPath, 'utf8');
        const parts: Record<string, string | Uint8Array> = { 'sw.js': sw, 'index.html': readFileSync(resolve(outDir, 'index.html'), 'utf8') };
        for (const f of [...emitted, 'manifest.webmanifest']) parts[f] = f.endsWith('.js') || f.endsWith('.css') ? f : readFileSync(resolve(outDir, f), 'utf8');
        for (const f of readdirSync(resolve(outDir, 'icons'))) parts['icons/' + f] = readFileSync(resolve(outDir, 'icons', f));
        writeFileSync(swPath, injectBuild(sw, buildId(parts), precacheList(emitted)));
      },
    },
  };
}

// base './' keeps asset paths relative so the build works on GitHub Pages sub-paths.
export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy(), serviceWorkerBuild()],
  test: { environment: 'node', setupFiles: ['./src/lib/test-setup.ts'], testTimeout: 30_000 }, // ST-S4: the slowest test takes 3.7 s alone and 6.1 s with three whole suites running at once, so 30 s leaves about 5x headroom (the 5 s default is too tight for the two-device sync tests). No test sets a longer limit of its own: a hung test now costs 30 s, not 3 minutes.
});
