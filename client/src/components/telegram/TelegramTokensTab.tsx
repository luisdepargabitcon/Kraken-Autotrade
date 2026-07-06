/**
 * TelegramTokensTab — Manage telegram_bot_tokens (multi-bot support)
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Key, Plus, Trash2, Check, X, Shield, Zap } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface TelegramToken {
  id: number;
  name: string;
  tokenLast4: string;
  isActive: boolean;
  isDefault: boolean;
  environment: string;
  createdAt: string;
}

export default function TelegramTokensTab() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newEnvironment, setNewEnvironment] = useState("production");
  const [newIsActive, setNewIsActive] = useState(true);
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [editingToken, setEditingToken] = useState<TelegramToken | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<TelegramToken>>({});

  const { data: tokens = [], isLoading } = useQuery<TelegramToken[]>({
    queryKey: ["telegramTokens"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/tokens");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const addToken = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTokenName,
          token: newToken,
          environment: newEnvironment,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramTokens"] });
      setNewTokenName("");
      setNewToken("");
      setNewEnvironment("production");
      setNewIsActive(true);
      setNewIsDefault(false);
      setShowAddForm(false);
      toast.success("Token añadido");
    },
    onError: () => toast.error("Error al añadir token"),
  });

  const updateToken = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<TelegramToken> & { id: number }) => {
      const res = await fetch(`/api/telegram/tokens/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramTokens"] });
      setEditingToken(null);
      setEditFormData({});
      toast.success("Token actualizado");
    },
    onError: () => toast.error("Error al actualizar token"),
  });

  const deleteToken = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/telegram/tokens/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramTokens"] });
      toast.success("Token eliminado");
    },
    onError: () => toast.error("Error al eliminar token"),
  });

  const testToken = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/telegram/tokens/${id}/test`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Token válido: bot conectado");
      } else {
        toast.error("Token inválido o bot no accesible");
      }
    },
    onError: () => toast.error("Error al probar token"),
  });

  const startEdit = (token: TelegramToken) => {
    setEditingToken(token);
    setEditFormData({
      name: token.name,
      isActive: token.isActive,
      isDefault: token.isDefault,
    });
  };

  const saveEdit = () => {
    if (!editingToken) return;
    updateToken.mutate({ id: editingToken.id, ...editFormData });
  };

  const activeCount = tokens.filter(t => t.isActive).length;
  const defaultToken = tokens.find(t => t.isDefault);

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Key className="h-5 w-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">Tokens de Telegram</CardTitle>
              <CardDescription className="text-xs">
                {activeCount} activos · {tokens.length} total · Default: {defaultToken?.name || "Ninguno"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add token button */}
          <Button size="sm" onClick={() => setShowAddForm(!showAddForm)} className="w-full">
            <Plus className="h-3 w-3 mr-1" /> {showAddForm ? "Cancelar" : "Añadir token"}
          </Button>

          {/* Add token form */}
          {showAddForm && (
            <div className="p-4 rounded-lg border border-border/50 bg-muted/30 space-y-3">
              <div>
                <Label className="text-xs">Nombre del bot</Label>
                <Input placeholder="Mi bot principal" value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} className="text-xs" />
              </div>
              <div>
                <Label className="text-xs">Token de Telegram</Label>
                <Input placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" value={newToken} onChange={(e) => setNewToken(e.target.value)} className="font-mono text-xs" type="password" />
              </div>
              <div>
                <Label className="text-xs">Entorno</Label>
                <select
                  value={newEnvironment}
                  onChange={(e) => setNewEnvironment(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs"
                >
                  <option value="production">Producción</option>
                  <option value="staging">Staging</option>
                  <option value="development">Desarrollo</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={newIsActive} onCheckedChange={setNewIsActive} />
                  <Label className="text-xs">Activo</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={newIsDefault} onCheckedChange={setNewIsDefault} />
                  <Label className="text-xs">Por defecto</Label>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={!newTokenName || !newToken || addToken.isPending} onClick={() => addToken.mutate()} className="flex-1">
                  <Plus className="h-3 w-3 mr-1" /> Guardar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} className="flex-1">
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Token list */}
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground text-xs">Cargando...</div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-xs">No hay tokens registrados</div>
          ) : (
            <div className="space-y-2">
              {tokens.map((token) => (
                <div key={token.id} className={`p-3 rounded-lg border ${token.isActive ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${token.isActive ? "text-green-400 border-green-500/40" : "text-red-400 border-red-500/40"}`}>
                        {token.isActive ? "ACTIVO" : "INACTIVO"}
                      </Badge>
                      {token.isDefault && (
                        <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/40">
                          <Zap className="h-2 w-2 mr-1" /> DEFAULT
                        </Badge>
                      )}
                      <span className="text-sm font-medium">{token.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">****{token.tokenLast4}</span>
                      <Badge variant="outline" className="text-[9px]">{token.environment}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={token.isActive} onCheckedChange={(v) => updateToken.mutate({ id: token.id, isActive: v })} />
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => startEdit(token)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => testToken.mutate(token.id)} disabled={testToken.isPending}>
                        <Shield className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteToken.mutate(token.id)}>
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Modal */}
      {editingToken && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border border-border max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Editar token</h3>
              <Button size="icon" variant="ghost" onClick={() => setEditingToken(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div>
              <Label className="text-xs">Nombre</Label>
              <Input value={editFormData.name || ""} onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })} className="text-xs" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={editFormData.isActive} onCheckedChange={(v) => setEditFormData({ ...editFormData, isActive: v })} />
                <Label className="text-xs">Activo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editFormData.isDefault} onCheckedChange={(v) => setEditFormData({ ...editFormData, isDefault: v })} />
                <Label className="text-xs">Por defecto</Label>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={saveEdit} disabled={updateToken.isPending} className="flex-1">
                Guardar cambios
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingToken(null)} className="flex-1">
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
