import React, { useState, useEffect } from 'react';
import { Download, Trash2, Star, RefreshCw, Database, Code, HardDrive, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

interface BackupFile {
  name: string;
  type: 'database' | 'code' | 'full';
  path: string;
  size: string;
  createdAt: string;
  isMaster: boolean;
  masterInfo?: MasterBackup;
}

interface MasterBackup {
  id: number;
  name: string;
  originalName: string | null;
  type: string;
  filePath: string;
  size: string;
  notes: string | null;
  createdAt: string;
  markedAsMasterAt: string;
  metrics: any;
  systemInfo: any;
  tags: string[];
  priority: number;
  protection: string;
}

interface DiskSpace {
  total: string;
  used: string;
  available: string;
  percentage: string;
}

interface BackupsData {
  backups: BackupFile[];
  diskSpace: DiskSpace;
  masters: MasterBackup[];
  stats: {
    total: number;
    masterCount: number;
  };
}

export default function Backups() {
  const [data, setData] = useState<BackupsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupFile | null>(null);
  const [createType, setCreateType] = useState<'full' | 'database' | 'code'>('full');
  const [createName, setCreateName] = useState('');
  const [masterNotes, setMasterNotes] = useState('');
  const [restoreConfirmation, setRestoreConfirmation] = useState('');

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    try {
      const response = await fetch('/api/backups');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error loading backups:', error);
    } finally {
      setLoading(false);
    }
  };

  const createBackup = async () => {
    setCreating(true);
    try {
      const response = await fetch('/api/backups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: createType, name: createName || undefined }),
      });

      if (response.ok) {
        setShowCreateModal(false);
        setCreateName('');
        await loadBackups();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error creating backup:', error);
      alert('Error creating backup');
    } finally {
      setCreating(false);
    }
  };

  const markAsMaster = async () => {
    if (!selectedBackup) return;

    try {
      const response = await fetch(`/api/backups/${selectedBackup.name}/set-master`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: masterNotes, captureMetrics: true }),
      });

      if (response.ok) {
        setShowMasterModal(false);
        setMasterNotes('');
        setSelectedBackup(null);
        await loadBackups();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error marking as master:', error);
      alert('Error marking as master');
    }
  };

  const unmarkMaster = async (name: string) => {
    if (!confirm('¿Desmarcar este backup como maestro?')) return;

    try {
      const response = await fetch(`/api/backups/${name}/unmark-master`, {
        method: 'POST',
      });

      if (response.ok) {
        await loadBackups();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error unmarking master:', error);
    }
  };

  const restoreBackup = async () => {
    if (!selectedBackup) return;

    const expectedConfirmation = selectedBackup.isMaster ? 'RESTAURAR MAESTRO' : 'CONFIRMAR';
    if (restoreConfirmation !== expectedConfirmation) {
      alert(`Debes escribir exactamente: ${expectedConfirmation}`);
      return;
    }

    try {
      const response = await fetch(`/api/backups/${selectedBackup.name}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          confirmation: restoreConfirmation, 
          type: selectedBackup.type 
        }),
      });

      if (response.ok) {
        alert('Restauración iniciada. El bot se reiniciará.');
        setShowRestoreModal(false);
        setRestoreConfirmation('');
        setSelectedBackup(null);
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error restoring backup:', error);
      alert('Error restoring backup');
    }
  };

  const deleteBackup = async (name: string) => {
    if (!confirm('¿Eliminar este backup permanentemente?')) return;

    try {
      const response = await fetch(`/api/backups/${name}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await loadBackups();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting backup:', error);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'database':
        return <Database className="w-4 h-4" />;
      case 'code':
        return <Code className="w-4 h-4" />;
      default:
        return <HardDrive className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'database':
        return 'text-blue-500';
      case 'code':
        return 'text-yellow-500';
      default:
        return 'text-purple-500';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const masterBackups = data?.masters || [];
  const regularBackups = data?.backups.filter(b => !b.isMaster) || [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Backups</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Gestión de copias de seguridad y restauración
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Crear Backup
        </button>
      </div>

      {/* Disk Space Stats */}
      {data?.diskSpace && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <HardDrive className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Espacio en Disco</p>
                <p className="text-xs text-gray-500">
                  {data.diskSpace.used} usado de {data.diskSpace.total}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {data.diskSpace.available}
              </p>
              <p className="text-xs text-gray-500">disponible</p>
            </div>
          </div>
          <div className="mt-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: data.diskSpace.percentage }}
            />
          </div>
        </div>
      )}

      {/* Master Backups */}
      {masterBackups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
            Backups Maestros
          </h2>
          {masterBackups.map((master) => (
            <div
              key={master.id}
              className="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-lg p-4 border-2 border-yellow-400 dark:border-yellow-600"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                    <h3 className="font-bold text-gray-900 dark:text-white">{master.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getTypeColor(master.type)}`}>
                      {master.type}
                    </span>
                  </div>
                  {master.notes && (
                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-2 italic">
                      "{master.notes}"
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Creado</p>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {formatDate(master.markedAsMasterAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-gray-400">Tamaño</p>
                      <p className="font-medium text-gray-900 dark:text-white">{master.size}</p>
                    </div>
                  </div>
                  {master.metrics && (
                    <div className="mt-3 p-3 bg-white/50 dark:bg-gray-800/50 rounded border border-yellow-200 dark:border-yellow-800">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Métricas al momento del backup:
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-gray-500">Trades</p>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {master.metrics.totalTrades || 0}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Posiciones</p>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {master.metrics.openPositions || 0}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">PnL</p>
                          <p className={`font-medium ${master.metrics.totalPnlUsd >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ${master.metrics.totalPnlUsd?.toFixed(2) || '0.00'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 ml-4">
                  <button
                    onClick={() => {
                      setSelectedBackup(data?.backups.find(b => b.name === master.name) || null);
                      setShowRestoreModal(true);
                    }}
                    className="px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 text-sm font-medium"
                  >
                    Restaurar
                  </button>
                  <button
                    onClick={() => unmarkMaster(master.name)}
                    className="px-3 py-1.5 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
                  >
                    Desmarcar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Regular Backups */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Backups Regulares ({regularBackups.length})
        </h2>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Tipo
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Nombre
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Fecha
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Tamaño
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {regularBackups.map((backup) => (
                <tr key={backup.name} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div className={`flex items-center gap-2 ${getTypeColor(backup.type)}`}>
                      {getTypeIcon(backup.type)}
                      <span className="text-xs font-medium">{backup.type}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                    {backup.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(backup.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {backup.size}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setSelectedBackup(backup);
                          setShowMasterModal(true);
                        }}
                        className="p-1.5 text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded"
                        title="Marcar como maestro"
                      >
                        <Star className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedBackup(backup);
                          setShowRestoreModal(true);
                        }}
                        className="p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                        title="Restaurar"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteBackup(backup.name)}
                        className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Backup Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              Crear Nuevo Backup
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Tipo de Backup
                </label>
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="full">Completo (DB + Código)</option>
                  <option value="database">Solo Base de Datos</option>
                  <option value="code">Solo Código</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Nombre (opcional)
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="backup_personalizado"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                disabled={creating}
              >
                Cancelar
              </button>
              <button
                onClick={createBackup}
                disabled={creating}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {creating ? 'Creando...' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark as Master Modal */}
      {showMasterModal && selectedBackup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-500" />
              Marcar como Backup Maestro
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Backup: <span className="font-medium">{selectedBackup.name}</span>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Notas (opcional)
                </label>
                <textarea
                  value={masterNotes}
                  onChange={(e) => setMasterNotes(e.target.value)}
                  placeholder="Ej: Bot estable después de fix phantom buys. PnL positivo, sin errores en 48h"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  ⚠️ Los backups maestros están protegidos y no se eliminan automáticamente.
                  Máximo 2 maestros permitidos.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowMasterModal(false);
                  setMasterNotes('');
                  setSelectedBackup(null);
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={markAsMaster}
                className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600"
              >
                Marcar como Maestro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Modal */}
      {showRestoreModal && selectedBackup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {selectedBackup.isMaster ? 'Restaurar Backup Maestro' : 'Restaurar Backup'}
              </h3>
            </div>
            <div className="space-y-4">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-2">
                  ⚠️ ADVERTENCIA: Esta acción es irreversible
                </p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  Se perderán todos los cambios realizados después de este backup.
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                  Backup: <span className="font-medium">{selectedBackup.name}</span>
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                  Fecha: <span className="font-medium">{formatDate(selectedBackup.createdAt)}</span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Escribe "{selectedBackup.isMaster ? 'RESTAURAR MAESTRO' : 'CONFIRMAR'}" para continuar
                </label>
                <input
                  type="text"
                  value={restoreConfirmation}
                  onChange={(e) => setRestoreConfirmation(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowRestoreModal(false);
                  setRestoreConfirmation('');
                  setSelectedBackup(null);
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={restoreBackup}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Restaurar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
