/**
 * TelegramCommandsTab — Command definitions + command logs
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Terminal, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface CommandDef {
  name: string;
  permission: string;
  description: string;
}

interface CommandLog {
  id: number;
  chatId: string;
  command: string;
  status: string;
  isAuthorized: boolean;
  permissionLevel: string | null;
  errorMessage: string | null;
  executionTimeMs: number | null;
  createdAt: string;
}

const permissionColor: Record<string, string> = {
  read_only: "text-blue-400 border-blue-500/40",
  action: "text-yellow-400 border-yellow-500/40",
  admin: "text-red-400 border-red-500/40",
};

export default function TelegramCommandsTab() {
  const { data: commands = [] } = useQuery<CommandDef[]>({
    queryKey: ["telegramCommands"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/commands");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: logs = [] } = useQuery<CommandLog[]>({
    queryKey: ["telegramCommandLogs"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/command-logs?limit=50");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Terminal className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Comandos Autorizados</CardTitle>
              <CardDescription className="text-xs">{commands.length} comandos registrados</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {commands.map((cmd) => (
              <div key={cmd.name} className="flex items-center justify-between p-2 rounded-lg border border-border/30">
                <div>
                  <span className="font-mono text-xs font-bold">{cmd.name}</span>
                  <p className="text-[10px] text-muted-foreground">{cmd.description}</p>
                </div>
                <Badge variant="outline" className={`text-[10px] ${permissionColor[cmd.permission] || ""}`}>
                  <Shield className="h-2.5 w-2.5 mr-1" />{cmd.permission}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Historial de Comandos</CardTitle>
          <CardDescription className="text-xs">Últimos 50 comandos ejecutados</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-xs">Sin registros de comandos</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-2 px-2 text-muted-foreground">Fecha</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Chat</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Comando</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Estado</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Permiso</th>
                    <th className="text-right py-2 px-2 text-muted-foreground">Tiempo</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-border/20">
                      <td className="py-1.5 px-2 font-mono text-[10px]">{new Date(log.createdAt).toLocaleString("es-ES")}</td>
                      <td className="py-1.5 px-2 font-mono text-[10px]">{log.chatId}</td>
                      <td className="py-1.5 px-2 font-mono">{log.command}</td>
                      <td className="py-1.5 px-2">
                        <Badge variant="outline" className={`text-[10px] ${log.status === "executed" ? "text-green-400" : log.status === "unauthorized" ? "text-red-400" : "text-yellow-400"}`}>
                          {log.status}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-2 text-[10px]">{log.permissionLevel || "—"}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-[10px]">{log.executionTimeMs ? `${log.executionTimeMs}ms` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
