import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { EngineClient } from '@abc-budget/engine';
import { routes } from './router';
import { useHasData } from './has-data';
import { engine } from '../engine';
import { EngineClientProvider } from './engine-client-context';
import { LangProvider } from './i18n/LangProvider';

vi.mock('./has-data');

// engine.ts spawns the real Worker at module init (2.6 always-worker) — jsdom has
// no Worker, so screens that render the engine status line get a fake client.
// 2.7: the S3a session methods joined the mock — the wizard walk now has to pass
// the REAL gate #1 (decode → importStart → unknown unlocks Next).
vi.mock('../engine', () => ({
  engine: {
    ping: async (message: string) => message,
    // DECLARED UPDATE (2.7): contract 2 → 3 (base-currency surface + structural channel)
    getVersion: async () => ({ engine: '0.0.0', contract: 3 }),
    onEvent: () => () => {},
    decode: async () => ({
      rows: [{ Дата: '01.01.2026', Сума: '-1,00' }],
      issues: [],
      meta: { format: 'csv', headerRow: 0, totalRows: 1, decodedRows: 1 },
    }),
    importStart: async () => ({
      sessionId: 'sess-router',
      stage2: { columns: [], recognized: { n: 0, m: 2 }, lastSaveCollision: null, unmapped: [] },
    }),
    importAbort: async () => undefined,
    // 2.7 Task 4: the cold-start gate probes on /import entry — set here, so
    // the wizard walks never see the dialog (ImportFlow.spec owns the gate).
    getBaseCurrency: async () => 'UAH',
    setBaseCurrency: async () => undefined,
  },
  engineReady: Promise.resolve({ state: 'ready' }),
}));

// Data router since 2.7 (ImportFlow's useBlocker needs it) — tests mount the
// same route objects through createMemoryRouter.
function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <LangProvider initialLang="uk">
      <EngineClientProvider client={engine as unknown as EngineClient}>
        <RouterProvider router={router} />
      </EngineClientProvider>
    </LangProvider>,
  );
}

/** Pass gate #1: drive a file through S3a → unknown (n=0) unlocks Далі.
 *  find* because the S3a body waits for the base-currency probe (Task 4). */
async function passS3aGate() {
  fireEvent.change(await screen.findByTestId('s3a-file-input'), {
    target: { files: [new File(['a,b\n1,2'], 'statement.csv', { type: 'text/csv' })] },
  });
  await waitFor(() => expect(screen.getByTestId('s3a-unknown')).toBeTruthy());
}

beforeEach(() => {
  vi.mocked(useHasData).mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('/ routing (FEAT-030)', () => {
  it('hasData=false → Onboarding at root', () => {
    renderAt('/');
    expect(screen.getByTestId('screen-onboarding')).toBeTruthy();
  });
  it('hasData=true → redirect to Dashboard', () => {
    vi.mocked(useHasData).mockReturnValue(true);
    renderAt('/');
    expect(screen.getByTestId('screen-dashboard')).toBeTruthy();
  });
  it('unknown path → back to root (no dead-ends includes typos)', () => {
    renderAt('/nope/missing');
    expect(screen.getByTestId('screen-onboarding')).toBeTruthy();
  });
});

describe('screen mounts', () => {
  it('/dashboard mounts Dashboard with the engine status line (the 1.1 slice)', async () => {
    renderAt('/dashboard');
    expect(screen.getByTestId('screen-dashboard')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('engine-status').textContent).toContain('PING OK'));
    expect(screen.getByTestId('engine-status').textContent).toContain('CONTRACT 3');
  });
  it('/settings mounts Settings with section tabs', () => {
    renderAt('/settings');
    expect(screen.getByTestId('screen-settings')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Огляд' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Категорії' })).toBeTruthy();
  });
  it('/import mounts the wizard at step 1', () => {
    renderAt('/import');
    expect(screen.getByTestId('screen-import')).toBeTruthy();
    expect(screen.getByText('КРОК 1 / 4')).toBeTruthy();
  });
});

describe('FEAT-030 link map', () => {
  it('Onboarding CTAs reach /import', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Імпортувати виписку' }));
    expect(screen.getByTestId('screen-import')).toBeTruthy();
  });
  it('Dashboard «Імпорт виписки» reaches /import', () => {
    renderAt('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Імпорт виписки' }));
    expect(screen.getByTestId('screen-import')).toBeTruthy();
  });
  it('Settings DAT CTA reaches /import', () => {
    renderAt('/settings');
    fireEvent.click(screen.getByRole('button', { name: 'Імпорт виписки' }));
    expect(screen.getByTestId('screen-import')).toBeTruthy();
  });
  it('zone-switcher navigates Dashboard ↔ Settings (both directions)', () => {
    renderAt('/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'Налаштування' }));
    expect(screen.getByTestId('screen-settings')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Дашборд' }));
    expect(screen.getByTestId('screen-dashboard')).toBeTruthy();
  });
  it('Settings tabs switch in-page (no route change)', () => {
    renderAt('/settings');
    fireEvent.click(screen.getByRole('button', { name: 'Категорії' }));
    expect(screen.getByTestId('tab-categories')).toBeTruthy();
    expect(screen.getByTestId('screen-settings')).toBeTruthy(); // still the same screen
  });
});

describe('wizard flow (single route, internal steps; REAL gate #1 since 2.7)', () => {
  it('S3a-Назад with NO session exits straight to Dashboard (blocker inactive)', () => {
    renderAt('/import');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByTestId('screen-dashboard')).toBeTruthy();
  });
  it('gate #1: Далі is disabled until S3a resolves; then walks S3a→S3d and back', async () => {
    renderAt('/import');
    expect(screen.getByText('КРОК 1 / 4')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Далі' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));
    expect(screen.getByText('КРОК 1 / 4')).toBeTruthy(); // gate held
    await passS3aGate();
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));
    expect(screen.getByText('КРОК 2 / 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('КРОК 1 / 4')).toBeTruthy();
  });
  it('exit with an active session → confirm modal; «Перервати й вийти» → Dashboard', async () => {
    renderAt('/import');
    await passS3aGate();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    // blocked: the altus confirm modal, not the dashboard
    expect(screen.getByRole('dialog', { name: 'Перервати імпорт?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Перервати й вийти' }));
    await waitFor(() => expect(screen.getByTestId('screen-dashboard')).toBeTruthy());
  });
  it('S3d: «До бюджету» → Dashboard (after leave-confirm); «Імпортувати ще» → reset to S3a', async () => {
    renderAt('/import');
    await passS3aGate();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Далі' }));
    expect(screen.getByText('КРОК 4 / 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Імпортувати ще' }));
    expect(screen.getByText('КРОК 1 / 4')).toBeTruthy();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Далі' }));
    fireEvent.click(screen.getByRole('button', { name: 'До бюджету' }));
    // the session is still live → exit-protection fires here too
    fireEvent.click(screen.getByRole('button', { name: 'Перервати й вийти' }));
    await waitFor(() => expect(screen.getByTestId('screen-dashboard')).toBeTruthy());
  });
});

describe('shell invariants', () => {
  it('zone-switcher present on exactly the two dwell screens', () => {
    const dash = renderAt('/dashboard');
    expect(dash.container.querySelector('.zone-nav')).not.toBeNull();
    dash.unmount();
    const set = renderAt('/settings');
    expect(set.container.querySelector('.zone-nav')).not.toBeNull();
  });
  it('zone-switcher ABSENT on Onboarding and Import', () => {
    const ob = renderAt('/');
    expect(ob.container.querySelector('.zone-nav')).toBeNull();
    ob.unmount();
    const imp = renderAt('/import');
    expect(imp.container.querySelector('.zone-nav')).toBeNull();
  });
  it('logo links to /dashboard on product screens, inert on Onboarding', () => {
    const dash = renderAt('/dashboard');
    const dashBrand = dash.container.querySelector('.brand')!;
    expect(dashBrand.closest('a')).not.toBeNull();
    expect(dashBrand.closest('a')!.getAttribute('href')).toBe('/dashboard');
    dash.unmount();
    const ob = renderAt('/');
    const obBrand = ob.container.querySelector('.brand')!;
    expect(obBrand.closest('a')).toBeNull(); // inert
  });
  it('no review state-switcher anywhere', () => {
    for (const path of ['/', '/dashboard', '/settings', '/import']) {
      const r = renderAt(path);
      expect(r.container.querySelector('[class*="state-switch"], [data-review]')).toBeNull();
      r.unmount();
    }
  });
  it('no dead-ends: every screen has ≥1 outgoing navigation affordance', () => {
    const OUTGOING: Record<string, string> = {
      '/': 'Імпортувати виписку',
      '/dashboard': 'Імпорт виписки',
      '/settings': 'Імпорт виписки',
      '/import': 'Назад',
    };
    for (const [path, affordance] of Object.entries(OUTGOING)) {
      const r = renderAt(path);
      expect(within(r.container).getByRole('button', { name: affordance }), path).toBeTruthy();
      r.unmount();
    }
  });
});

describe('i18n shell behavior (1.4)', () => {
  it('toggle present in all three headers (Onboarding, dwell, flow)', () => {
    for (const path of ['/', '/dashboard', '/import']) {
      const r = renderAt(path);
      // uk-pinned renders → the localized SR label (chrome string, from the catalog)
      expect(within(r.container).getByRole('group', { name: 'Мова інтерфейсу' }), path).toBeTruthy();
      r.unmount();
    }
  });
  it('switching to EN re-renders chrome (zone labels) and back', () => {
    renderAt('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'UK' }));
    expect(screen.getByRole('link', { name: 'Дашборд' })).toBeTruthy();
  });
  it('switch persists to localStorage and updates <html lang>', () => {
    // Pin the BEFORE state so the assertion proves the uk→en TRANSITION, not the
    // module-init value (jsdom defaults to en-US, which would mask a dead setLang path).
    document.documentElement.lang = 'uk';
    renderAt('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(localStorage.getItem('abc.lang.v1')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    fireEvent.click(screen.getByRole('button', { name: 'UK' }));
    expect(document.documentElement.lang).toBe('uk');
  });
  it('first render is already in the provided language (no flash: text present synchronously)', () => {
    const r = renderAt('/');
    // No waitFor: the very first synchronous render must carry the uk copy.
    expect(within(r.container).getByText('Ласкаво просимо')).toBeTruthy();
  });
});
