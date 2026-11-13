import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ModuleLoadBoundary, ModuleLoadFailed, ModuleLoading, LOADING_ATTR } from '../shell/ModuleLoader';
import { PendingView, isChunkLoadError, lazyModule, preloadLazyModule, retryLazyModule } from './lazyModule';

const Hello: ComponentType = () => createElement('p', null, 'the screens');
const Waiting: ComponentType = () => createElement('i', null, 'waiting');
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/BillsModule-abc.js');
const draw = (C: ComponentType, withPending = true) =>
  renderToStaticMarkup(withPending ? createElement(PendingView.Provider, { value: Waiting }, createElement(C)) : createElement(C));

describe('lazyModule (screens that load on demand)', () => {
  it('asks for the file once, however often it is preloaded or drawn', async () => {
    const load = vi.fn(async () => ({ default: Hello }));
    const C = lazyModule(load);
    const first = preloadLazyModule(C);
    const second = preloadLazyModule(C);
    expect(load).toHaveBeenCalledTimes(1);
    await Promise.all([first, second]);
    draw(C);
    draw(C);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('until the file has arrived, a draw shows the loading view the module boundary supplies (or nothing, without one)', () => {
    const C = lazyModule(async () => ({ default: Hello }));
    expect(draw(C)).toBe('<i>waiting</i>');
    expect(draw(C, false)).toBe('');
  });

  it('once the file is here a draw shows the screens in the very first pass: no waiting view, no second render', async () => {
    const C = lazyModule(async () => ({ default: Hello }));
    await preloadLazyModule(C);
    expect(draw(C)).toBe('<p>the screens</p>');
    expect(draw(C)).not.toContain('waiting');
  });

  it('a failed load is not remembered: the next ask goes to the network again, and can succeed', async () => {
    let online = false;
    const load = vi.fn(async () => { if (!online) throw chunkError(); return { default: Hello }; });
    const C = lazyModule(load);
    await expect(preloadLazyModule(C)).resolves.toBeUndefined(); // a failed preload stays quiet; the draw reports it
    expect(draw(C)).toBe('<i>waiting</i>');
    expect(load).toHaveBeenCalledTimes(1);
    online = true;
    retryLazyModule(C);
    await preloadLazyModule(C);
    expect(load).toHaveBeenCalledTimes(2);
    expect(draw(C)).toBe('<p>the screens</p>');
  });

  it('a failure heals itself: going away and coming back (a new draw, no Try again pressed) asks for the file again', async () => {
    let online = false;
    const load = vi.fn(async () => { if (!online) throw chunkError(); return { default: Hello }; });
    const C = lazyModule(load);
    await preloadLazyModule(C); // fails
    online = true;
    await preloadLazyModule(C); // the next ask, with no retry call in between
    expect(load).toHaveBeenCalledTimes(2);
    expect(draw(C)).toBe('<p>the screens</p>');
  });

  it('preloading or retrying something that is not lazy does nothing', async () => {
    await expect(preloadLazyModule(Hello)).resolves.toBeUndefined();
    expect(() => retryLazyModule(Hello)).not.toThrow();
  });
});

describe('what counts as "the file could not be fetched"', () => {
  it.each([
    ['Chrome and Edge', new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://x/assets/a.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['a bundler style error', Object.assign(new Error('Loading chunk 3 failed'), { name: 'ChunkLoadError' })],
    ['a stylesheet that would not preload', new Error('Unable to preload CSS for /assets/a.css')],
  ])('%s', (_name, err) => expect(isChunkLoadError(err)).toBe(true));

  it('does not swallow a real bug in a screen', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(new Error('Invalid hook call'))).toBe(false);
    expect(isChunkLoadError('boom')).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('the loading and failure screens', () => {
  it('loading: one main landmark and the marker the route announcer waits for are there from the first moment; the words come only after a noticeable wait', () => {
    const quick = renderToStaticMarkup(createElement(ModuleLoading, { name: 'Bills & Subscriptions' }));
    expect(quick.match(/<main/g)).toHaveLength(1);
    expect(quick).toContain('id="main-content"');
    expect(quick).toContain(LOADING_ATTR);
    expect(quick).toContain('role="status"');
    expect(quick).not.toContain('Loading');
    const slow = renderToStaticMarkup(createElement(ModuleLoading, { name: 'Bills & Subscriptions', delayMs: 0 }));
    expect(slow).toContain('Loading Bills &amp; Subscriptions');
  });

  it('failed: one main landmark, one h1, an announced error, a way to retry and a way to reload, and it says nothing saved changed', () => {
    const html = renderToStaticMarkup(createElement(ModuleLoadFailed, { name: 'Household Services', onRetry: () => undefined }));
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Household Services did not load');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Try again');
    expect(html).toContain('Reload Ledger');
    expect(html).toContain('Nothing you saved has changed');
    expect(html).toContain('Use the top bar'); // the rest of Ledger stays reachable
  });
});

describe('the boundary around a module', () => {
  it('turns a fetch failure into the message, and a retry clears it and re-arms the loader', async () => {
    let online = false;
    const load = vi.fn(async () => { if (!online) throw chunkError(); return { default: Hello }; });
    const C = lazyModule(load);
    await preloadLazyModule(C);
    const b = new ModuleLoadBoundary({ name: 'Bills', component: C, children: null });
    b.state = { error: chunkError(), attempt: 0 };
    expect(renderToStaticMarkup(b.render() as never)).toContain('Bills did not load');
    // retry() calls setState, which needs a mounted component; what matters here is the state it asks for, and that the loader asks again
    const setState = vi.fn();
    (b as unknown as { setState: unknown }).setState = setState;
    online = true;
    b.retry();
    const updater = setState.mock.calls[0][0] as (s: { error: unknown; attempt: number }) => { error: unknown; attempt: number };
    expect(updater({ error: chunkError(), attempt: 2 })).toEqual({ error: null, attempt: 3 });
    await preloadLazyModule(C);
    expect(draw(C)).toBe('<p>the screens</p>');
  });

  it('D20: a genuine bug in a screen is no longer passed up to take the whole app down; it becomes a recoverable page message (the chunk-load message is not used for it)', () => {
    const b = new ModuleLoadBoundary({ name: 'Bills', component: Hello, children: null });
    b.state = { error: new TypeError("Cannot read properties of undefined (reading 'x')"), attempt: 0 };
    const html = renderToStaticMarkup(b.render() as never);
    expect(html).toContain('This page ran into a problem.');
    expect(html).not.toContain('did not load');
    expect(html).not.toContain('Cannot read properties'); // the technical text is never put on screen
  });

  it('records whatever error reached it; render() then decides which kind it is (above)', () => {
    expect(ModuleLoadBoundary.getDerivedStateFromError(chunkError())).toMatchObject({ error: expect.any(TypeError) });
  });

  it('supplies the loading view to the module it wraps', () => {
    const C = lazyModule(async () => ({ default: Hello }));
    const b = new ModuleLoadBoundary({ name: 'Bills', component: C, children: createElement(C) });
    const html = renderToStaticMarkup(b.render() as never);
    expect(html).toContain(LOADING_ATTR);
    expect(html.match(/<main/g)).toHaveLength(1);
  });
});
