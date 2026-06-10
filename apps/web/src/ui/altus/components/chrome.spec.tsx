import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LangToggle } from './LangToggle';
import { ZoneSwitcher } from './ZoneSwitcher';
import { SectionTabs } from './SectionTabs';
import { Stepper } from './Stepper';

const ZONES = [
  { id: 'dashboard', label: 'Дашборд' },
  { id: 'settings', label: 'Налаштування' },
];

describe('ZoneSwitcher', () => {
  it('renders .zone-nav and delegates item rendering (app injects links)', () => {
    const { container } = render(
      <ZoneSwitcher
        items={ZONES}
        activeId="dashboard"
        renderItem={(item, active) => (
          <a key={item.id} className={active ? 'zone on' : 'zone'} href={`/${item.id}`}>
            {item.label}
          </a>
        )}
      />,
    );
    const nav = container.firstElementChild!;
    expect(nav.className).toBe('zone-nav');
    const links = nav.querySelectorAll('a.zone');
    expect(links).toHaveLength(2);
    expect(links[0].classList.contains('on')).toBe(true);
    expect(links[1].classList.contains('on')).toBe(false);
  });
});

describe('SectionTabs', () => {
  it('renders .subnav-tab buttons, marks active, fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      <SectionTabs
        tabs={[{ id: 'overview', label: 'Огляд' }, { id: 'categories', label: 'Категорії' }]}
        activeId="overview"
        onSelect={onSelect}
      />,
    );
    const overview = screen.getByRole('button', { name: 'Огляд' });
    const categories = screen.getByRole('button', { name: 'Категорії' });
    expect(overview.className).toBe('subnav-tab on');
    expect(categories.className).toBe('subnav-tab');
    categories.click();
    expect(onSelect).toHaveBeenCalledWith('categories');
  });
});

describe('Stepper', () => {
  const STEPS = [
    { id: 's3a', label: 'ФАЙЛ' },
    { id: 's3b', label: 'КОЛОНКИ' },
    { id: 's3c', label: 'КАТЕГОРІЇ' },
    { id: 's3d', label: 'ОГЛЯД' },
  ];
  it('marks done/on/todo by activeIndex and renders the mobile eyebrow', () => {
    const { container } = render(
      <Stepper steps={STEPS} activeIndex={2} mobileLabel="КРОК 3 / 4" />,
    );
    const stps = container.querySelectorAll('.stp');
    expect(stps).toHaveLength(4);
    expect(stps[0].className).toBe('stp done');
    expect(stps[1].className).toBe('stp done');
    expect(stps[2].className).toBe('stp on');
    expect(stps[3].className).toBe('stp');
    expect(container.querySelectorAll('.stp-rule')).toHaveLength(3); // between steps
    expect(container.querySelector('.ob-step-m')!.textContent).toBe('КРОК 3 / 4');
  });
  it('done dots show ✓, active/todo dots show zero-padded 2-digit number', () => {
    // Prototype: i < active ? '✓' : String(i + 1).padStart(2, '0')
    // e.g. step 1 → '01', step 2 → '02' (active), step 4 → '04'
    const { container } = render(<Stepper steps={STEPS} activeIndex={1} mobileLabel="КРОК 2 / 4" />);
    const dots = container.querySelectorAll('.stp-dot');
    expect(dots[0].textContent).toBe('✓');
    expect(dots[1].textContent).toBe('02');
    expect(dots[3].textContent).toBe('04');
  });
});

describe('LangToggle', () => {
  it('renders the group with globe + UK/EN buttons, active via aria-pressed', () => {
    const onChange = vi.fn();
    const { container } = render(<LangToggle lang="uk" onChange={onChange} />);
    const group = container.firstElementChild!;
    expect(group.className).toBe('langtog');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.querySelector('svg.globe')).not.toBeNull();
    const uk = screen.getByRole('button', { name: 'UK' });
    const en = screen.getByRole('button', { name: 'EN' });
    expect(uk.className).toBe('langbtn on');
    expect(uk.getAttribute('aria-pressed')).toBe('true');
    expect(en.className).toBe('langbtn');
    expect(en.getAttribute('aria-pressed')).toBe('false');
    en.click();
    expect(onChange).toHaveBeenCalledWith('en');
  });
});
