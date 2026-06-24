"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Film,
  Play,
  Users,
  Settings2,
  SlidersHorizontal,
  Mail,
  FileText,
  Scissors,
  Share2,
  LayoutDashboard,
} from "lucide-react";
import { Sidebar } from "@/components/ui/sidebar";

// ── Section definitions ────────────────────────────────────────────────────────

const SECTIONS = [
  {
    id: "outreach",
    icon: Mail,
    label: "Outreach",
    items: [
      { title: "Dashboard", href: "/outreach/dashboard", icon: LayoutDashboard },
      { title: "Leads", href: "/outreach/prospects", icon: Users },
      { title: "Templates", href: "/outreach/templates", icon: FileText },
    ],
  },
  {
    id: "clipping",
    icon: Scissors,
    label: "Clipping",
    items: [
      { title: "New Clip", href: "/clip", icon: Scissors },
      { title: "Projects", href: "/clip/projects", icon: Film },
      { title: "Social Accounts", href: "/clip/social", icon: Share2 },
    ],
  },
  {
    id: "content",
    icon: Film,
    label: "Content",
    items: [
      { title: "Videos", href: "/videos", icon: Film },
      { title: "Run Pipeline", href: "/run", icon: Play },
      { title: "Creators", href: "/creators", icon: Users },
      { title: "Configs", href: "/configs", icon: Settings2 },
    ],
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function getSectionFromPath(pathname: string): SectionId {
  if (pathname.startsWith("/outreach")) return "outreach";
  if (pathname.startsWith("/clip")) return "clipping";
  return "content";
}

const DEFAULT_PANEL_WIDTH = 180;
const MIN_PANEL_WIDTH = 120;
const MAX_PANEL_WIDTH = 280;

// ── Component ─────────────────────────────────────────────────────────────────

export function AppSidebar() {
  const pathname = usePathname();
  const [activeSection, setActiveSection] = useState<SectionId>(() =>
    getSectionFromPath(pathname)
  );
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const isDragging = useRef(false);

  // Sync active section whenever the route changes
  useEffect(() => {
    setActiveSection(getSectionFromPath(pathname));
  }, [pathname]);

  useEffect(() => {
    fetch("/api/videos")
      .then((r) => r.json())
      .then((videos: { dateAdded: string }[]) => {
        if (videos.length > 0 && videos[0].dateAdded) {
          setLastRun(videos[0].dateAdded);
        }
      })
      .catch(() => {});
  }, []);

  const handleMouseLeave = () => {
    if (!isDragging.current && !isPinned) setIsOpen(false);
  };

  const handleSectionClick = (id: SectionId) => {
    if (activeSection === id && isPinned) {
      setIsPinned(false);
    } else {
      setActiveSection(id);
      setIsPinned(true);
      setIsOpen(true);
    }
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth + ev.clientX - startX));
      setPanelWidth(next);
    };

    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const currentSection =
    SECTIONS.find((s) => s.id === activeSection) ??
    SECTIONS.find((s) => s.id === "content") ??
    SECTIONS[0];

  return (
    <Sidebar
      collapsible="none"
      className="p-0 overflow-hidden shrink-0"
      style={{
        width: isOpen ? 58 + panelWidth : 58,
        transition: "width 200ms cubic-bezier(0.4,0,0.2,1)",
      }}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex h-full">

        {/* ── Left icon strip ─────────────────────────────────────────────── */}
        <div className="flex w-[58px] shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] py-5 px-2">
          {/* App logo */}
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600">
            <Film className="h-4 w-4 text-white" />
          </div>

          {/* Section tabs */}
          {SECTIONS.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => handleSectionClick(section.id)}
                title={section.label}
                className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
                  isActive
                    ? "bg-white/[0.1] text-foreground"
                    : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 -translate-x-1 rounded-full bg-purple-400" />
                )}
                <section.icon className="h-4 w-4" />
              </button>
            );
          })}

          {/* Settings pinned to bottom */}
          <div className="mt-auto">
            <Link
              href="/settings"
              title="Settings"
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
                pathname === "/settings"
                  ? "bg-white/[0.1] text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* ── Right sub-nav panel (hover-reveal + resizable) ───────────────── */}
        <div
          className="relative flex flex-col overflow-hidden"
          style={{
            width: isOpen ? panelWidth : 0,
            opacity: isOpen ? 1 : 0,
            transition: "width 200ms cubic-bezier(0.4,0,0.2,1), opacity 150ms ease",
          }}
        >
          {/* Fixed-width inner to prevent text reflow during animation */}
          <div
            className="flex flex-col px-3 py-5 h-full"
            style={{ width: panelWidth, minWidth: panelWidth }}
          >
            {/* Section label */}
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {currentSection.label}
            </p>

            {/* Nav items */}
            <div className="space-y-0.5">
              {currentSection.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex h-10 items-center gap-2.5 rounded-xl px-3 text-[13px] transition-all duration-200 ${
                      isActive
                        ? "bg-white/[0.1] font-medium text-foreground"
                        : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.title}
                  </Link>
                );
              })}
            </div>

            {/* Footer */}
            {lastRun && (
              <div className="mt-auto px-2 pt-4">
                <p className="text-[10px] text-muted-foreground">
                  Last pipeline:{" "}
                  <span className="text-foreground/60">{lastRun}</span>
                </p>
              </div>
            )}
          </div>

          {/* Drag-to-resize handle */}
          <div
            onMouseDown={startDrag}
            title="Drag to resize"
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-purple-400/30 transition-colors duration-150"
          />
        </div>

      </div>
    </Sidebar>
  );
}
