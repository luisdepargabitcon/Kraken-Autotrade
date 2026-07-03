import { GridOverviewPanel } from "./GridOverviewPanel";
import { GridMarketContextPanel } from "./GridMarketContextPanel";
import { GridWalletSummaryPanel } from "./GridWalletSummaryPanel";
import { GridExecutionPolicyPanel } from "./GridExecutionPolicyPanel";
import { GridLiveActivityPanel } from "./GridLiveActivityPanel";
import { GridLevelsPanel } from "./GridLevelsPanel";
import { GridCyclesPanel } from "./GridCyclesPanel";
import { GridRangeHistoryPanel } from "./GridRangeHistoryPanel";
import { GridEngineStatusPanel } from "./GridEngineStatusPanel";

interface GridSummaryPanelProps {
  config: any;
  status: any;
  auditData: any;
  levels: any[];
  cycles: any[];
  unlockCheck: any;
  modeColor: (mode: string) => string;
  onModeChange: (mode: string) => void;
  onAcknowledge: () => void;
  onReconcile: () => void;
  modeMutationPending: boolean;
  acknowledgePending: boolean;
  reconcilePending: boolean;
  onGoToTab: (tab: string) => void;
  onActivate: (active: boolean) => void;
  onShadowValidate: () => void;
  activatePending: boolean;
  shadowValidatePending: boolean;
}

export function GridSummaryPanel({
  config, status, auditData, levels, cycles, unlockCheck,
  modeColor, onModeChange, onAcknowledge, onReconcile,
  modeMutationPending, acknowledgePending, reconcilePending,
  onGoToTab, onActivate, onShadowValidate, activatePending, shadowValidatePending,
}: GridSummaryPanelProps) {
  const mode = config?.mode || "OFF";
  const lastTickAt = (status as any)?.lastTickAt ?? null;
  const lastTickReason = (status as any)?.lastTickReason ?? null;
  const functionalStatus = auditData?.functionalStatus;
  const range = auditData?.range;
  const rangeHistory: any[] = auditData?.rangeHistory || [];
  const wallet = auditData?.wallet;

  return (
    <div className="space-y-4">
      {/* Row 1: Overview (wide) + Engine Status (sidebar) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <GridOverviewPanel
            functionalStatus={functionalStatus}
            lastTickReason={lastTickReason}
            lastTickAt={lastTickAt}
          />
        </div>
        <div className="lg:col-span-4">
          <GridEngineStatusPanel
            config={config}
            status={status}
            auditData={auditData}
            unlockCheck={unlockCheck}
            modeColor={modeColor}
            onModeChange={onModeChange}
            onAcknowledge={onAcknowledge}
            onReconcile={onReconcile}
            onActivate={onActivate}
            onShadowValidate={onShadowValidate}
            modeMutationPending={modeMutationPending}
            acknowledgePending={acknowledgePending}
            reconcilePending={reconcilePending}
            activatePending={activatePending}
            shadowValidatePending={shadowValidatePending}
          />
        </div>
      </div>

      {/* Row 2: Market Context (wide) + Wallet + Execution Policy */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <GridMarketContextPanel
            range={range}
            status={status}
            mode={mode}
            onGoToTab={onGoToTab}
          />
        </div>
        <div className="lg:col-span-4 space-y-4">
          <GridWalletSummaryPanel
            wallet={wallet}
            config={config}
            status={status}
            onGoToTab={onGoToTab}
          />
          <GridExecutionPolicyPanel />
        </div>
      </div>

      {/* Row 3: Live Activity (wide) */}
      <GridLiveActivityPanel />

      {/* Row 4: Levels + Cycles side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GridLevelsPanel
          levels={levels}
          mode={mode}
          onGoToTab={onGoToTab}
        />
        <GridCyclesPanel
          cycles={cycles}
          onGoToTab={onGoToTab}
        />
      </div>

      {/* Row 5: Range History */}
      <GridRangeHistoryPanel rangeHistory={rangeHistory} />
    </div>
  );
}
