import type { ReactNode } from 'react';

export interface ZoneItem {
  id: string;
  label: string;
}

export interface ZoneSwitcherProps {
  items: ZoneItem[];
  activeId: string;
  /** The app injects the actual element (router <Link className="zone [on]">). */
  renderItem: (item: ZoneItem, active: boolean) => ReactNode;
}

/** Dark inset zone-switcher (.zone-nav). Presentational — routing is the app's job. */
export function ZoneSwitcher({ items, activeId, renderItem }: ZoneSwitcherProps) {
  return <nav className="zone-nav">{items.map((item) => renderItem(item, item.id === activeId))}</nav>;
}
