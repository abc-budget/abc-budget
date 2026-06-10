import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BADGE_STATES, BrandMark, Chip, CodeChip, Cream, Crt, Gauge, Key, Lamp,
  Panel, PanelBody, PanelHeader, Paper, SectionTabs, StateBadge, Stepper, ZoneSwitcher,
} from '../components';
import { CatIcon, ICON_GROUPS, iconName } from '../icons';

/** QA fixtures — NOT reference data (currency strings are samples; real currency
 *  display wires through the engine at Story 1.6 / ENT-019). */
const FIXTURE_BADGE_LABELS: Record<string, string> = {
  within: 'В МЕЖАХ', almost: 'МАЙЖЕ ЛІМІТ', over: 'ПЕРЕВИЩЕНО', muted: 'АРХІВ', history: 'ІСТОРІЯ',
};
const KEY_VARIANTS = ['gold', 'green', 'orange', 'beige', 'ebony'] as const;
const LAMP_TONES = ['green', 'gold', 'orange', 'gray', 'off'] as const;
const LAMP_WORDS: Record<string, string> = { green: 'ОК', gold: 'УВАГА', orange: 'ПОМИЛКА', gray: 'АВТО', off: 'ВИМК' };

function GallerySectionTabs() {
  const [tab, setTab] = useState('overview');
  return (
    <SectionTabs
      tabs={[{ id: 'overview', label: 'Огляд' }, { id: 'categories', label: 'Категорії' }]}
      activeId={tab}
      onSelect={setTab}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel screws>
      <PanelHeader logchip="QA" title={title} />
      <PanelBody>{children}</PanelBody>
    </Panel>
  );
}

export function Gallery() {
  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--sp-section)', display: 'grid', gap: 'var(--sp-section)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <BrandMark />
        <span className="eyebrow">ALTUS component gallery · QA chrome · not product IA</span>
      </header>

      <Section title="Типографіка">
        <div style={{ display: 'grid', gap: 'var(--sp-m)' }}>
          <span className="eyebrow-ink">eyebrow-ink · SPECIMEN</span>
          <div className="h-display" style={{ fontSize: 44 }}>Заголовок Display</div>
          <div className="h-sec">Секційний заголовок</div>
          <p className="body-p">Основний текст. Plain Ukrainian — ALTUS is the look, not the words.</p>
          <span className="mono-s">MONO-S · ЛЕЙБЛ</span>
          <span className="amount" style={{ fontSize: 28 }}>12 480,50 <CodeChip>UAH</CodeChip></span>
          <span className="eyebrow-ink">(суми/ISO — fixture, не довідник валют)</span>
        </div>
      </Section>

      <Section title="Клавіші (keys)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-m)', alignItems: 'center' }}>
          {KEY_VARIANTS.map((v) => <Key key={v} variant={v}>{v}</Key>)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-m)', alignItems: 'center', marginTop: 'var(--sp-m)' }}>
          {KEY_VARIANTS.map((v) => <Key key={v} variant={v} sm>{v} sm</Key>)}
          <Key variant="gold" pressed>pressed</Key>
          <Key variant="green" icon={<CatIcon id="income" size={18} color="currentColor" />}>з іконкою</Key>
        </div>
      </Section>

      <Section title="Лампи (+ слово — §4)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-l)' }}>
          {LAMP_TONES.map((t) => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Lamp tone={t} /><span className="mono-s">{LAMP_WORDS[t]}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Стани (badges — §4: колір + іконка + лейбл)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-m)' }}>
          {BADGE_STATES.map((s) => <StateBadge key={s} state={s} label={FIXTURE_BADGE_LABELS[s]} />)}
          <StateBadge state="over" label="ПЕРЕВИЩЕНО" extra="+12%" />
        </div>
      </Section>

      <Section title="Поверхні">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--sp-l)' }}>
          <Cream style={{ padding: 'var(--sp-l)' }}><span className="mono-s">cream</span></Cream>
          <Crt>CRT · READY ▮</Crt>
          <Paper style={{ padding: 'var(--sp-l)', background: 'var(--beige)' }}><span className="mono-s">paper grid</span></Paper>
        </div>
      </Section>

      <Section title="Dot-matrix gauge">
        <div style={{ display: 'grid', gap: 'var(--sp-l)' }}>
          <Gauge spent={40} budget={100} state="within" />
          <Gauge spent={85} budget={100} state="almost" />
          <Gauge spent={150} budget={100} state="over" overLimitLabel="понад ліміт" />
          <Gauge spent={50} budget={100} state="within" archived />
          <Gauge spent={0} budget={0} state="muted" />
        </div>
      </Section>

      <Section title="Chips">
        <div style={{ display: 'flex', gap: 'var(--sp-m)', alignItems: 'center' }}>
          <Chip>Очистити фільтр</Chip>
          <CodeChip>USD</CodeChip>
          <span className="logchip">LOG-CHIP</span>
        </div>
      </Section>

      <Section title="Бренд">
        <div style={{ display: 'flex', gap: 'var(--sp-section)', alignItems: 'center' }}>
          <BrandMark />
          <BrandMark href="#" />
        </div>
      </Section>

      <Section title="Навігаційний хром">
        <div style={{ display: 'grid', gap: 'var(--sp-l)' }}>
          <div className="eyebrow-ink">zone-switcher (dwell headers)</div>
          <div style={{ display: 'flex' }}>
            <ZoneSwitcher
              items={[{ id: 'dashboard', label: 'Дашборд' }, { id: 'settings', label: 'Налаштування' }]}
              activeId="dashboard"
              renderItem={(item, active) => (
                <a key={item.id} href="#" onClick={(e) => e.preventDefault()} className={active ? 'zone on' : 'zone'}>
                  {item.label}
                </a>
              )}
            />
          </div>
          <div className="eyebrow-ink">section-tabs (Settings, in-page)</div>
          <GallerySectionTabs />
          <div className="eyebrow-ink">stepper (Import flow) · resize під 760px → «КРОК N / 4»</div>
          <Stepper
            steps={[{ id: 'a', label: 'ФАЙЛ' }, { id: 'b', label: 'КОЛОНКИ' }, { id: 'c', label: 'КАТЕГОРІЇ' }, { id: 'd', label: 'ОГЛЯД' }]}
            activeIndex={2}
            mobileLabel="КРОК 3 / 4"
          />
        </div>
      </Section>

      <Section title={`Іконки · ${ICON_GROUPS.reduce((n, g) => n + g.items.length, 0)} гліфів · 16px і 24px`}>
        <div style={{ display: 'grid', gap: 'var(--sp-l)' }}>
          {ICON_GROUPS.map((grp) => (
            <Fragment key={grp.id}>
              <div className="eyebrow-ink">{grp.uk} / {grp.en}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-l)' }}>
                {grp.items.map((it) => (
                  <span key={it.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <CatIcon id={it.id} size={16} />
                    <CatIcon id={it.id} size={24} />
                    <span className="mono-s">{iconName(it.id, 'uk')}</span>
                  </span>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      </Section>
    </main>
  );
}
