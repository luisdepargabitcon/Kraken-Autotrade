import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EventsWebSocketProvider } from "@/context/EventsWebSocketContext";
import { MobileTabBar } from "@/components/mobile/MobileTabBar";
import NexaHome from "@/pages/NexaHome";
import Dashboard from "@/pages/Dashboard";
import Settings from "@/pages/Settings";
import Terminal from "@/pages/Terminal";
import Strategies from "@/pages/Strategies";
import Wallet from "@/pages/Wallet";
import Integrations from "@/pages/Integrations";
import Notifications from "@/pages/Notifications";
import Guide from "@/pages/Guide";
import Monitor from "@/pages/Monitor";
import Backups from "@/pages/Backups";
import FiscoDashboard from "@/pages/FiscoDashboard";
import AiMl from "@/pages/AiMl";
import Autotuning from "@/pages/Autotuning";
import InstitutionalDca from "@/pages/InstitutionalDca";
import GridIsolated from "@/pages/GridIsolated";
import Telegram from "@/pages/Telegram";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      {/* NEXA Home */}
      <Route path="/" component={NexaHome} />

      {/* DCA Inteligente */}
      <Route path="/dca" component={InstitutionalDca} />
      <Route path="/institutional-dca"><Redirect to="/dca" /></Route>

      {/* Trading Activo */}
      <Route path="/trading" component={Strategies} />
      <Route path="/strategies"><Redirect to="/trading" /></Route>

      {/* Grid Isolated */}
      <Route path="/grid-isolated" component={GridIsolated} />

      {/* Fiscal Crypto */}
      <Route path="/fiscal" component={FiscoDashboard} />
      <Route path="/fisco"><Redirect to="/fiscal" /></Route>

      {/* Dashboard legacy */}
      <Route path="/dashboard-legacy" component={Dashboard} />

      {/* Telegram unificado */}
      <Route path="/telegram" component={Telegram} />

      {/* Sistema — rutas existentes */}
      <Route path="/settings" component={Settings} />
      <Route path="/terminal" component={Terminal} />
      <Route path="/wallet" component={Wallet} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/guide" component={Guide} />
      <Route path="/monitor" component={Monitor} />
      <Route path="/backups" component={Backups} />
      <Route path="/ai" component={AiMl} />
      <Route path="/autotuning" component={Autotuning} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <EventsWebSocketProvider>
          <Toaster />
          <div className="mobile-content-padding">
            <Router />
          </div>
          <MobileTabBar />
        </EventsWebSocketProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
