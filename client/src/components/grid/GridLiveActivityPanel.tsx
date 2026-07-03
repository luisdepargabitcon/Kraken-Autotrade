import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio } from "lucide-react";
import { GridActivityLive } from "./GridActivityLive";

export function GridLiveActivityPanel() {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4" />
          Actividad en directo del Grid
        </CardTitle>
      </CardHeader>
      <CardContent>
        <GridActivityLive />
      </CardContent>
    </Card>
  );
}
