import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from './router';
import { useHasData } from './has-data';

vi.mock('./has-data');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useHasData).mockReturnValue(false);
});

afterEach(() => {
  cleanup();
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
    expect(screen.getByTestId('engine-status').textContent).toContain('CONTRACT 1');
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
