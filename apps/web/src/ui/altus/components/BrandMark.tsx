/** Flap mark + Jost wordmark. href → link (logo→Dashboard); no href → inert (Onboarding, FEAT-030). */
export function BrandMark({ href }: { href?: string }) {
  const inner = (
    <>
      <img src="/assets/abc-flap-mark.svg" alt="ABC Budget" width={56} height={30} />
      <div className="f-disp brand-name">ABC&nbsp;Budget</div>
    </>
  );
  return href ? (
    <a className="brand" href={href}>{inner}</a>
  ) : (
    <div className="brand">{inner}</div>
  );
}
