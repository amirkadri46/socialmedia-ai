"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Sun, Moon } from "lucide-react";
import { Show, UserButton } from "@clerk/nextjs";

const pageTitles: Record<string, string> = {
  "/videos": "Videos",
  "/run": "Run Pipeline",
  "/creators": "Creators",
  "/configs": "Configs",
  "/settings": "Settings",
  "/outreach/prospects": "Leads",
  "/outreach/dashboard": "Lead Dashboard",
  "/outreach/templates": "Templates",
};

export function TopBar() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "Virality System";
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-black/[0.06] dark:border-white/[0.06] bg-background/80 px-6 backdrop-blur-xl">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
      <div className="h-4 w-px bg-black/10 dark:bg-white/10" />
      <span className="text-sm font-medium">{title}</span>
      <div className="ml-auto flex items-center gap-2">
        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-all"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        )}
        <Show when="signed-in">
          <UserButton />
        </Show>
      </div>
    </div>
  );
}
