import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MarkdownHelp } from './MarkdownHelp';
import { HELP_DOCS } from './help-docs';

afterEach(cleanup);

describe('MarkdownHelp (pure markdown renderer)', () => {
  it('renders nothing for empty/nullish input', () => {
    const { container } = render(<MarkdownHelp md={null} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<MarkdownHelp md="" />);
    expect(c2.firstChild).toBeNull();
  });

  it('renders headings: ### → md-h3 (h4), #### → md-h4 (h5)', () => {
    const { container } = render(<MarkdownHelp md={'### Configuration\n#### Amount type\nbody'} />);
    const h3 = container.querySelector('h4.md-h3');
    const h4 = container.querySelector('h5.md-h4');
    expect(h3?.textContent).toBe('Configuration');
    expect(h4?.textContent).toBe('Amount type');
  });

  it('renders a table with header + body cells', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const { container } = render(<MarkdownHelp md={md} />);
    const table = container.querySelector('table.md-table');
    expect(table).toBeTruthy();
    expect(container.querySelectorAll('table.md-table thead th')).toHaveLength(2);
    expect(container.querySelectorAll('table.md-table tbody tr')).toHaveLength(2);
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('renders a blockquote', () => {
    const { container } = render(<MarkdownHelp md={'> a quoted note line'} />);
    const bq = container.querySelector('blockquote.md-quote');
    expect(bq?.textContent).toContain('a quoted note line');
  });

  it('renders list items and tags ⚠️/ℹ️ callouts with md-warn / md-info', () => {
    const md = '* plain item\n* ⚠️ a warning\n* ℹ️ some info';
    const { container } = render(<MarkdownHelp md={md} />);
    const items = container.querySelectorAll('ul.md-list li');
    expect(items).toHaveLength(3);
    expect(items[0].className).not.toContain('md-call');
    expect(items[1].className).toContain('md-warn');
    expect(items[2].className).toContain('md-info');
  });

  it('renders inline bold, code, «quoted» and links', () => {
    const md = 'A **bold** word, `code`, «quoted», and [a link](https://example.com).';
    const { container } = render(<MarkdownHelp md={md} />);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('.md-quoted')?.textContent).toBe('«quoted»');
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('rel')).toBe('noreferrer');
  });

  it('renders a real vendored help doc (amount.en) — headings + callout + table-free', () => {
    const { container } = render(<MarkdownHelp md={HELP_DOCS.amount.en} />);
    // h3 "Configuration" + h4 "Amount type" + "Currency"
    expect(container.querySelector('h4.md-h3')?.textContent).toBe('Configuration');
    const h4s = [...container.querySelectorAll('h5.md-h4')].map((n) => n.textContent);
    expect(h4s).toContain('Amount type');
    expect(h4s).toContain('Currency');
    // the income ⚠️ callout
    expect(container.querySelector('li.md-call.md-warn')).toBeTruthy();
    // the base-currency blockquote
    expect(container.querySelector('blockquote.md-quote')).toBeTruthy();
  });
});
