"use client";

import { CalendarDays, CircleUserRound, Map as MapIcon, Search, Users, type LucideIcon } from "lucide-react";

export type TabId = "map" | "classes" | "friends" | "account" | "search";

type Tab = { id: TabId; label: string; icon: LucideIcon; badge?: number };

type TabBarProps = {
  selected: TabId;
  showFriends: boolean;
  showAccount: boolean;
  friendsWaiting: number;
  onSelect: (tab: TabId) => void;
};

function TabButton({
  tab,
  selected,
  iconOnlyWhenFloating = false,
  onSelect,
}: {
  tab: Tab;
  selected: boolean;
  iconOnlyWhenFloating?: boolean;
  onSelect: (tab: TabId) => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      aria-label={tab.badge ? `${tab.label}, ${tab.badge} waiting` : tab.label}
      data-selected={selected || undefined}
      onClick={() => onSelect(tab.id)}
      className="group flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full py-1 text-muted outline-none transition-colors duration-200 active:opacity-70 focus-visible:ring-2 focus-visible:ring-focus data-[selected]:text-foreground floating:gap-0.5 floating:py-1.5 floating:data-[selected]:bg-accent-soft floating:data-[selected]:text-accent-soft-foreground">
      <span className="relative flex h-8 w-16 items-center justify-center rounded-full transition-colors duration-200 group-data-[selected]:bg-accent-soft group-data-[selected]:text-accent-soft-foreground floating:h-6 floating:w-auto floating:group-data-[selected]:bg-transparent">
        <Icon className="size-[22px]" strokeWidth={1.9} aria-hidden />
        {tab.badge ? (
          <span
            aria-hidden
            className="absolute -top-0.5 left-[calc(50%+0.4rem)] flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-danger-foreground">
            {tab.badge > 9 ? "9+" : tab.badge}
          </span>
        ) : null}
      </span>
      <span
        className={
          iconOnlyWhenFloating
            ? "max-w-full truncate text-xs font-medium leading-none floating:sr-only"
            : "max-w-full truncate text-xs font-medium leading-none floating:text-[10px] floating:font-semibold"
        }>
        {tab.label}
      </span>
    </button>
  );
}

/**
 * The app's tab bar on phones, so the site works like the app someone would install. iPhones get the floating
 * capsule with search on its own; Android phones get the bar along the bottom with a pill behind the selected tab.
 * Tablets and computers never see it and keep the buttons by the search field.
 */
export function TabBar({ selected, showFriends, showAccount, friendsWaiting, onSelect }: TabBarProps) {
  const tabs: Tab[] = [
    { id: "map", label: "Map", icon: MapIcon },
    { id: "classes", label: "Classes", icon: CalendarDays },
    ...(showFriends ? [{ id: "friends" as const, label: "Friends", icon: Users, badge: friendsWaiting }] : []),
    ...(showAccount ? [{ id: "account" as const, label: "Account", icon: CircleUserRound }] : []),
  ];
  const search: Tab = { id: "search", label: "Search", icon: Search };

  return (
    <nav
      aria-label="Main"
      className="animate-fade-in absolute inset-x-0 bottom-0 z-40 hidden items-stretch gap-1 border-t border-separator bg-overlay px-2 pb-[max(0.5rem,calc(var(--device-safe-bottom)-0.25rem))] pt-2 phone:flex floating:bottom-[max(0.75rem,calc(var(--device-safe-bottom)-0.75rem))] floating:gap-2.5 floating:border-0 floating:bg-transparent floating:pb-0 floating:pl-[max(1rem,var(--map-safe-left))] floating:pr-[max(1rem,var(--map-safe-right))] floating:pt-0 floating:pointer-events-none">
      <div className="glass-chrome contents floating:pointer-events-auto floating:flex floating:flex-1 floating:items-stretch floating:gap-1 floating:rounded-full floating:border floating:border-separator floating:bg-overlay floating:p-1 floating:shadow-xl">
        {tabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} selected={selected === tab.id} onSelect={onSelect} />
        ))}
      </div>
      <div className="glass-chrome contents floating:pointer-events-auto floating:flex floating:size-[3.75rem] floating:shrink-0 floating:rounded-full floating:border floating:border-separator floating:bg-overlay floating:p-1 floating:shadow-xl">
        <TabButton tab={search} selected={selected === "search"} iconOnlyWhenFloating onSelect={onSelect} />
      </div>
    </nav>
  );
}
