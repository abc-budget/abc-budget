import { Link } from 'react-router';
import { BrandMark, LangToggle, Stepper, ZoneSwitcher } from '../ui/altus/components';
import type { StepperStep } from '../ui/altus/components';
import { useLang, useT } from './i18n/LangProvider';

/** Wired UK/EN toggle — consumes LangProvider (App-level). */
function LangSlot() {
  const { lang, setLang } = useLang();
  return (
    <div data-slot="lang">
      <LangToggle lang={lang} onChange={setLang} />
    </div>
  );
}

/** Linked brand: SPA navigation via router Link, keeping the .brand styling. */
function BrandLink() {
  return (
    <Link to="/dashboard" style={{ textDecoration: 'none' }}>
      <BrandMark />
    </Link>
  );
}

/** Dashboard + Settings header — identical composition, active zone highlighted. */
export function DwellHeader({ activeZone }: { activeZone: 'dashboard' | 'settings' }) {
  const t = useT();
  const items = [
    { id: 'dashboard', label: t('zoneDashboard') },
    { id: 'settings', label: t('zoneSettings') },
  ];
  return (
    <header className="topbar">
      <BrandLink />
      <div className="topbar-right">
        <ZoneSwitcher
          items={items}
          activeId={activeZone}
          renderItem={(item, active) => (
            <Link key={item.id} to={`/${item.id}`} className={active ? 'zone on' : 'zone'}>
              {item.label}
            </Link>
          )}
        />
        <LangSlot />
      </div>
    </header>
  );
}

/** Import wizard header — stepper instead of zone-switcher (focused flow). */
export function FlowHeader({ steps, activeIndex }: { steps: StepperStep[]; activeIndex: number }) {
  const t = useT();
  const mobileLabel = t('stepOfTotal', { n: activeIndex + 1, total: steps.length });
  return (
    <header className="topbar">
      <BrandLink />
      <Stepper steps={steps} activeIndex={activeIndex} mobileLabel={mobileLabel} />
      <LangSlot />
    </header>
  );
}

/** Onboarding header — brand deliberately INERT (no home yet, FEAT-030). */
export function OnboardingHeader() {
  return (
    <header className="topbar">
      <BrandMark />
      <LangSlot />
    </header>
  );
}
