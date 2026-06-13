import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfigWizard } from './ConfigWizard';
import { buildEngineParams } from './param-schema';
import type { MappingColumn } from './types';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function col(over: Partial<MappingColumn> = {}): MappingColumn {
  return {
    id: 'c1',
    rawName: 'Сума',
    definition: null,
    recallState: null,
    sampleCells: [{ value: '-320.50' }, { value: '25 000.00' }, { value: '-89.00' }],
    ...over,
  };
}

function renderWizard(column: MappingColumn, lang: Lang = 'uk') {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <ConfigWizard column={column} onApply={onApply} onCancel={onCancel} />
    </LangProvider>,
  );
  return { ...utils, onApply, onCancel };
}

describe('ConfigWizard (2-step «More» configurator)', () => {
  it('UNKNOWN column opens at step 1 (type picker grid)', () => {
    const { container } = renderWizard(col({ definition: null }));
    expect(container.querySelector('.cfg-types')).toBeTruthy();
    expect(screen.getByText('КРОК 1 · ТИП')).toBeTruthy();
  });

  it('mapped column opens at step 2 (params + help + preview)', () => {
    const { container } = renderWizard(col({ definition: 'amount', recallState: 'confirmed' }));
    expect(container.querySelector('.cfg-config')).toBeTruthy();
    expect(screen.getByText('КРОК 2 · ПАРАМЕТРИ')).toBeTruthy();
  });

  it('step 2 renders the real embedded help doc (MarkdownHelp) for the type', () => {
    const { container } = renderWizard(col({ definition: 'amount', recallState: 'confirmed' }), 'en');
    const helpdoc = container.querySelector('.cfg-helpdoc');
    expect(helpdoc).toBeTruthy();
    expect(helpdoc?.querySelector('.md')).toBeTruthy();
    // amount.en help has a "Configuration" h3
    expect(helpdoc?.querySelector('h4.md-h3')?.textContent).toBe('Configuration');
  });

  it('step 2 previews the column sample values', () => {
    const { container } = renderWizard(col({ definition: 'amount', recallState: 'confirmed' }));
    const preview = container.querySelector('.cfg-prev-vals')!;
    expect(preview.textContent).toContain('-320.50');
    expect(preview.textContent).toContain('25 000.00');
  });

  it('step 1 → pick a type → Next advances to step 2', () => {
    const { container } = renderWizard(col({ definition: null }));
    // pick "description" (no params) and advance
    fireEvent.click(screen.getByText('Опис'));
    fireEvent.click(screen.getByText('Далі ▸'));
    expect(container.querySelector('.cfg-config')).toBeTruthy();
    // description has no params → the no-default note shows
    expect(container.querySelector('.cfg-nodefault')).toBeTruthy();
  });

  it('Apply emits (definition, uiValues) — buildEngineParams turns them into engine params', () => {
    const { onApply } = renderWizard(col({ definition: 'amount', recallState: 'confirmed' }));
    fireEvent.click(screen.getByText('Застосувати'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [definition, uiValues] = onApply.mock.calls[0];
    expect(definition).toBe('amount');
    // defaults: currency auto, type auto
    expect(buildEngineParams(definition, uiValues)).toEqual({ currency: 'auto', type: 'auto' });
  });

  it('currency {code} path flows through to engine params', () => {
    const { onApply } = renderWizard(col({ definition: 'amount', recallState: 'confirmed' }));
    // currency field: switch to "Фікс. код…" then type a code
    fireEvent.click(screen.getByText('Фікс. код…'));
    const input = document.querySelector('.cfg-custom input')!;
    fireEvent.change(input, { target: { value: 'eur' } });
    fireEvent.click(screen.getByText('Застосувати'));
    const [definition, uiValues] = onApply.mock.calls[0];
    expect(buildEngineParams(definition, uiValues)).toEqual({ currency: { code: 'EUR' }, type: 'auto' });
  });

  it('Cancel (step 1) fires onCancel', () => {
    const { onCancel } = renderWizard(col({ definition: null }));
    fireEvent.click(screen.getByText('Скасувати'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Back (step 2) returns to step 1', () => {
    const { container } = renderWizard(col({ definition: 'amount', recallState: 'confirmed' }));
    fireEvent.click(screen.getByText('Назад'));
    expect(container.querySelector('.cfg-types')).toBeTruthy();
  });
});
