import type { ReactNode } from 'react';

/**
 * MarkdownHelp — the lightweight markdown renderer for the per-type help docs.
 *
 * Ported VERBATIM (presentationally) from design-reference/s3b-app.jsx
 * (mdInline + calloutKind + MdTable + MarkdownHelp).  Pure: a markdown string
 * in, React nodes out — no engine, no i18n, no state.
 *
 * Supported block grammar (the subset the column-type-help/*.md docs use):
 *   ###  → <h4 class="md-h3">     (heading levels shift down one)
 *   #### → <h5 class="md-h4">
 *   | …  → table (header row, separator row, body rows)
 *   > …  → blockquote
 *   * / - list items (⚠️ / ℹ️ leading callout → md-warn / md-info styling)
 *   everything else → paragraph (or a standalone callout if it leads with ⚠️/ℹ️)
 * Inline: **bold**, «quoted», [link](url), `code`, _italic_.
 */

/** Renders inline markdown (**bold**, «quoted», [link](url), `code`, _italic_). */
export function mdInline(text: string, kb: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|«([^»]+)»|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<strong key={`${kb}-${k++}`}>{m[1]}</strong>);
    else if (m[2])
      nodes.push(
        <span key={`${kb}-${k++}`} className="md-quoted">
          «{m[2]}»
        </span>,
      );
    else if (m[3])
      nodes.push(
        <a key={`${kb}-${k++}`} href={m[4]} target="_blank" rel="noreferrer">
          {m[3]}
        </a>,
      );
    else if (m[5]) nodes.push(<code key={`${kb}-${k++}`}>{m[5]}</code>);
    else if (m[6]) nodes.push(<em key={`${kb}-${k++}`}>{m[6]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** A leading ⚠️ / ℹ️ marks a callout (warn / info); null otherwise. */
function calloutKind(text: string): 'warn' | 'info' | null {
  const s = text.trimStart();
  if (s.startsWith('⚠️')) return 'warn';
  if (s.startsWith('ℹ️')) return 'info';
  return null;
}

function MdTable({ rows, kb }: { rows: string[]; kb: string }) {
  const parse = (r: string) =>
    r
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const header = parse(rows[0]);
  const body = rows.slice(2).map(parse);
  return (
    <div className="md-tablewrap">
      <table className="md-table">
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{mdInline(h, `${kb}h${i}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci}>{mdInline(c, `${kb}${ri}-${ci}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Block =
  | { t: 'h3'; x: string }
  | { t: 'h4'; x: string }
  | { t: 'table'; rows: string[] }
  | { t: 'quote'; x: string }
  | { t: 'list'; items: string[] }
  | { t: 'p'; x: string };

export interface MarkdownHelpProps {
  /** Raw markdown string. Falsy → renders nothing. */
  md: string | null | undefined;
}

/** Renders a help-doc markdown string into the .md atom tree. */
export function MarkdownHelp({ md }: MarkdownHelpProps) {
  if (!md) return null;
  // Normalize CRLF/CR → LF so vendored Windows-encoded docs don't leak a
  // trailing \r into heading/cell text.
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const tbl: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tbl.push(lines[i]);
        i++;
      }
      blocks.push({ t: 'table', rows: tbl });
      continue;
    }
    if (/^####\s/.test(line)) {
      blocks.push({ t: 'h4', x: line.replace(/^####\s/, '') });
      i++;
      continue;
    }
    if (/^###\s/.test(line)) {
      blocks.push({ t: 'h3', x: line.replace(/^###\s/, '') });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ t: 'quote', x: q.join(' ') });
      continue;
    }
    if (/^\s*[*-]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[*-]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[*-]\s/, ''));
        i++;
      }
      blocks.push({ t: 'list', items });
      continue;
    }
    blocks.push({ t: 'p', x: line });
    i++;
  }
  return (
    <div className="md">
      {blocks.map((b, bi) => {
        if (b.t === 'h3')
          return (
            <h4 key={bi} className="md-h3 f-disp">
              {mdInline(b.x, `h3${bi}`)}
            </h4>
          );
        if (b.t === 'h4')
          return (
            <h5 key={bi} className="md-h4 f-disp">
              {mdInline(b.x, `h4${bi}`)}
            </h5>
          );
        if (b.t === 'table') return <MdTable key={bi} rows={b.rows} kb={`t${bi}`} />;
        if (b.t === 'quote')
          return (
            <blockquote key={bi} className="md-quote">
              {mdInline(b.x, `q${bi}`)}
            </blockquote>
          );
        if (b.t === 'list')
          return (
            <ul key={bi} className="md-list">
              {b.items.map((it, ii) => {
                const k = calloutKind(it);
                return (
                  <li key={ii} className={k ? `md-call md-${k}` : ''}>
                    {mdInline(it, `l${bi}${ii}`)}
                  </li>
                );
              })}
            </ul>
          );
        const k = calloutKind(b.x);
        if (k)
          return (
            <div key={bi} className={`md-call md-${k}`}>
              {mdInline(b.x, `c${bi}`)}
            </div>
          );
        return (
          <p key={bi} className="md-p">
            {mdInline(b.x, `p${bi}`)}
          </p>
        );
      })}
    </div>
  );
}
