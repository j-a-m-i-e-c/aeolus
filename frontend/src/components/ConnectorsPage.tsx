// frontend/src/components/ConnectorsPage.tsx — Connector management dashboard

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as icons from "lucide-react";
import { RefreshCw, Power, PowerOff, RotateCcw, ChevronRight, X, Loader2 } from "lucide-react";
import {
  fetchAvailableConnectors,
  fetchEnabledConnectors,
  enableConnector,
  disableConnector,
  retryConnector,
  executeConnectorSetupStep,
  fetchSetupSteps,
  patchConnectorConfig,
} from "../lib/api-client";

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

interface ConnectorType {
  metadata: {
    id: string;
    displayName: string;
    icon: string;
    description: string;
    supportedDeviceTypes: string[];
    requiresSetup: boolean;
  };
  configSchema: ConfigField[];
}

interface EnabledConnector {
  id: string;
  connectorType: string;
  displayName: string;
  icon: string;
  config: Record<string, unknown>;
  health: { status: "connected" | "degraded" | "disconnected"; lastSeen: number; errorMessage?: string };
  deviceCount: number;
  enabled: boolean;
}

interface SetupStep {
  id: string;
  title: string;
  description: string;
  fields?: ConfigField[];
}

// ---------------------------------------------------------------------------
// Dynamic Lucide icon helper (same pattern as Sidebar.tsx)
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

function HealthDot({ status }: { status: "connected" | "degraded" | "disconnected" }) {
  const color =
    status === "connected" ? "bg-[#22C55E]" :
    status === "degraded" ? "bg-[#F59E0B]" :
    "bg-[#EF4444]";
  return <div className={`w-2.5 h-2.5 rounded-full ${color}`} title={status} />;
}

// ---------------------------------------------------------------------------
// Dynamic config form
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
      {schema.map((field) => (
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
// Setup wizard component
// ---------------------------------------------------------------------------

function SetupWizard({
  connectorId,
  steps,
  onComplete,
  onCancel,
}: {
  connectorId: string;
  steps: SetupStep[];
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [stepParams, setStepParams] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [accumulatedConfig, setAccumulatedConfig] = useState<Record<string, unknown>>({});

  const currentStep = steps[currentStepIdx];

  const executeStep = async () => {
    if (!currentStep) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await executeConnectorSetupStep(connectorId, currentStep.id, { ...stepParams, ...accumulatedConfig });
      setMessage(String(result.message || ""));

      if (result.data) {
        setAccumulatedConfig((prev) => ({ ...prev, ...(result.data as Record<string, unknown>) }));
      }

      if (result.complete) {
        // Patch connector config with accumulated data before completing
        const finalConfig = result.data
          ? { ...accumulatedConfig, ...(result.data as Record<string, unknown>) }
          : accumulatedConfig;
        try {
          await patchConnectorConfig(connectorId, finalConfig);
        } catch {
          // Best-effort patch — wizard still closes
        }
        onComplete();
      } else if (result.success && currentStepIdx < steps.length - 1) {
        setCurrentStepIdx((i) => i + 1);
        setStepParams({});
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Step failed");
    }
    setLoading(false);
  };

  if (!currentStep) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-[#6B7785]">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center gap-1">
            <span className={`px-2 py-0.5 rounded ${i === currentStepIdx ? "bg-primary/20 text-primary" : i < currentStepIdx ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-elevated text-[#6B7785]"}`}>
              {i + 1}
            </span>
            <span className={i === currentStepIdx ? "text-[#E6EDF3]" : ""}>{step.title}</span>
            {i < steps.length - 1 && <ChevronRight size={12} />}
          </div>
        ))}
      </div>

      <p className="text-sm text-[#9AA6B2]">{currentStep.description}</p>

      {currentStep.fields && currentStep.fields.length > 0 && (
        <ConfigForm schema={currentStep.fields} values={stepParams} onChange={setStepParams} />
      )}

      {message && (
        <p className={`text-xs px-3 py-2 rounded-lg ${message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") ? "bg-[#EF4444]/10 text-[#EF4444]" : "bg-primary/10 text-primary"}`}>
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 text-xs font-medium rounded-lg bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2] transition-colors">
          Cancel
        </button>
        <button
          onClick={executeStep}
          disabled={loading}
          className="flex-1 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : currentStepIdx < steps.length - 1 ? "Continue" : "Finish"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ConnectorsPage component
// ---------------------------------------------------------------------------

export function ConnectorsPage() {
  const [available, setAvailable] = useState<ConnectorType[]>([]);
  const [enabled, setEnabled] = useState<EnabledConnector[]>([]);
  const [loading, setLoading] = useState(true);

  // Config form state for enabling a connector
  const [configuringType, setConfiguringType] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});

  // Setup wizard state
  const [setupConnectorId, setSetupConnectorId] = useState<string | null>(null);
  const [setupSteps, setSetupSteps] = useState<SetupStep[]>([]);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [avail, en] = await Promise.all([
        fetchAvailableConnectors(),
        fetchEnabledConnectors(),
      ]);
      setAvailable(avail as unknown as ConnectorType[]);
      setEnabled(en as unknown as EnabledConnector[]);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Build a set of enabled connector types for quick lookup
  const enabledTypes = new Set(enabled.map((e) => e.connectorType));

  // ---- Enable flow ----
  const handleEnableClick = (connType: ConnectorType) => {
    setConfiguringType(connType.metadata.id);
    // Pre-fill defaults
    const defaults: Record<string, unknown> = {};
    for (const field of connType.configSchema) {
      if (field.default !== undefined) defaults[field.id] = field.default;
    }
    setConfigValues(defaults);
  };

  const handleEnableSubmit = async () => {
    if (!configuringType) return;
    setActionLoading(configuringType);
    try {
      const result = await enableConnector(configuringType, configValues);

      // Check if this connector requires setup
      const connType = available.find((a) => a.metadata.id === configuringType);
      if (connType?.metadata.requiresSetup && result.id) {
        // Fetch setup steps from the backend
        try {
          const steps = await fetchSetupSteps(result.id) as unknown as SetupStep[];
          if (steps.length > 0) {
            setSetupConnectorId(result.id);
            setSetupSteps(steps);
          }
        } catch {
          // If fetching steps fails, connector is still enabled
        }
      }

      setConfiguringType(null);
      setConfigValues({});
      await refresh();
    } catch (err) {
      // Error is shown via the API client
    }
    setActionLoading(null);
  };

  const handleDisable = async (id: string) => {
    setActionLoading(id);
    try {
      await disableConnector(id);
      await refresh();
    } catch {}
    setActionLoading(null);
  };

  const handleRetry = async (id: string) => {
    setActionLoading(id);
    try {
      await retryConnector(id);
      await refresh();
    } catch {}
    setActionLoading(null);
  };

  if (loading) {
    return <div className="text-center py-12 text-[#6B7785]">Loading connectors...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Connectors</h1>
        <button onClick={refresh} className="text-[#6B7785] hover:text-primary transition-colors" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Setup wizard overlay */}
      <AnimatePresence>
        {setupConnectorId && setupSteps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-surface border border-primary/30 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#E6EDF3]">Setup Required</h2>
              <button onClick={() => { setSetupConnectorId(null); setSetupSteps([]); }} className="text-[#6B7785] hover:text-[#9AA6B2]">
                <X size={16} />
              </button>
            </div>
            <SetupWizard
              connectorId={setupConnectorId}
              steps={setupSteps}
              onComplete={() => { setSetupConnectorId(null); setSetupSteps([]); refresh(); }}
              onCancel={() => { setSetupConnectorId(null); setSetupSteps([]); }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Enabled connectors */}
      {enabled.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-[#9AA6B2] uppercase tracking-wider">Active Connectors</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {enabled.map((conn) => (
              <div key={conn.id} className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <DynamicIcon name={conn.icon} size={18} className="text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">{conn.displayName}</div>
                      <div className="text-[10px] text-[#6B7785] font-mono">{conn.connectorType}</div>
                    </div>
                  </div>
                  <HealthDot status={conn.health.status} />
                </div>

                <div className="flex items-center gap-4 text-xs text-[#9AA6B2]">
                  <span>{conn.deviceCount} device{conn.deviceCount !== 1 ? "s" : ""}</span>
                  <span className="capitalize">{conn.health.status}</span>
                  {conn.health.lastSeen > 0 && (
                    <span>Last seen {new Date(conn.health.lastSeen).toLocaleTimeString()}</span>
                  )}
                </div>

                {conn.health.errorMessage && (
                  <p className="text-[10px] text-[#EF4444] bg-[#EF4444]/10 px-2 py-1 rounded">{conn.health.errorMessage}</p>
                )}

                <div className="flex gap-2">
                  {conn.health.status === "disconnected" && (
                    <button
                      onClick={() => handleRetry(conn.id)}
                      disabled={actionLoading === conn.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30 hover:bg-[#F59E0B]/30 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={12} />
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => handleDisable(conn.id)}
                    disabled={actionLoading === conn.id}
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

      {/* Available connector types */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-[#9AA6B2] uppercase tracking-wider">Available Connectors</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {available.map((connType) => {
            const isEnabled = enabledTypes.has(connType.metadata.id);
            const isConfiguring = configuringType === connType.metadata.id;

            return (
              <div key={connType.metadata.id} className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-elevated">
                      <DynamicIcon name={connType.metadata.icon} size={18} className="text-[#9AA6B2]" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">{connType.metadata.displayName}</div>
                      <div className="text-[10px] text-[#6B7785]">{connType.metadata.description}</div>
                    </div>
                  </div>
                  {isEnabled ? (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#22C55E]/20 text-[#22C55E]">Active</span>
                  ) : (
                    <button
                      onClick={() => isConfiguring ? setConfiguringType(null) : handleEnableClick(connType)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
                    >
                      <Power size={12} />
                      {isConfiguring ? "Cancel" : "Enable"}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {connType.metadata.supportedDeviceTypes.map((dt) => (
                    <span key={dt} className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-[#6B7785]">{dt}</span>
                  ))}
                  {connType.metadata.requiresSetup && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F59E0B]/10 text-[#F59E0B]">setup required</span>
                  )}
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
                      {connType.configSchema.length > 0 && (
                        <ConfigForm schema={connType.configSchema} values={configValues} onChange={setConfigValues} />
                      )}
                      <button
                        onClick={handleEnableSubmit}
                        disabled={actionLoading === connType.metadata.id}
                        className="w-full py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === connType.metadata.id ? (
                          <Loader2 size={14} className="animate-spin mx-auto" />
                        ) : (
                          "Enable Connector"
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
            <p className="text-sm">No connector types discovered</p>
            <p className="text-[10px] mt-1">Add connector modules to src/connectors/ and restart</p>
          </div>
        )}
      </div>
    </div>
  );
}

// End of ConnectorsPage
