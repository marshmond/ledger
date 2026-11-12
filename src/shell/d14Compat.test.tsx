import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allModules, allQuickAdds, allSearchSources } from '../core/registry';
import { registerModules } from '../modules/index';

/** D14 compatibility: the three redesigned modules keep their addresses, Quick Add entries and search, and every style token they use exists for every palette. */
const read = (p: string) => readFileSync(p, 'utf8');

describe('routes and deep links are unchanged', () => {
  it('Projects: the list, one project by id, and any other address falls back to the list', () => {
    const m = read('src/modules/projects/ProjectsModule.tsx');
    expect(m).toContain('<Route index element={<ProjectsPage />} />');
    expect(m).toContain('<Route path=":id" element={<ProjectPage />} />');
    expect(m).toContain('<Route path="*" element={<ProjectsPage />} />');
  });

  it('Home & Assets: the overview, the all-assets list, one asset by id, and a fallback to the overview', () => {
    const m = read('src/modules/assets/AssetsModule.tsx');
    expect(m).toContain('<Route index element={<OverviewPage />} />');
    expect(m).toContain('<Route path="list" element={<AssetsPage />} />');
    expect(m).toContain('<Route path=":id" element={<AssetPage />} />');
    expect(m).toContain('<Route path="*" element={<OverviewPage />} />');
  });

  it('Contacts: the directory, one contact at c/<id>, and a fallback to the directory', () => {
    const m = read('src/modules/contacts/ContactsModule.tsx');
    expect(m).toContain('<Route index element={<DirectoryPage />} />');
    expect(m).toContain('<Route path="c/:id" element={<One />} />');
    expect(m).toContain('<Route path="*" element={<DirectoryPage />} />');
  });

  it('the Add-asset deep link (?new=1) and the asset links the overview offers are still in use', () => {
    expect(read('src/modules/assets/OverviewPage.tsx')).toContain("const LIST_NEW = '/list?new=1';");
    expect(read('src/modules/assets/AssetsPage.tsx')).toContain("params.get('new') === '1'");
  });
});

describe('registered entry points are unchanged', () => {
  registerModules();

  it('Projects and Home & Assets keep their Quick Add destinations; Contacts has none', () => {
    const ids = allQuickAdds().map((q) => q.moduleId);
    expect(ids).toContain('projects');
    expect(ids).toContain('assets');
    expect(ids).not.toContain('contacts');
  });

  it('all three keep their search sources and their module entries', () => {
    const sources = allSearchSources().map((s) => s.moduleId);
    for (const id of ['projects', 'assets', 'contacts']) {
      expect(sources).toContain(id);
      expect(allModules().some((m) => m.id === id)).toBe(true);
    }
  });
});

describe('style tokens: every variable the three modules use without a fallback is defined', () => {
  const defined = new Set<string>();
  for (const file of ['src/styles.css', 'src/ui/tokens.css', 'src/ui/components.css', 'src/modules/projects/projects.css', 'src/modules/assets/assets.css', 'src/modules/assets/h3.css', 'src/modules/contacts/contacts.css']) {
    for (const m of read(file).matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  }
  for (const m of read('src/palette.ts').matchAll(/'(--[a-z0-9-]+)'/g)) defined.add(m[1]);
  // Variables the palette code writes onto the page (not written as CSS): the base colors.
  for (const v of ['--bg', '--card', '--fg', '--muted', '--line', '--accent', '--pos', '--neg', '--warn', '--page', '--surface', '--on-accent']) defined.add(v);

  for (const [name, file] of [['Projects', 'src/modules/projects/projects.css'], ['Home & Assets', 'src/modules/assets/assets.css'], ['Contacts', 'src/modules/contacts/contacts.css']] as const) {
    it(`${name}`, () => {
      const used = [...read(file).matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]); // no fallback given
      const missing = [...new Set(used)].filter((v) => !defined.has(v) && v !== '--seg'); // --seg is set per bar segment by the cost bar itself
      expect(missing).toEqual([]);
    });
  }
});

describe('nothing in the three redesigned modules writes data while a screen renders', () => {
  it('the new presentation helpers are pure and import no database', () => {
    for (const f of ['src/modules/projects/presentation.ts', 'src/modules/assets/presentation.ts']) {
      const src = read(f);
      expect(src).not.toMatch(/from '\.\.\/\.\.\/(db|core\/store)'/);
      expect(src).not.toMatch(/\.(put|add|update|delete|bulkAdd|bulkPut)\(/);
    }
  });

  it('the redesigned list and overview screens contain no write call', () => {
    for (const f of ['src/modules/projects/ProjectsPage.tsx', 'src/modules/assets/OverviewPage.tsx', 'src/modules/assets/AssetsPage.tsx', 'src/modules/contacts/DirectoryPage.tsx']) {
      expect(read(f)).not.toMatch(/\bdb\.\w+\.(put|add|update|delete|bulk\w+)\(|createProject\(|createAsset\(|createTask\(/);
    }
  });
});
