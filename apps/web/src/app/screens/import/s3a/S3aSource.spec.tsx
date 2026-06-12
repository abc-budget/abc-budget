import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Stage2SnapshotDTO } from '@abc-budget/engine';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import { S3aSource } from './S3aSource';
import type { S3aSession } from './use-s3a-session';

function makeSnapshot(n: number, m: number): Stage2SnapshotDTO {
  return {
    columns: Array.from({ length: m }, (_, i) => ({
      id: `c${i}`,
      originalName: { text: `Колонка ${i + 1}` },
      definition: i < n ? ('date' as Stage2SnapshotDTO['columns'][number]['definition']) : null,
      params: null,
      recallState: i < n ? ('guessed' as const) : null,
      sampleCells: [],
    })),
    recognized: { n, m },
    lastSaveCollision: null,
    unmapped: [],
  };
}

function makeSession(over?: Partial<S3aSession>): S3aSession {
  return {
    state: 'idle',
    file: null,
    progress: { done: 0, total: 0 },
    snapshot: null,
    sessionId: null,
    error: null,
    otherSheets: [],
    onFile: vi.fn(),
    onSample: vi.fn(),
    replace: vi.fn(),
    remove: vi.fn(),
    retry: vi.fn(),
    abandon: vi.fn(async () => undefined),
    ...over,
  };
}

const file = { name: 'statement.csv', sizeLabel: '47 KB', rows: 30 };

function renderSource(session: S3aSession, lang: Lang = 'uk') {
  return render(
    <LangProvider initialLang={lang}>
      <S3aSource session={session} />
    </LangProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('S3aSource — state → component mapping', () => {
  it('idle → DropZone (and only it)', () => {
    renderSource(makeSession());
    expect(screen.getByTestId('s3a-dropzone')).toBeTruthy();
    expect(screen.queryByTestId('s3a-decoding')).toBeNull();
    expect(screen.queryByTestId('s3a-recognized')).toBeNull();
  });

  it('decoding → DecodingPanel with live {done,total} (PROGRESS-DURING-DECODE render)', () => {
    renderSource(makeSession({ state: 'decoding', file, progress: { done: 4200, total: 10000 } }));
    expect(screen.getByTestId('s3a-decoding')).toBeTruthy();
    expect(screen.getByText('4200 / 10000 рядків')).toBeTruthy();
  });

  it('recognized (n=m) → RecognizedPanel, full title, no partial lamp', () => {
    renderSource(makeSession({ state: 'recognized', file, snapshot: makeSnapshot(3, 3), sessionId: 's1' }));
    expect(screen.getByTestId('s3a-recognized')).toBeTruthy();
    expect(screen.getByText('Усі 3 колонок розпізнано')).toBeTruthy();
    expect(screen.queryByTestId('s3a-partial')).toBeNull();
  });

  it('recognized partial (0<n<m) → same panel WITH the partial line', () => {
    renderSource(makeSession({ state: 'recognized', file, snapshot: makeSnapshot(2, 5), sessionId: 's1' }));
    expect(screen.getByText('Розпізнано 2 з 5 колонок')).toBeTruthy();
    expect(screen.getByTestId('s3a-partial')).toBeTruthy();
  });

  it('unknown (n=0) → UnknownPanel with all-unknown savedmap rows off the snapshot', () => {
    renderSource(makeSession({ state: 'unknown', file, snapshot: makeSnapshot(0, 4), sessionId: 's1' }));
    expect(screen.getByTestId('s3a-unknown')).toBeTruthy();
    expect(screen.getByText('Колонка 1')).toBeTruthy();
    expect(screen.getByText('▸ 4 колонок · усі без типу')).toBeTruthy();
  });

  it('replace/remove wire through the FileChip', () => {
    const session = makeSession({ state: 'recognized', file, snapshot: makeSnapshot(1, 1), sessionId: 's1' });
    renderSource(session);
    fireEvent.click(screen.getByRole('button', { name: 'Замінити' }));
    expect(session.replace).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати' }));
    expect(session.remove).toHaveBeenCalledOnce();
  });
});

describe('S3aSource — error ЩО/ЧОМУ/ДІЯ derivation (HC-7)', () => {
  it('no-data → the specific ЧОМУ; ЩО/ДІЯ from the generic defaults; retry wired', () => {
    const session = makeSession({
      state: 'error',
      file: { name: 'empty.csv', sizeLabel: '0 B', rows: 0 },
      error: { kind: 'no-data' },
    });
    renderSource(session);
    expect(screen.getByTestId('s3a-error')).toBeTruthy();
    expect(screen.getByText('Файл не вдалося відкрити')).toBeTruthy();
    expect(screen.getByText('У файлі не знайшлося жодного рядка з даними.')).toBeTruthy();
    expect(screen.getByText('Перевірте, що це експорт виписки, і спробуйте інший файл.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Обрати інший файл' }));
    expect(session.retry).toHaveBeenCalledOnce();
  });

  it('file-unreadable → its specific ЧОМУ', () => {
    renderSource(makeSession({ state: 'error', file: null, error: { kind: 'file-unreadable' } }));
    expect(screen.getByText('Вміст не вдалося розібрати — файл пошкоджений або це не CSV/XLS/XLSX.')).toBeTruthy();
  });

  it('generic kind falls back to the catalog defaults (en too)', () => {
    renderSource(makeSession({ state: 'error', file: null, error: { kind: 'generic' } }), 'en');
    expect(screen.getByText('The file could not be opened')).toBeTruthy();
    expect(screen.getByText('It’s empty, corrupted, or not a spreadsheet (CSV/XLS/XLSX).')).toBeTruthy();
  });
});

describe('S3aSource — otherSheets neutral note', () => {
  it('renders the keyed note with the sheet names on recognized', () => {
    renderSource(
      makeSession({
        state: 'recognized',
        file,
        snapshot: makeSnapshot(1, 1),
        sessionId: 's1',
        otherSheets: ['Курси', 'Нотатки'],
      }),
    );
    expect(screen.getByTestId('s3a-othersheets').textContent).toContain(
      'У файлі є інші аркуші: Курси, Нотатки — прочитано лише перший.',
    );
  });

  it('renders on unknown too; absent when otherSheets is empty', () => {
    const r = renderSource(
      makeSession({ state: 'unknown', file, snapshot: makeSnapshot(0, 2), sessionId: 's1', otherSheets: ['Лист2'] }),
    );
    expect(screen.getByTestId('s3a-othersheets')).toBeTruthy();
    r.unmount();
    renderSource(makeSession({ state: 'unknown', file, snapshot: makeSnapshot(0, 2), sessionId: 's1' }));
    expect(screen.queryByTestId('s3a-othersheets')).toBeNull();
  });
});
