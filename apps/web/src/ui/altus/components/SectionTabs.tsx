export interface SectionTab {
  id: string;
  label: string;
}

export interface SectionTabsProps {
  tabs: SectionTab[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** Light gold-underline section tabs (.set-subnav/.subnav-tab) — in-page view switch. */
export function SectionTabs({ tabs, activeId, onSelect }: SectionTabsProps) {
  return (
    <div className="set-subnav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tab.id === activeId ? 'subnav-tab on' : 'subnav-tab'}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
