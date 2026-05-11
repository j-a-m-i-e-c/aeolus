// frontend/src/components/panes/CustomPanelPane.tsx — Self-contained custom panel pane (editing / display)

import { useState, useEffect, useCallback } from "react";
import {
  Pencil,
  Save,
  X,
  Loader2,
  AlertTriangle,
  RotateCcw,
  LayoutDashboard,
  Play,
} from "lucide-react";
import { UiEditor } from "../UiEditor";
import { ScriptEditor } from "../ScriptEditor";
import { CustomComponentBoundary } from "../CustomComponentBoundary";
import { useDynamicComponent } from "../../hooks/useDynamicComponent";
import { useDeviceStore } from "../../store/device-store";
import { usePanelStateStore, sendPanelStateUpdate } from "../../store/panel-state-store";
import type { PaneConfig } from "../../types/dashboard";

const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

type PaneMode = "editing" | "display";

interface PanelData {
  id: string;
  name: string;
  uiSource: string | null;
  compiledUi: string | null;
  scriptSource: string | null;
  compiledJs: string | null;
  createdAt: number;
  updatedAt: number;
}

interface TranspileError {
  line: number;
  column: number;
  message: string;
}

interface Props {
  config: PaneConfig;
  paneId?: string;
}

const DEFAULT_SCRIPT_TEMPLATE = `// Data source script — runs on demand (click "Run") or on a schedule.
// Use the same globals as automations: devices, mqtt, http, state, log, services.
// Results are pushed to the UI via state.set() → props.state.get().

async function fetchData() {
  // Example: fetch external API data and push to state
  // const res = await http.get("https://api.example.com/data");
  // state.set("apiData", JSON.parse(res.body));
  
  state.set("lastRun", Date.now());
  log.info("Panel data refreshed");
}

fetchData();
`;

export function CustomPanelPane({ config, paneId }: Props) {
  const panelId = (config.panelId as string) || "";

  // Mode state
  const [mode, setMode] = useState<PaneMode>("display");

  // Panel data
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Editing state
  const [name, setName] = useState("");
  const [uiSource, setUiSource] = useState("");
  const [scriptSource, setScriptSource] = useState("");
  const [editingTab, setEditingTab] = useState<"data" | "ui">("ui");
  const [errors, setErrors] = useState<TranspileError[]>([]);
  const [saving, setSaving] = useState(false);

  // Run state
  const [running, setRunning] = useState(false);

  // Device store for custom component props
  const devices = useDeviceStore((s) => s.devices);
  const panelState = usePanelStateStore((s) => s.stateByPanel[panelId]) ?? {};

  // Dynamic component loading
  const hasCompiledUi = !!panel?.compiledUi;
  const { Component, loading: componentLoading, error: componentError } = useDynamicComponent(
    panelId,
    hasCompiledUi,
    `${API_URL}/api/panels/${panelId}/ui-module`,
  );

  // ── Fetch panel data on mount ──
  const fetchPanel = useCallback(async () => {
    if (!panelId) return;
    setLoading(true);
    setFetchError(null);
    setNotFound(false);
    try {
      const res = await fetch(`${API_URL}/api/panels/${panelId}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error("Failed to load panel");
      const data: PanelData = await res.json();
      setPanel(data);
      // If no compiled UI, start in editing mode
      if (!data.compiledUi) {
        setName(data.name);
        setUiSource(data.uiSource || "");
        setScriptSource(data.scriptSource || "");
        setMode("editing");
      }
    } catch {
      setFetchError("Failed to load panel");
    } finally {
      setLoading(false);
    }
  }, [panelId]);

  // Fetch initial state snapshot
  const fetchInitialState = useCallback(async () => {
    if (!panelId) return;
    try {
      const res = await fetch(`${API_URL}/api/panels/${panelId}/state`);
      if (!res.ok) return;
      const state: Record<string, unknown> = await res.json();
      usePanelStateStore.getState().initPanelState(panelId, state);
    } catch {
      // Non-critical
    }
  }, [panelId]);

  useEffect(() => {
    if (panelId) {
      fetchPanel();
      fetchInitialState();
    }
  }, [panelId, fetchPanel, fetchInitialState]);

  // ── Device action helper ──
  const deviceAction = useCallback(
    async (deviceId: string, actionType: string, params?: Record<string, unknown>) => {
      await fetch(`${API_URL}/api/devices/${deviceId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: actionType, params }),
      });
    },
    [],
  );

  // ── MQTT publish helper ──
  const mqttPublish = useCallback((topic: string, payload: string) => {
    fetch(`${API_URL}/api/mqtt/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, payload }),
    }).catch(() => {});
  }, []);

  // Convert plain object state to Map for custom component props
  const stateMap = new Map(Object.entries(panelState));

  // stateSet helper bound to current panelId
  const stateSet = useCallback(
    (key: string, value: unknown) => sendPanelStateUpdate(panelId, key, value),
    [panelId],
  );

  // ── Enter editing mode ──
  const handleEdit = useCallback(() => {
    if (!panel) return;
    setName(panel.name);
    setUiSource(panel.uiSource || "");
    setScriptSource(panel.scriptSource || "");
    setErrors([]);
    setMode("editing");
  }, [panel]);

  // ── Save handler ──
  const handleSave = useCallback(async () => {
    if (!panelId || saving) return;
    setSaving(true);
    setErrors([]);
    try {
      const body: Record<string, unknown> = {
        name: name.trim() || "Untitled Pane",
        uiSource,
      };
      // Only send scriptSource if user has entered something in the Data tab
      if (scriptSource.trim()) {
        body.scriptSource = scriptSource;
      }
      const res = await fetch(`${API_URL}/api/panels/${panelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.details) {
          setErrors(data.details);
        }
        return;
      }
      // Check for transpilation errors returned in the response
      if (data.errors && data.errors.length > 0) {
        setErrors(data.errors);
        // Update panel data but stay in editing mode (source preserved, compiled not updated)
        setPanel(data);
        return;
      }
      // Success — update panel data and switch to display mode
      setPanel(data);
      setMode("display");
    } catch {
      // Network error
    } finally {
      setSaving(false);
    }
  }, [panelId, name, uiSource, scriptSource, saving]);

  // ── Cancel editing ──
  const handleCancel = useCallback(() => {
    if (panel) {
      setName(panel.name);
      setUiSource(panel.uiSource || "");
      setScriptSource(panel.scriptSource || "");
    }
    setErrors([]);
    setMode("display");
  }, [panel]);

  // ── Ctrl+S handler for editor ──
  const handleEditorSave = useCallback(
    (_value: string) => {
      handleSave();
    },
    [handleSave],
  );

  // ── Run panel script ──
  const handleRun = useCallback(async () => {
    if (!panelId || running) return;
    setRunning(true);
    try {
      await fetch(`${API_URL}/api/panels/${panelId}/run`, { method: "POST" });
    } catch {
      // Fire-and-forget — state updates flow back via WebSocket
    } finally {
      setRunning(false);
    }
  }, [panelId, running]);

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — Loading state
  // ═══════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-[#6B7785]" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
        <AlertTriangle size={24} className="text-[#F59E0B]" />
        <div className="text-sm text-[#E6EDF3]">Panel not found</div>
        <div className="text-xs text-[#6B7785]">
          The linked panel may have been deleted.
        </div>
        <button
          onClick={fetchPanel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
        >
          <RotateCcw size={12} />
          Retry
        </button>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
        <AlertTriangle size={24} className="text-[#EF4444]" />
        <div className="text-sm text-[#E6EDF3]">{fetchError}</div>
        <button
          onClick={fetchPanel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
        >
          <RotateCcw size={12} />
          Retry
        </button>
      </div>
    );
  }

  if (!panel) return null;

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — Display Mode
  // ═══════════════════════════════════════════════════════════════════

  if (mode === "display") {
    // Placeholder when no compiled UI exists
    if (!hasCompiledUi) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
          <LayoutDashboard size={32} className="text-[#2A3441]" />
          <div className="text-sm text-[#9AA6B2]">No component yet</div>
          <div className="text-xs text-[#6B7785]">
            Write a TSX component to render in this panel.
          </div>
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
          >
            <Pencil size={12} />
            Edit Component
          </button>
        </div>
      );
    }

    // Component loading state
    if (componentLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <Loader2 size={18} className="animate-spin text-[#6B7785]" />
        </div>
      );
    }

    // Component load error
    if (componentError) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
          <AlertTriangle size={24} className="text-[#EF4444]" />
          <div className="text-sm text-[#E6EDF3]">Failed to load component</div>
          <div className="text-xs text-[#6B7785] font-mono">{componentError}</div>
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
          >
            <Pencil size={12} />
            Edit Component
          </button>
        </div>
      );
    }

    // Render the dynamic component
    if (Component) {
      const devicesArray = Object.values(devices);
      return (
        <div className="h-full flex flex-col overflow-auto">
          {/* Header with panel name, run button, and edit button */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="text-sm font-semibold text-[#E6EDF3] truncate">
              {panel.name}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {panel.compiledJs && (
                <button
                  onClick={handleRun}
                  disabled={running}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-[#10B981] hover:text-[#34D399] hover:bg-[#10B981]/10 border border-[#10B981]/30 transition-colors disabled:opacity-50"
                >
                  {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  Run
                </button>
              )}
              <button
                onClick={handleEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors shrink-0"
              >
                <Pencil size={12} />
                Edit
              </button>
            </div>
          </div>

          {/* Rendered component */}
          <div className="flex-1 min-h-0 overflow-auto">
            <CustomComponentBoundary onFallback={() => setMode("editing")}>
              <Component
                devices={devicesArray}
                panelId={panelId}
                panelName={panel.name}
                deviceAction={deviceAction}
                mqttPublish={mqttPublish}
                state={stateMap}
                stateSet={stateSet}
              />
            </CustomComponentBoundary>
          </div>
        </div>
      );
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — Editing Mode
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Name input */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Panel name"
        className="w-full px-3 py-2 text-sm rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
      />

      {/* Tab bar */}
      <div className="flex gap-1 shrink-0">
        <button
          onClick={() => setEditingTab("data")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            editingTab === "data"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-transparent"
          }`}
        >
          Data
        </button>
        <button
          onClick={() => setEditingTab("ui")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            editingTab === "ui"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-transparent"
          }`}
        >
          UI
        </button>
      </div>

      {/* Editor — fills remaining space */}
      <div className="flex-1 min-h-0">
        {editingTab === "ui" ? (
          <UiEditor
            initialValue={uiSource}
            onChange={(val) => setUiSource(val)}
            onSave={handleEditorSave}
          />
        ) : (
          <ScriptEditor
            initialValue={scriptSource || DEFAULT_SCRIPT_TEMPLATE}
            onChange={(val) => setScriptSource(val)}
            onSave={handleEditorSave}
            errors={editingTab === "data" ? errors : undefined}
          />
        )}
      </div>

      {/* Transpilation errors */}
      {errors.length > 0 && (
        <div className="shrink-0 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 px-3 py-2 max-h-28 overflow-auto">
          <div className="text-[10px] text-[#EF4444] uppercase tracking-wider mb-1 font-semibold">
            Transpilation Errors
          </div>
          {errors.map((err, i) => (
            <div key={i} className="text-[11px] font-mono text-[#E6EDF3]">
              <span className="text-[#6B7785]">
                {err.line}:{err.column}
              </span>{" "}
              {err.message}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-gradient-to-r from-primary to-[#2563EB] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Save size={12} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={handleCancel}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors"
        >
          <X size={12} />
          Cancel
        </button>
      </div>
    </div>
  );
}
