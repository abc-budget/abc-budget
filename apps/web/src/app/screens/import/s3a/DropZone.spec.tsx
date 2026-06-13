import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DropZone } from './DropZone';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

function renderZone(lang: Lang = 'uk') {
  const onFile = vi.fn();
  const onSample = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <DropZone onFile={onFile} onSample={onSample} />
    </LangProvider>,
  );
  return { ...utils, onFile, onSample };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('DropZone (S3a idle)', () => {
  it('renders the uk copy: title, or-divider, pick key, formats, local-only line, sample link', () => {
    renderZone('uk');
    expect(screen.getByText('Перетягніть файл сюди')).toBeTruthy();
    expect(screen.getByText('або')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Обрати файл' })).toBeTruthy();
    expect(screen.getByText('CSV · XLS · XLSX · до 50 МБ')).toBeTruthy();
    expect(screen.getByText('ЛОКАЛЬНО · ФАЙЛ НЕ ПОКИДАЄ ПРИСТРІЙ')).toBeTruthy();
    expect(screen.getByRole('button', { name: '↳ Спробувати на прикладі' })).toBeTruthy();
  });

  it('renders the en copy', () => {
    renderZone('en');
    expect(screen.getByText('Drop the file here')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();
    expect(screen.getByText('LOCAL · THE FILE NEVER LEAVES THIS DEVICE')).toBeTruthy();
  });

  it('drag-over toggles the .over state; drag-leave clears it', () => {
    renderZone();
    const zone = screen.getByTestId('s3a-dropzone');
    expect(zone.classList.contains('over')).toBe(false);
    fireEvent.dragOver(zone);
    expect(zone.classList.contains('over')).toBe(true);
    fireEvent.dragLeave(zone);
    expect(zone.classList.contains('over')).toBe(false);
  });

  it('dropping a file calls onFile with it and clears the drag state', () => {
    const { onFile } = renderZone();
    const zone = screen.getByTestId('s3a-dropzone');
    const file = new File(['a,b\n1,2'], 'statement.csv', { type: 'text/csv' });
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
    expect(zone.classList.contains('over')).toBe(false);
  });

  it('picking via the hidden input calls onFile; the input accepts spreadsheet formats', () => {
    const { onFile } = renderZone();
    const input = screen.getByTestId('s3a-file-input') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('.csv,.xls,.xlsx,text/csv');
    const file = new File(['x'], 'export.xlsx');
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('the sample link calls onSample (FEAT-001 second entry path)', () => {
    const { onSample } = renderZone();
    fireEvent.click(screen.getByRole('button', { name: '↳ Спробувати на прикладі' }));
    expect(onSample).toHaveBeenCalledOnce();
  });
});
