import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { EngineStatusBanner } from './EngineStatusBanner';
import { LangProvider } from '../i18n/LangProvider';
import type { EngineBootStatus } from '../../engine';
import type { EngineEventPayload } from '@abc-budget/engine';

// ── Fakes ─────────────────────────────────────────────────────────────────────

/** Fake client: captures onEvent subscribers so tests can emit engine events. */
function fakeClient() {
  const listeners = new Set<(e: EngineEventPayload) => void>();
  return {
    client: {
      onEvent(cb: (e: EngineEventPayload) => void) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    emit(e: EngineEventPayload) {
      for (const cb of listeners) cb(e);
    },
    get subscriberCount() {
      return listeners.size;
    },
  };
}

const ready = (state: EngineBootStatus['state']): Promise<EngineBootStatus> =>
  Promise.resolve(
    state === 'ready'
      ? { state: 'ready' }
      : ({ state, error: new Error(state) } as EngineBootStatus),
  );

function renderBanner(opts?: {
  readyState?: EngineBootStatus['state'];
  updateSW?: (reload?: boolean) => Promise<void>;
}) {
  const fake = fakeClient();
  const updateSW = opts?.updateSW ?? vi.fn(async () => {});
  const utils = render(
    <LangProvider initialLang="uk">
      <EngineStatusBanner
        client={fake.client}
        ready={ready(opts?.readyState ?? 'ready')}
        updateSW={updateSW}
      />
    </LangProvider>,
  );
  return { ...utils, fake, updateSW };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// ── Specs ─────────────────────────────────────────────────────────────────────

describe('EngineStatusBanner (2.6 — the three loud states)', () => {
  it('renders NOTHING while the engine is healthy', async () => {
    renderBanner();
    await act(async () => {}); // flush the readiness promise
    expect(screen.queryByTestId('engine-status-banner')).toBeNull();
  });

  it('blocked event → loud multi-tab state ("close other tabs")', async () => {
    const { fake } = renderBanner();
    act(() => fake.emit({ event: 'blocked' }));
    const banner = screen.getByTestId('engine-status-banner');
    expect(banner.getAttribute('data-state')).toBe('blocked');
    expect(banner.textContent).toContain('Сховище заблоковано');
    expect(banner.textContent).toContain('Закрийте інші вкладки');
  });

  it('dead event → worker-died auto-respawn notice', async () => {
    const { fake } = renderBanner();
    act(() => fake.emit({ event: 'dead' }));
    const banner = screen.getByTestId('engine-status-banner');
    expect(banner.getAttribute('data-state')).toBe('worker-died');
    expect(banner.textContent).toContain('Обробник перезапускається');
    expect(banner.textContent).toContain('перезапущено автоматично');
  });

  it('contract-mismatch readiness → reload prompt + the SW update check fires (NOT location.reload)', async () => {
    const updateSW = vi.fn(async () => {});
    renderBanner({ readyState: 'contract-mismatch', updateSW });
    const banner = await screen.findByTestId('engine-status-banner');
    expect(banner.getAttribute('data-state')).toBe('contract-mismatch');
    expect(banner.textContent).toContain('Потрібне оновлення');
    // Decision 2 refinement: entering the state triggers the SW update CHECK.
    await waitFor(() => expect(updateSW).toHaveBeenCalledWith(false));
    // The visible action rides the registerSW mechanism with reload.
    fireEvent.click(screen.getByRole('button', { name: 'Перезавантажити' }));
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('priority: contract-mismatch is never masked by a later dead/blocked event', async () => {
    const { fake } = renderBanner({ readyState: 'contract-mismatch' });
    await screen.findByTestId('engine-status-banner');
    act(() => fake.emit({ event: 'dead' }));
    act(() => fake.emit({ event: 'blocked' }));
    expect(screen.getByTestId('engine-status-banner').getAttribute('data-state')).toBe(
      'contract-mismatch',
    );
  });

  it('progress events do NOT raise the banner', async () => {
    const { fake } = renderBanner();
    act(() => fake.emit({ event: 'progress', jobId: '1', phase: 'decode', done: 1, total: 2 }));
    expect(screen.queryByTestId('engine-status-banner')).toBeNull();
  });

  it('renders the en copy when the language is en', async () => {
    const fake = fakeClient();
    render(
      <LangProvider initialLang="en">
        <EngineStatusBanner client={fake.client} ready={ready('ready')} updateSW={vi.fn()} />
      </LangProvider>,
    );
    act(() => fake.emit({ event: 'blocked' }));
    expect(screen.getByTestId('engine-status-banner').textContent).toContain(
      'Close other ABC Budget tabs',
    );
  });

  it('unsubscribes from onEvent on unmount (no leaked listeners)', () => {
    const { fake, unmount } = renderBanner();
    expect(fake.subscriberCount).toBe(1);
    unmount();
    expect(fake.subscriberCount).toBe(0);
  });
});
