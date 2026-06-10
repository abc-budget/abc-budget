import { Link } from 'react-router';
import { BrandMark, Stepper, ZoneSwitcher } from '../ui/altus/components';
import type { StepperStep } from '../ui/altus/components';

export const ZONES = [
  { id: 'dashboard', label: 'Дашборд' },
  { id: 'settings', label: 'Налаштування' },
] as const;

/** 1.4 replaces this placeholder with the persistent UK/EN toggle (FEAT-028). */
function LangSlot() {
  return <div data-slot="lang" />;
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
  return (
    <header className="topbar">
      <BrandLink />
      <div className="topbar-right">
        <ZoneSwitcher
          items={ZONES.map((z) => ({ ...z }))}
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
  return (
    <header className="topbar">
      <BrandLink />
      <Stepper steps={steps} activeIndex={activeIndex} mobileLabel={`КРОК ${activeIndex + 1} / ${steps.length}`} />
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
