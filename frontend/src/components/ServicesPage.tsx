// frontend/src/components/ServicesPage.tsx — Service management dashboard

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as icons from "lucide-react";
import { RefreshCw, Power, PowerOff, RotateCcw, Loader2, Plus, Trash2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

// ---------------------------------------------------------------------------
// Types (matching backend API response shapes)
// ---------------------------------------------------------------------------

interface ConfigField {
  id: string;
  label: string;
  type: "text" | "number" | "password" | "boolean" | "select";
  required: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  helpText?: string;
  options?: Array<{ label: string; value: string }>;
}

interface ServiceType {
  metadata: {
    id: string;
    displayName: string;
    icon: string;
    description: string;
    category: string;
  };
  configSchema: ConfigField[];
}

interface EnabledService {
  id: string;
  serviceType: string;
  displayName: string;
  icon: string;
  config: Record<string, unknown>;
  health: { status: "running" | "degraded" | "stopped"; lastActivity: number; errorMessage?: string };
  enabled: boolean;
}

interface ScheduleEntry {
  name: string;
  cron: string;
}

// ---------------------------------------------------------------------------
// Dynamic Lucide icon helper
// ---------------------------------------------------------------------------

function DynamicIcon({ name, size, className }: { name: string; size?: number; className?: string }) {
  const Icon = (icons as Record<string, unknown>)[
    name.charAt(0).toUpperCase() + name.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  ] as React.ComponentType<{ size?: number; className?: string }> | undefined;
  if (!Icon) return <icons.Layout size={size} className={className} />;
  return <Icon size={size} className={className} />;
}

// ---------------------------------------------------------------------------
// Health status indicator
// ---------------------------------------------------------------------------

function HealthDot({ status }: { status: "running" | "degraded" | "stopped" }) {
  const color =
    status === "running" ? "bg-[#22C55E]" :
    status === "degraded" ? "bg-[#F59E0B]" :
    "bg-[#EF4444]";
  return <div className={`w-2.5 h-2.5 rounded-full ${color}`} title={status} />;
}

// ---------------------------------------------------------------------------
// Dynamic config form (reused from ConnectorsPage pattern)
// ---------------------------------------------------------------------------

function ConfigForm({
  schema,
  values,
  onChange,
}: {
  schema: ConfigField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const update = (fieldId: string, value: unknown) => {
    onChange({ ...values, [fieldId]: value });
  };

  return (
    <div className="space-y-3">
      {schema.filter((f) => f.id !== "schedules").map((field) => (
        <div key={field.id}>
          <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1">
            {field.label}
            {field.required && <span className="text-[#EF4444] ml-0.5">*</span>}
          </label>

          {field.type === "boolean" ? (
            <button
              onClick={() => update(field.id, !values[field.id])}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                values[field.id]
                  ? "bg-primary/20 text-primary border-primary/30"
                  : "bg-elevated text-[#6B7785] border-[#2A3441]"
              }`}
            >
              {values[field.id] ? "Enabled" : "Disabled"}
            </button>
          ) : field.type === "select" ? (
            <select
              value={String(values[field.id] ?? field.default ?? "")}
              onChange={(e) => update(field.id, e.target.value)}
              className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] focus:outline-none focus:border-primary"
            >
              <option value="">Select...</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
              placeholder={field.placeholder}
              value={String(values[field.id] ?? field.default ?? "")}
              onChange={(e) => update(field.id, field.type === "number" ? Number(e.target.value) : e.target.value)}
              className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
            />
          )}

          {field.helpText && (
            <p className="text-[10px] text-[#6B7785] mt-0.5">{field.helpText}</p>
          )}
        </div>
      ))}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Cron Schedule Editor (Task 14.3)
// ---------------------------------------------------------------------------

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: "Every minute", cron: "*/1 * * * *" },
  { label: "Every 5 minutes", cron: "*/5 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Daily at midnight", cron: "0 0 * * *" },
  { label: "Daily at 6am", cron: "0 6 * * *" },
];

function CronScheduleEditor({
  schedules,
  onChange,
}: {
  schedules: ScheduleEntry[];
  onChange: (schedules: ScheduleEntry[]) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCron, setNewCron] = useState("");

  const handleAdd = () => {
    if (!newName.trim() || !newCron.trim()) return;
    onChange([...schedules, { name: newName.trim(), cron: newCron.trim() }]);
    setNewName("");
    setNewCron("");
    setShowAddForm(false);
  };

  const handleRemove = (index: number) => {
    onChange(schedules.filter((_, i) => i !== index));
  };

  const handlePreset = (preset: { label: string; cron: string }) => {
    setNewCron(preset.cron);
    if (!newName.trim()) {
      setNewName(preset.label.toLowerCase().replace(/\s+/g, "-"));
    }
  };

  return (
    <div className="space-y-3">
      <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
        Schedules
      </label>

      {/* Existing schedules */}
      {schedules.length > 0 && (
        <div className="space-y-2">
          {schedules.map((s, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated border border-[#2A3441]">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[#E6EDF3] truncate">{s.name}</div>
                <div className="text-[10px] text-[#6B7785] font-mono">{s.cron}</div>
              </div>
              <button
                onClick={() => handleRemove(i)}
                className="text-[#6B7785] hover:text-[#EF4444] transition-colors shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add schedule form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 p-3 rounded-lg bg-elevated border border-[#2A3441]"
          >
            <input
              type="text"
              placeholder="Schedule name (e.g. every-5m)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary"
            />
            <input
              type="text"
              placeholder="Cron expression (e.g. */5 * * * *)"
              value={newCron}
              onChange={(e) => setNewCron(e.target.value)}
              className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
            />

            {/* Preset buttons */}
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.cron}
                  onClick={() => handlePreset(preset)}
                  className="text-[10px] px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || !newCron.trim()}
                className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewName(""); setNewCron(""); }}
                className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2] transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <Plus size={14} />
          Add Schedule
        </button>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Main ServicesPage component
// ---------------------------------------------------------------------------

export function ServicesPage() {
  const [available, setAvailable] = useState<ServiceType[]>([]);
  const [enabled, setEnabled] = useState<EnabledService[]>([]);
  const [loading, setLoading] = useState(true);

  // Config form state for enabling a service
  const [configuringType, setConfiguringType] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [cronSchedules, setCronSchedules] = useState<ScheduleEntry[]>([]);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [availRes, enRes] = await Promise.all([
        fetch(`${API_URL}/api/services/available`).then((r) => r.json()),
        fetch(`${API_URL}/api/services`).then((r) => r.json()),
      ]);
      setAvailable(availRes as ServiceType[]);
      setEnabled(enRes as EnabledService[]);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enabledTypes = new Set(enabled.map((e) => e.serviceType));

  // ---- Enable flow ----
  const handleEnableClick = (svcType: ServiceType) => {
    setConfiguringType(svcType.metadata.id);
    const defaults: Record<string, unknown> = {};
    for (const field of svcType.configSchema) {
      if (field.default !== undefined) defaults[field.id] = field.default;
    }
    setConfigValues(defaults);
    setCronSchedules([]);
  };

  const handleEnableSubmit = async () => {
    if (!configuringType) return;
    setActionLoading(configuringType);
    try {
      const finalConfig = { ...configValues };
      // For cron service, inject schedules into config
      if (configuringType === "cron") {
        finalConfig.schedules = cronSchedules;
      }
      await fetch(`${API_URL}/api/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_type: configuringType, config: finalConfig }),
      });
      setConfiguringType(null);
      setConfigValues({});
      setCronSchedules([]);
      await refresh();
    } catch {}
    setActionLoading(null);
  };

  const handleDisable = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch(`${API_URL}/api/services/${id}`, { method: "DELETE" });
      await refresh();
    } catch {}
    setActionLoading(null);
  };

  const handleRetry = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch(`${API_URL}/api/services/${id}/retry`, { method: "POST" });
      await refresh();
    } catch {}
    setActionLoading(null);
  };

  if (loading) {
    return <div className="text-center py-12 text-[#6B7785]">Loading services...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Services</h1>
        <button onClick={refresh} className="text-[#6B7785] hover:text-primary transition-colors" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Active Services */}
      {enabled.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-[#9AA6B2] uppercase tracking-wider">Active Services</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {enabled.map((svc) => (
              <div key={svc.id} className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <DynamicIcon name={svc.icon} size={18} className="text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">{svc.displayName}</div>
                      <div className="text-[10px] text-[#6B7785] font-mono">{svc.serviceType}</div>
                    </div>
                  </div>
                  <HealthDot status={svc.health.status} />
                </div>

                <div className="flex items-center gap-4 text-xs text-[#9AA6B2]">
                  <span className="capitalize">{svc.health.status}</span>
                  {svc.health.lastActivity > 0 && (
                    <span>Last activity {new Date(svc.health.lastActivity).toLocaleTimeString()}</span>
                  )}
                </div>

                {/* Config summary */}
                {Object.keys(svc.config).length > 0 && (
                  <div className="text-[10px] text-[#6B7785] font-mono bg-elevated rounded px-2 py-1.5 max-h-16 overflow-auto">
                    {Object.entries(svc.config).map(([k, v]) => (
                      <div key={k}>{k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
                    ))}
                  </div>
                )}

                {svc.health.errorMessage && (
                  <p className="text-[10px] text-[#EF4444] bg-[#EF4444]/10 px-2 py-1 rounded">{svc.health.errorMessage}</p>
                )}

                <div className="flex gap-2">
                  {svc.health.status === "stopped" && (
                    <button
                      onClick={() => handleRetry(svc.id)}
                      disabled={actionLoading === svc.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30 hover:bg-[#F59E0B]/30 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={12} />
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => handleDisable(svc.id)}
                    disabled={actionLoading === svc.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/20 transition-colors disabled:opacity-50"
                  >
                    <PowerOff size={12} />
                    Disable
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Services */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-[#9AA6B2] uppercase tracking-wider">Available Services</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {available.map((svcType) => {
            const isEnabled = enabledTypes.has(svcType.metadata.id);
            const isConfiguring = configuringType === svcType.metadata.id;
            const isCron = svcType.metadata.id === "cron";
            const hasConfigFields = svcType.configSchema.filter((f) => f.id !== "schedules").length > 0;

            return (
              <div key={svcType.metadata.id} className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-elevated">
                      <DynamicIcon name={svcType.metadata.icon} size={18} className="text-[#9AA6B2]" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">{svcType.metadata.displayName}</div>
                      <div className="text-[10px] text-[#6B7785]">{svcType.metadata.description}</div>
                    </div>
                  </div>
                  {isEnabled ? (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#22C55E]/20 text-[#22C55E]">Active</span>
                  ) : (
                    <button
                      onClick={() => isConfiguring ? setConfiguringType(null) : handleEnableClick(svcType)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
                    >
                      <Power size={12} />
                      {isConfiguring ? "Cancel" : "Enable"}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-[#6B7785]">{svcType.metadata.category}</span>
                </div>

                {/* Config form when enabling */}
                <AnimatePresence>
                  {isConfiguring && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-3 pt-2 border-t border-[#2A3441]"
                    >
                      {hasConfigFields && (
                        <ConfigForm schema={svcType.configSchema} values={configValues} onChange={setConfigValues} />
                      )}

                      {/* Cron schedule editor */}
                      {isCron && (
                        <CronScheduleEditor schedules={cronSchedules} onChange={setCronSchedules} />
                      )}

                      <button
                        onClick={handleEnableSubmit}
                        disabled={actionLoading === svcType.metadata.id}
                        className="w-full py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === svcType.metadata.id ? (
                          <Loader2 size={14} className="animate-spin mx-auto" />
                        ) : (
                          "Enable Service"
                        )}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {available.length === 0 && (
          <div className="text-center py-8 text-[#6B7785]">
            <p className="text-sm">No service types discovered</p>
            <p className="text-[10px] mt-1">Register service modules and restart</p>
          </div>
        )}
      </div>
    </div>
  );
}
