import { Fragment } from 'react';

export interface StepperStep {
  id: string;
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  activeIndex: number;
  /** Mobile eyebrow text (e.g. «КРОК 2 / 4») — caller-supplied, i18n-agnostic. */
  mobileLabel: string;
}

/** Wizard stepper (.stepper/.stp). CSS hides .stepper and shows .ob-step-m under 760px.
 *  Prototype (s3a-app.jsx): done dots show '✓'; active/todo dots show zero-padded
 *  two-digit number: String(i + 1).padStart(2, '0'). stp-rule renders after each step
 *  except the last. */
export function Stepper({ steps, activeIndex, mobileLabel }: StepperProps) {
  return (
    <>
      <div className="stepper">
        {steps.map((step, i) => {
          const cls = i < activeIndex ? 'stp done' : i === activeIndex ? 'stp on' : 'stp';
          return (
            <Fragment key={step.id}>
              <div className={cls}>
                <span className="stp-dot f-mono">{i < activeIndex ? '✓' : String(i + 1).padStart(2, '0')}</span>
                <span className="stp-lab f-disp">{step.label}</span>
              </div>
              {i < steps.length - 1 && <span className="stp-rule" />}
            </Fragment>
          );
        })}
      </div>
      <span className="ob-step-m f-mono">{mobileLabel}</span>
    </>
  );
}
