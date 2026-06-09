import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App';

describe('App vertical slice', () => {
  it('renders the engine ping result through the client', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('pong').textContent).toContain('hello'));
    expect(screen.getByTestId('version').textContent).toContain('contract 1');
  });
});
