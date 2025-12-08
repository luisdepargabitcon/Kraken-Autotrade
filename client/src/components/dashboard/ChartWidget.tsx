import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const data = [
  { time: "00:00", value: 12400 },
  { time: "04:00", value: 12600 },
  { time: "08:00", value: 13200 },
  { time: "12:00", value: 12900 },
  { time: "16:00", value: 13500 },
  { time: "20:00", value: 14100 },
  { time: "24:00", value: 14800 },
];

export function ChartWidget() {
  return (
    <Card className="col-span-2 glass-panel border-border/50 h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium font-mono tracking-wider text-muted-foreground">
          RENDIMIENTO DEL PORTAFOLIO
        </CardTitle>
        <Tabs defaultValue="24h" className="h-8">
          <TabsList className="h-8 bg-muted/50 border border-border/50">
            <TabsTrigger value="1h" className="text-xs h-6 px-2">1H</TabsTrigger>
            <TabsTrigger value="24h" className="text-xs h-6 px-2">24H</TabsTrigger>
            <TabsTrigger value="7d" className="text-xs h-6 px-2">7D</TabsTrigger>
            <TabsTrigger value="30d" className="text-xs h-6 px-2">30D</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="flex-1 min-h-[300px] w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis 
              dataKey="time" 
              stroke="hsl(var(--muted-foreground))" 
              fontSize={12} 
              tickLine={false} 
              axisLine={false}
              fontFamily="JetBrains Mono"
            />
            <YAxis 
              stroke="hsl(var(--muted-foreground))" 
              fontSize={12} 
              tickLine={false} 
              axisLine={false}
              tickFormatter={(value) => `$${value}`}
              fontFamily="JetBrains Mono"
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                borderColor: 'hsl(var(--border))',
                borderRadius: 'var(--radius)',
                fontFamily: 'JetBrains Mono'
              }}
              itemStyle={{ color: 'hsl(var(--primary))' }}
            />
            <Area 
              type="monotone" 
              dataKey="value" 
              stroke="hsl(var(--primary))" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorValue)" 
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
