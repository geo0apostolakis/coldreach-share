import Sidebar, { MobileNav, MobileTopBar } from "@/components/Sidebar";
import SpendStrip from "@/components/SpendStrip";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // dvh, not vh: on iOS the browser chrome makes 100vh taller than the
    // visible area, which hides the bottom of the page behind the toolbar.
    <div className="flex min-h-[100dvh] md:h-[100dvh]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <SpendStrip />
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
