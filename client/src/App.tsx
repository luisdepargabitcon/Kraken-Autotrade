import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import Settings from "@/pages/Settings";
import Terminal from "@/pages/Terminal";
import Strategies from "@/pages/Strategies";
import Wallet from "@/pages/Wallet";
import Integrations from "@/pages/Integrations";
import Guide from "@/pages/Guide";
import Monitor from "@/pages/Monitor";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/settings" component={Settings} />
      <Route path="/terminal" component={Terminal} />
      <Route path="/strategies" component={Strategies} />
      <Route path="/wallet" component={Wallet} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/guide" component={Guide} />
      <Route path="/monitor" component={Monitor} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
