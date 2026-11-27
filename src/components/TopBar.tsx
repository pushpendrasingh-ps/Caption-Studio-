import { Download } from 'lucide-react';
import {
  ASPECT_RATIOS,
  RESOLUTION_OPTIONS,
  type AspectRatioId,
  type ResolutionId,
} from '../core/types';

export type WorkspaceTab = 'studio' | 'subtitles' | 'android';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  aspectId: AspectRatioId;
  onChangeAspect: (id: AspectRatioId) => void;
  resolutionId: ResolutionId;
  onChangeResolution: (id: ResolutionId) => void;
  onOpenExport: () => void;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; mobileLabel: string }> = [
  { id: 'studio', label: 'Studio', mobileLabel: 'Studio' },
  { id: 'subtitles', label: 'Subtitles', mobileLabel: 'Subtitles' },
  { id: 'android', label: 'Android Source', mobileLabel: 'Kotlin' },
];

const ASPECT_LIST: AspectRatioId[] = ['16:9', '9:16', '1:1'];

export function TopBar({
  activeTab,
  onSelectTab,
  aspectId,
  onChangeAspect,
  resolutionId,
  onChangeResolution,
  onOpenExport,
}: TopBarProps) {
  const cycleAspect = () => {
    const idx = ASPECT_LIST.indexOf(aspectId);
    onChangeAspect(ASPECT_LIST[(idx + 1) % ASPECT_LIST.length]);
  };

  return (
    <header className="z-30 h-[52px] shrink-0 border-b border-white/[0.08] bg-[#0C0D10]/95 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-1 px-2 sm:gap-4 sm:px-5">
        {/* Left: Brand Title */}
        <button
          type="button"
          onClick={() => onSelectTab('studio')}
          className="text-xs font-bold tracking-tight text-[#F4F5F7] whitespace-nowrap shrink-0 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316]"
        >
          <span className="sm:hidden">CS</span>
          <span className="hidden sm:inline">CaptionStudio</span>
          <span className="hidden lg:inline"> {resolutionId}</span>
        </button>

        {/* Center: Studio / Subtitles / Android Source Switcher */}
        <nav aria-label="Workspace navigation" className="flex items-center gap-2 sm:gap-6">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectTab(item.id)}
                className={`relative flex h-[52px] items-center text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#F97316] ${
                  isActive ? 'text-[#F4F5F7]' : 'text-[#9BA1AE] hover:text-[#F4F5F7]'
                }`}
              >
                <span className="sm:hidden">{item.mobileLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[2px] bg-[#F97316]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Multi-Resolution Selector + Aspect Ratio Selector + Export MP4 CTA */}
        <div className="relative flex items-center gap-1 shrink-0 sm:gap-2">
          {/* Resolution Dropdown (1080p, 720p, 540p, 480p, 360p) */}
          <label htmlFor="topbar-resolution-select" className="sr-only">
            Output resolution
          </label>
          <select
            id="topbar-resolution-select"
            aria-label="Output resolution"
            value={resolutionId}
            onChange={(e) => onChangeResolution(e.target.value as ResolutionId)}
            className="h-8 rounded-lg border border-white/[0.12] bg-[#161920] px-1 font-mono text-[11px] font-semibold text-[#F4F5F7] transition-colors hover:bg-[#222630] focus:border-[#F97316] focus:outline-none sm:h-9 sm:px-2.5 sm:text-xs"
          >
            {RESOLUTION_OPTIONS.map((res) => (
              <option key={res.id} value={res.id} className="bg-[#14161B] text-[#F4F5F7]">
                {res.id}
              </option>
            ))}
          </select>

          {/* Mobile: Compact 1-tap aspect ratio cycle button */}
          <button
            type="button"
            onClick={cycleAspect}
            aria-label={`Aspect ratio ${aspectId}, tap to cycle`}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-white/[0.12] bg-[#161920] px-1.5 font-mono text-[11px] font-semibold text-[#F4F5F7] transition-colors hover:bg-[#222630] whitespace-nowrap shrink-0 sm:hidden"
          >
            {aspectId}
          </button>

          {/* Desktop / Tablet: Full 16:9 / 9:16 / 1:1 segmented selector */}
          <div
            role="group"
            aria-label="Output aspect ratio"
            className="hidden sm:inline-flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-[#14161B] p-0.5"
          >
            {ASPECT_LIST.map((id) => {
              const spec = ASPECT_RATIOS[id];
              const active = aspectId === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChangeAspect(id)}
                  className={`h-8 rounded-md px-2.5 font-mono text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#F97316] ${
                    active
                      ? 'bg-[#262A34] text-[#F4F5F7]'
                      : 'text-[#9BA1AE] hover:text-[#F4F5F7]'
                  }`}
                >
                  {spec.shortLabel}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onOpenExport}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#F97316] px-2 text-[11px] font-semibold text-[#0C0D10] transition-colors hover:bg-[#FB923C] active:scale-[0.98] whitespace-nowrap shrink-0 sm:h-9 sm:gap-1.5 sm:px-3.5 sm:text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316]"
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="sm:hidden">Export</span>
            <span className="hidden sm:inline">Export MP4</span>
          </button>
        </div>
      </div>
    </header>
  );
}
