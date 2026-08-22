// frontend/src/components/ConnectorsPage.tsx — Connector management dashboard

import { useState, useEffect, useCallback, useRef } from "react";
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
import { useReadOnlyDemo } from "../hooks/useReadOnlyDemo";

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
  const [polling, setPolling] = useState(false);
  const [pollSeconds, setPollSeconds] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accumulatedRef = useRef(accumulatedConfig);
  accumulatedRef.current = accumulatedConfig;
  const stepParamsRef = useRef(stepParams);
  stepParamsRef.current = stepParams;

  const currentStep = steps[currentStepIdx];
  const isButtonPressStep = currentStep?.id === "press-button";

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setPolling(false);
    setPollSeconds(0);
  }, []);

  const completeWizard = useCallback(async (resultData?: Record<string, unknown>) => {
    stopPolling();
    const finalConfig = resultData
      ? { ...accumulatedRef.current, ...resultData }
      : accumulatedRef.current;
    try { await patchConnectorConfig(connectorId, finalConfig); } catch {}
    // Auto-connect after setup — triggers connect() + discoverDevices()
    try { await retryConnector(connectorId); } catch {}
    onComplete();
  }, [connectorId, onComplete, stopPolling]);

  // Auto-poll for button-press steps
  useEffect(() => {
    if (!isButtonPressStep || !currentStep) return;

    let attempts = 0;
    const maxAttempts = 10; // 30s at 3s intervals
    setPolling(true);
    setPollSeconds(0);

    const tick = async () => {
      attempts++;
      setPollSeconds(attempts * 3);

      if (attempts > maxAttempts) {
        stopPolling();
        setMessage("Timed out — press the bridge button and click Retry");
        return;
      }

      try {
        const result = await executeConnectorSetupStep(
          connectorId, currentStep.id,
          { ...stepParamsRef.current, ...accumulatedRef.current },
        );

        if (result.complete) {
          if (result.data) {
            setAccumulatedConfig((prev) => ({ ...prev, ...(result.data as Record<string, unknown>) }));
          }
          setMessage("Paired successfully!");
          await completeWizard(result.data as Record<string, unknown> | undefined);
          return;
        }
        // Button not pressed yet — keep polling silently
      } catch {
        // Network error — keep polling
      }
    };

    pollingRef.current = setInterval(tick, 3000);
    // Fire first attempt immediately
    tick();

    return () => stopPolling();
    // Polling is deliberately (re)started only when the wizard step changes;
    // the other referenced values are captured intentionally per step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepIdx]);

  const executeStep = async () => {
    if (!currentStep) return;
    // If we're on the button-press step and polling timed out, restart polling
    if (isButtonPressStep) {
      if (!polling) {
        setMessage("");
        setPolling(true);
        setPollSeconds(0);
        let attempts = 0;
        pollingRef.current = setInterval(async () => {
          attempts++;
          setPollSeconds(attempts * 3);
          if (attempts > 10) {
            stopPolling();
            setMessage("Timed out — press the bridge button and click Retry");
            return;
          }
          try {
            const result = await executeConnectorSetupStep(
              connectorId, currentStep.id,
              { ...stepParamsRef.current, ...accumulatedRef.current },
            );
            if (result.complete) {
              if (result.data) {
                setAccumulatedConfig((prev) => ({ ...prev, ...(result.data as Record<string, unknown>) }));
              }
              setMessage("Paired successfully!");
              await completeWizard(result.data as Record<string, unknown> | undefined);
            }
          } catch {}
        }, 3000);
      }
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const result = await executeConnectorSetupStep(connectorId, currentStep.id, { ...stepParams, ...accumulatedConfig });
      setMessage(String(result.message || ""));

      if (result.data) {
        setAccumulatedConfig((prev) => ({ ...prev, ...(result.data as Record<string, unknown>) }));
      }

      if (result.complete) {
        await completeWizard(result.data as Record<string, unknown> | undefined);
      } else if (result.success && currentStepIdx < steps.length - 1) {
        const nextStep = steps[currentStepIdx + 1];
        const prefilled: Record<string, unknown> = {};
        const newAccumulated = result.data
          ? { ...accumulatedConfig, ...(result.data as Record<string, unknown>) }
          : accumulatedConfig;
        if (nextStep?.fields) {
          for (const field of nextStep.fields) {
            if (newAccumulated[field.id] !== undefined) {
              prefilled[field.id] = newAccumulated[field.id];
            }
          }
        }
        setCurrentStepIdx((i) => i + 1);
        setStepParams(prefilled);
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

      <div className="text-sm text-[#9AA6B2] space-y-2">
        {currentStep.description.split("\n\n").map((block, i) => {
          const trimmed = block.trim();
          if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
            // Bold heading (e.g. **Prerequisites:**)
            return <h4 key={i} className="text-xs font-semibold text-[#E6EDF3] mt-3 first:mt-0">{trimmed.replace(/\*\*/g, "")}</h4>;
          }
          if (trimmed.includes("\n•") || trimmed.startsWith("•")) {
            // Bullet list
            const lines = trimmed.split("\n").filter(l => l.trim());
            // Check if first line is a heading
            const firstLine = lines[0].trim();
            const isHeading = firstLine.startsWith("**");
            return (
              <div key={i}>
                {isHeading && <h4 className="text-xs font-semibold text-[#E6EDF3] mt-3">{firstLine.replace(/\*\*/g, "")}</h4>}
                <ul className="space-y-1 mt-1">
                  {lines.filter(l => l.trim().startsWith("•")).map((line, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs text-[#9AA6B2]">
                      <span className="text-[#6B7785] mt-0.5">•</span>
                      <span>{line.trim().replace(/^•\s*/, "")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
          return <p key={i} className="text-xs">{trimmed}</p>;
        })}
      </div>

      {/* Visual pairing guide for physical button-press steps */}
      {isButtonPressStep && (
        <div className="flex items-center gap-4 p-4 rounded-xl bg-elevated border border-[#2A3441]">
          <div className="flex-shrink-0">
            <svg width="80" height="64" viewBox="0 0 80 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="8" y="20" width="64" height="36" rx="8" fill="#1A2330" stroke="#2A3441" strokeWidth="1.5" />
              <circle cx="20" cy="48" r="2" fill="#3BA4FF" opacity="0.6" />
              <circle cx="28" cy="48" r="2" fill="#3BA4FF" opacity="0.6" />
              <circle cx="36" cy="48" r="2" fill="#3BA4FF" opacity="0.6" />
              <circle cx="40" cy="20" r="12" fill="#121821" stroke="#3BA4FF" strokeWidth="2">
                <animate attributeName="stroke-opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx="40" cy="20" r="6" fill="#3BA4FF" opacity="0.3">
                <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2s" repeatCount="indefinite" />
              </circle>
              <path d="M62 8 L48 16" stroke="#5CE1E6" strokeWidth="1.5" strokeLinecap="round" markerEnd="url(#arrowhead)" />
              <defs>
                <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6" fill="none" stroke="#5CE1E6" strokeWidth="1" />
                </marker>
              </defs>
              <text x="64" y="8" fill="#5CE1E6" fontSize="8" fontFamily="Inter, sans-serif" fontWeight="600">Press</text>
            </svg>
          </div>
          <div className="space-y-1.5">
            {polling ? (
              <>
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-primary" />
                  <span className="text-xs font-medium text-[#E6EDF3]">Waiting for button press...</span>
                </div>
                <div className="w-full bg-[#2A3441] rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min((pollSeconds / 30) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-[#6B7785]">{30 - pollSeconds}s remaining</p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-[#F59E0B]/20 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-[#F59E0B]">!</span>
                  </div>
                  <span className="text-xs font-medium text-[#E6EDF3]">30-second pairing window</span>
                </div>
                <p className="text-[11px] text-[#6B7785] leading-relaxed">
                  Press the button on the bridge. Aeolus will detect it automatically.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {currentStep.fields && currentStep.fields.length > 0 && !isButtonPressStep && (
        <ConfigForm schema={currentStep.fields} values={{ ...accumulatedConfig, ...stepParams }} onChange={setStepParams} />
      )}

      {message && (
        <p className={`text-xs px-3 py-2 rounded-lg ${message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") || message.toLowerCase().includes("timed out") ? "bg-[#EF4444]/10 text-[#EF4444]" : "bg-primary/10 text-primary"}`}>
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 text-xs font-medium rounded-lg bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2] transition-colors">
          Cancel
        </button>
        {isButtonPressStep ? (
          !polling && (
            <button
              onClick={executeStep}
              className="flex-1 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
            >
              Retry
            </button>
          )
        ) : (
          <button
            onClick={executeStep}
            disabled={loading}
            className="flex-1 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Continue"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ConnectorsPage component
// ---------------------------------------------------------------------------

export function ConnectorsPage() {
  const readOnly = useReadOnlyDemo();
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
    // For connectors that require setup, skip the config form and enable immediately
    // The setup wizard will collect the necessary configuration
    if (connType.metadata.requiresSetup) {
      handleEnableWithSetup(connType.metadata.id);
      return;
    }
    setConfiguringType(connType.metadata.id);
    // Pre-fill defaults
    const defaults: Record<string, unknown> = {};
    for (const field of connType.configSchema) {
      if (field.default !== undefined) defaults[field.id] = field.default;
    }
    setConfigValues(defaults);
  };

  const handleEnableWithSetup = async (connectorTypeId: string) => {
    setActionLoading(connectorTypeId);
    try {
      const result = await enableConnector(connectorTypeId, {});
      if (result.id) {
        try {
          const steps = await fetchSetupSteps(result.id) as unknown as SetupStep[];
          if (steps.length > 0) {
            setSetupConnectorId(result.id);
            setSetupSteps(steps);
          }
        } catch {}
      }
      await refresh();
    } catch {}
    setActionLoading(null);
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
    } catch (_err) {
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

      {readOnly && (
        <div className="flex items-start gap-3 rounded-xl border border-[#31506A] bg-[#0D1822] px-4 py-3">
          <icons.LockKeyhole size={17} className="mt-0.5 shrink-0 text-[#72B7E6]" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8CC9F0]">
              Public demo · read only
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#8B9AAA]">
              This page shows the connector types and health surfaces Aeolus supports. Connector setup,
              configuration, enable/disable and retry actions are disabled in the hosted demo because they
              would require access to real hardware, networks or credentials.
            </p>
          </div>
        </div>
      )}

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
              <button onClick={async () => {
                const id = setupConnectorId;
                setSetupConnectorId(null);
                setSetupSteps([]);
                if (id) {
                  try { await disableConnector(id); } catch {}
                }
                refresh();
              }} className="text-[#6B7785] hover:text-[#9AA6B2]">
                <X size={16} />
              </button>
            </div>
            <SetupWizard
              connectorId={setupConnectorId}
              steps={setupSteps}
              onComplete={() => { setSetupConnectorId(null); setSetupSteps([]); refresh(); }}
              onCancel={async () => {
                // Disable the connector if setup was cancelled — it's useless without completing setup
                const id = setupConnectorId;
                setSetupConnectorId(null);
                setSetupSteps([]);
                if (id) {
                  try { await disableConnector(id); } catch {}
                }
                refresh();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Enabled connectors — hide connectors mid-setup or with incomplete setup */}
      {enabled.filter((conn) => {
        // Hide the connector currently going through the setup wizard
        if (conn.id === setupConnectorId) return false;
        // Hide requiresSetup connectors that never completed setup (disconnected, 0 devices, no config)
        const meta = available.find((a) => a.metadata.id === conn.connectorType);
        if (meta?.metadata.requiresSetup && conn.health.status === "disconnected" && conn.deviceCount === 0) {
          const hasConfig = Object.keys(conn.config).some((k) => conn.config[k] && conn.config[k] !== "********");
          if (!hasConfig) return false;
        }
        return true;
      }).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-[#9AA6B2] uppercase tracking-wider">Active Connectors</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {enabled.filter((conn) => {
              if (conn.id === setupConnectorId) return false;
              const meta = available.find((a) => a.metadata.id === conn.connectorType);
              if (meta?.metadata.requiresSetup && conn.health.status === "disconnected" && conn.deviceCount === 0) {
                const hasConfig = Object.keys(conn.config).some((k) => conn.config[k] && conn.config[k] !== "********");
                if (!hasConfig) return false;
              }
              return true;
            }).map((conn) => (
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

                {!readOnly && (
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
                )}
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

            // Check if this is a requiresSetup connector with incomplete setup (ghost record)
            const enabledInstance = enabled.find((e) => e.connectorType === connType.metadata.id);
            const isIncompleteSetup = isEnabled && connType.metadata.requiresSetup && enabledInstance
              && enabledInstance.health.status === "disconnected" && enabledInstance.deviceCount === 0
              && !Object.keys(enabledInstance.config).some((k) => enabledInstance.config[k] && enabledInstance.config[k] !== "********");

            const handleResumeSetup = async () => {
              if (!enabledInstance) return;
              setActionLoading(connType.metadata.id);
              try {
                const steps = await fetchSetupSteps(enabledInstance.id) as unknown as SetupStep[];
                if (steps.length > 0) {
                  setSetupConnectorId(enabledInstance.id);
                  setSetupSteps(steps);
                }
              } catch {}
              setActionLoading(null);
            };

            return (
              <div key={connType.metadata.id} className="bg-surface border border-[#2A3441] rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-elevated shrink-0">
                      <DynamicIcon name={connType.metadata.icon} size={20} className="text-[#9AA6B2]" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-[#E6EDF3]">{connType.metadata.displayName}</div>
                      <div className="text-xs text-[#6B7785] leading-relaxed">{connType.metadata.description}</div>
                    </div>
                  </div>
                  <div className="shrink-0">
                  {readOnly ? (
                    isEnabled && !isIncompleteSetup && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#22C55E]/20 text-[#22C55E]">Active</span>
                    )
                  ) : isIncompleteSetup ? (
                    <button
                      onClick={handleResumeSetup}
                      disabled={actionLoading === connType.metadata.id}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30 hover:bg-[#F59E0B]/30 transition-colors disabled:opacity-50"
                    >
                      Setup
                    </button>
                  ) : isEnabled ? (
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
                </div>

                <div className="flex flex-wrap gap-2">
                  {connType.metadata.supportedDeviceTypes.map((dt) => (
                    <span key={dt} className="text-[10px] px-2 py-1 rounded-md bg-elevated text-[#6B7785] capitalize">{dt}</span>
                  ))}
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
