import { useState, useCallback } from 'react';
import { decode } from '@abc-budget/engine/qa';
import type { DecodeResult } from '@abc-budget/engine/qa';

// ---------------------------------------------------------------------------
// Harness — QA-only file decoder surface
// ---------------------------------------------------------------------------

export function Harness() {
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const bytes = await file.arrayBuffer();
      const decoded = await decode({ bytes, fileName: file.name });
      setResult(decoded);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
      {/* On-device notice — prominent, both languages, hardcoded */}
      <div className="panel" style={{ marginBottom: 24, borderLeft: '4px solid var(--green)' }}>
        <div className="panel-b" style={{ padding: '14px 20px' }}>
          <p style={{ margin: 0, fontFamily: 'var(--f-mono)', fontWeight: 600, fontSize: 13 }}>
            🔒 Файли обробляються повністю на пристрої — нічого не надсилається
          </p>
          <p style={{ margin: '4px 0 0', fontFamily: 'var(--f-mono)', fontWeight: 500, fontSize: 12, opacity: 0.75 }}>
            Files are processed entirely on-device — nothing is uploaded
          </p>
        </div>
      </div>

      {/* Header panel */}
      <div className="panel" style={{ marginBottom: 24 }}>
        <header className="panel-h">
          <div className="lhs">
            <span className="logchip">QA</span>
            <h3>Decoder Harness</h3>
          </div>
        </header>
        <div className="panel-b">
          <label style={{ display: 'block', marginBottom: 8 }}>
            <span className="eyebrow-ink" style={{ display: 'block', marginBottom: 8 }}>
              Select file to decode
            </span>
            <input
              type="file"
              accept=".csv,.txt,.xls,.xlsx"
              onChange={handleFile}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 13,
                padding: '8px 12px',
                border: '1px solid rgba(5,12,22,.22)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--cream)',
                cursor: 'pointer',
                width: '100%',
              }}
            />
          </label>
          {loading && (
            <p className="mono-s" style={{ marginTop: 12, color: 'var(--teal)' }}>
              Decoding…
            </p>
          )}
          {error && (
            <p style={{ marginTop: 12, fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--orange)' }}>
              Error: {error}
            </p>
          )}
        </div>
      </div>

      {result && (
        <>
          {/* Meta summary panel */}
          <div className="panel" style={{ marginBottom: 24 }}>
            <header className="panel-h">
              <div className="lhs">
                <span className="logchip">META</span>
                <h3>{fileName}</h3>
              </div>
            </header>
            <div className="panel-b">
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  {[
                    ['format', result.meta.format],
                    ['encoding', result.meta.encoding ?? '—'],
                    ['bom', result.meta.bom != null ? String(result.meta.bom) : '—'],
                    ['delimiter', result.meta.delimiter ?? '—'],
                    ['headerRow', String(result.meta.headerRow)],
                    ['totalRows', String(result.meta.totalRows)],
                    ['decodedRows', String(result.meta.decodedRows)],
                    ['sheet', result.meta.sheet ?? '—'],
                    ['otherSheets', result.meta.otherSheets?.join(', ') ?? '—'],
                  ].map(([key, val]) => (
                    <tr key={key} style={{ borderBottom: '1px solid rgba(5,12,22,.08)' }}>
                      <td style={{
                        padding: '6px 12px 6px 0',
                        fontFamily: 'var(--f-mono)',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em',
                        color: 'var(--gray)',
                        whiteSpace: 'nowrap',
                        width: 160,
                      }}>
                        {key}
                      </td>
                      <td style={{
                        padding: '6px 0',
                        fontFamily: 'var(--f-mono)',
                        fontSize: 12,
                        color: 'var(--ebony)',
                      }}>
                        {val}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Issues panel */}
          <div className="panel" style={{ marginBottom: 24 }}>
            <header className="panel-h">
              <div className="lhs">
                <span className="logchip">ISSUES</span>
                <h3>{result.issues.length} issue{result.issues.length !== 1 ? 's' : ''}</h3>
              </div>
            </header>
            <div className="panel-b" style={{ overflowX: 'auto' }}>
              {result.issues.length === 0 ? (
                <p className="mono-s" style={{ color: 'var(--green)' }}>No issues detected.</p>
              ) : (
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid rgba(5,12,22,.16)' }}>
                      {['row', 'column', 'what', 'why', 'raw', 'action'].map(h => (
                        <th key={h} style={{
                          padding: '6px 10px 8px',
                          fontFamily: 'var(--f-mono)',
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.14em',
                          color: 'var(--gray)',
                          textAlign: 'left',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues.map((issue, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(5,12,22,.06)' }}>
                        <td className="f-mono" style={{ padding: '5px 10px', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {issue.row}
                        </td>
                        <td className="f-mono" style={{ padding: '5px 10px', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {issue.column != null ? String(issue.column) : '—'}
                        </td>
                        <td className="f-mono" style={{ padding: '5px 10px', fontSize: 11 }}>
                          {issue.what}
                        </td>
                        <td style={{ padding: '5px 10px', fontSize: 12, fontFamily: 'var(--f-body)', maxWidth: 300 }}>
                          {issue.why}
                        </td>
                        <td className="f-mono" style={{ padding: '5px 10px', fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {issue.raw ?? '—'}
                        </td>
                        <td style={{ padding: '5px 10px' }}>
                          <span className="logchip" style={{ fontSize: 9, padding: '2px 5px' }}>
                            {issue.action}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Rows JSON panel */}
          <div className="panel">
            <header className="panel-h">
              <div className="lhs">
                <span className="logchip">ROWS</span>
                <h3>
                  first {Math.min(50, result.rows.length)} of {result.rows.length} decoded rows
                </h3>
              </div>
            </header>
            <div className="panel-b">
              <pre className="f-mono" style={{
                fontSize: 11,
                lineHeight: 1.5,
                overflowX: 'auto',
                background: 'var(--cream)',
                border: '1px solid rgba(5,12,22,.12)',
                borderRadius: 'var(--r-sm)',
                padding: '14px 16px',
                margin: 0,
                maxHeight: 520,
                overflowY: 'auto',
              }}>
                {JSON.stringify(result.rows.slice(0, 50), null, 2)}
              </pre>
              {result.rows.length > 50 && (
                <p className="mono-s" style={{ marginTop: 10, color: 'var(--gray-warm)' }}>
                  … {result.rows.length - 50} more rows not shown
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
