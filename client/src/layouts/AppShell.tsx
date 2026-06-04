import { GlobalHeader } from "@/components/layout/GlobalHeader";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
