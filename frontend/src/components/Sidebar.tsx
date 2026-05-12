// frontend/src/components/Sidebar.tsx — Left sidebar navigation with dynamic tabs

import { AeolusLogo } from "./AeolusLogo";
import { useDeviceStore } from "../store/device-store";
import { useDashboardStore, tabNameToSlug } from "../store/dashboard-store";
import { useNavigate, useLocation } from "react-router-dom";
import * as icons from "lucide-react";
import { Plus, Trash2, Wifi, WifiOff, GripVertical } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { fetchHealth } from "../lib/api-client";
import type { HealthStatus } from "../store/device-store";

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
// Icon choices for the "Add Tab" form
// ---------------------------------------------------------------------------

const ICON_CHOICES = [
  "cpu", "lightbulb", "zap", "server", "thermometer", "home",
  "radio", "eye", "shield", "droplets", "flame", "wind",
  "sun", "moon", "cloud", "leaf",
];

// ---------------------------------------------------------------------------
// Sidebar component
// ---------------------------------------------------------------------------

export function Sidebar() {
  const wsConnected = useDeviceStore((s) => s.wsConnected);
  const health = useDeviceStore((s) => s.health);
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = useDashboardStore((s) => s.tabs);
  const addTab = useDashboardStore((s) => s.addTab);
  const renameTab = useDashboardStore((s) => s.renameTab);
  const reorderTabs = useDashboardStore((s) => s.reorderTabs);
  const deleteTab = useDashboardStore((s) => s.deleteTab);

  // Add-tab form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [newTabIcon, setNewTabIcon] = useState("cpu");
  const addNameRef = useRef<HTMLInputElement>(null);

  // Inline rename state
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  // Derived tab lists
  const pinnedTabs = tabs.filter((t) => t.pinned).sort((a, b) => a.order - b.order);
  const customTabs = tabs.filter((t) => !t.pinned).sort((a, b) => a.order - b.order);

  // Route helpers
  const PINNED_ROUTES: Record<string, string> = {
    "default-dashboard": "/dashboard",
    "default-connectors": "/connectors",
  };

  const getTabRoute = (tab: { id: string; name: string; pinned: boolean }): string => {
    if (tab.pinned) return PINNED_ROUTES[tab.id] || "/dashboard";
    return `/tab/${tabNameToSlug(tab.name)}`;
  };

  const isTabActive = (tab: { id: string; name: string; pinned: boolean }): boolean => {
    const route = getTabRoute(tab);
    return location.pathname === route;
  };

  // Poll health status globally so MQTT indicator works on all tabs
  const setHealth = useDeviceStore((s) => s.setHealth);
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await fetchHealth() as unknown as HealthStatus;
        setHealth(data);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [setHealth]);

  // Focus add-tab input when form opens
  useEffect(() => {
    if (showAddForm) addNameRef.current?.focus();
  }, [showAddForm]);

  // Focus rename input when renaming starts
  useEffect(() => {
    if (renamingTabId) renameRef.current?.focus();
  }, [renamingTabId]);

  // ---- Add tab handlers ----

  const newTabSlug = tabNameToSlug(newTabName);
  const RESERVED_SLUGS = new Set(["dashboard", "connectors"]);
  const existingSlugs = new Set(tabs.map((t) => tabNameToSlug(t.name)));
  const isNameTaken = !!newTabSlug && (existingSlugs.has(newTabSlug) || RESERVED_SLUGS.has(newTabSlug));

  const handleAddSubmit = () => {
    if (!newTabName.trim() || isNameTaken) return;
    const slug = tabNameToSlug(newTabName);
    addTab(newTabName, newTabIcon);
    setNewTabName("");
    setNewTabIcon("cpu");
    setShowAddForm(false);
    navigate(`/tab/${slug}`);
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddSubmit();
    if (e.key === "Escape") {
      setShowAddForm(false);
      setNewTabName("");
      setNewTabIcon("cpu");
    }
  };

  // ---- Rename handlers ----

  const startRename = (tabId: string, currentName: string) => {
    setRenamingTabId(tabId);
    setRenameValue(currentName);
  };

  const confirmRename = () => {
    if (renamingTabId && renameValue.trim()) {
      const tab = tabs.find((t) => t.id === renamingTabId);
      const wasActive = tab && isTabActive({ ...tab, pinned: false });
      renameTab(renamingTabId, renameValue);
      // Navigate to the new slug if this tab was active
      if (wasActive) {
        const newSlug = tabNameToSlug(renameValue);
        navigate(`/tab/${newSlug}`, { replace: true });
      }
    }
    setRenamingTabId(null);
    setRenameValue("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") confirmRename();
    if (e.key === "Escape") {
      setRenamingTabId(null);
      setRenameValue("");
    }
  };

  // ---- Drag handlers (custom tabs only) ----

  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDragTabId(tabId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tabId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTabId(tabId);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetTabId: string) => {
      e.preventDefault();
      setDragOverTabId(null);
      if (!dragTabId || dragTabId === targetTabId) {
        setDragTabId(null);
        return;
      }
      // Build new order: move dragTabId before targetTabId
      const ids = customTabs.map((t) => t.id);
      const fromIdx = ids.indexOf(dragTabId);
      const toIdx = ids.indexOf(targetTabId);
      if (fromIdx === -1 || toIdx === -1) {
        setDragTabId(null);
        return;
      }
      const reordered = [...ids];
      reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, dragTabId);
      reorderTabs(reordered);
      setDragTabId(null);
    },
    [dragTabId, customTabs, reorderTabs],
  );

  const handleDragEnd = useCallback(() => {
    setDragTabId(null);
    setDragOverTabId(null);
  }, []);

  // ---- Delete handler ----

  const handleDelete = (tabId: string, tabName: string) => {
    if (window.confirm(`Delete tab "${tabName}"? This will remove all its panes.`)) {
      const tab = tabs.find((t) => t.id === tabId);
      const wasActive = tab && isTabActive({ ...tab, pinned: false });
      deleteTab(tabId);
      if (wasActive) navigate("/dashboard");
    }
  };

  // ---- Tab button helper ----

  const tabButton = (tab: { id: string; name: string; icon: string; pinned: boolean }, isPinned: boolean) => {
    const isActive = isTabActive(tab);
    const isRenaming = renamingTabId === tab.id;
    const isDragOver = dragOverTabId === tab.id;

    return (
      <div
        key={tab.id}
        className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
          isActive ? "bg-elevated text-[#E6EDF3]" : "text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50"
        } ${isDragOver ? "border border-primary/50" : ""} ${dragTabId === tab.id ? "opacity-50" : ""}`}
        onClick={() => navigate(getTabRoute(tab))}
        onDoubleClick={!isPinned ? () => startRename(tab.id, tab.name) : undefined}
        draggable={!isPinned}
        onDragStart={!isPinned ? (e) => handleDragStart(e, tab.id) : undefined}
        onDragOver={!isPinned ? (e) => handleDragOver(e, tab.id) : undefined}
        onDrop={!isPinned ? (e) => handleDrop(e, tab.id) : undefined}
        onDragEnd={!isPinned ? handleDragEnd : undefined}
      >
        {/* Drag handle for custom tabs */}
        {!isPinned && (
          <GripVertical size={12} className="text-[#6B7785] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab" />
        )}

        <DynamicIcon name={tab.icon} size={16} className="shrink-0" />

        {isRenaming ? (
          <input
            ref={renameRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={confirmRename}
            className="flex-1 bg-transparent border-b border-primary text-[#E6EDF3] text-sm outline-none min-w-0"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate">{tab.name}</span>
        )}

        {/* Delete button for custom tabs */}
        {!isPinned && !isRenaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(tab.id, tab.name);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[#6B7785] hover:text-[#EF4444] shrink-0"
            title="Delete tab"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className="w-64 h-screen bg-surface border-r border-[#2A3441] flex flex-col p-4 gap-6 sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2 shrink-0">
        <AeolusLogo size={40} />
        <span className="text-xl font-semibold text-primary">Aeolus</span>
      </div>

      {/* Pinned system tabs */}
      <nav className="flex flex-col gap-1 shrink-0">
        {pinnedTabs.map((tab) => tabButton(tab, true))}
      </nav>

      {/* Separator */}
      <div className="border-t border-[#2A3441] shrink-0" />

      {/* Custom tabs — scrollable */}
      <nav className="flex flex-col gap-1 flex-1 overflow-y-auto min-h-0">
        {customTabs.map((tab) => tabButton(tab, false))}

        {/* Add Tab button / inline form */}
        {showAddForm ? (
          <div className="flex flex-col gap-2 px-2 py-2 rounded-lg bg-elevated">
            <input
              ref={addNameRef}
              type="text"
              placeholder="Tab name…"
              value={newTabName}
              onChange={(e) => setNewTabName(e.target.value)}
              onKeyDown={handleAddKeyDown}
              className={`w-full bg-transparent border-b text-[#E6EDF3] text-sm outline-none py-1 ${isNameTaken ? "border-[#EF4444]" : "border-[#2A3441] focus:border-primary"}`}
            />
            {isNameTaken && (
              <p className="text-[10px] text-[#EF4444]">A tab with this name already exists</p>
            )}
            <div className="grid grid-cols-8 gap-1">
              {ICON_CHOICES.map((iconName) => (
                <button
                  key={iconName}
                  onClick={() => setNewTabIcon(iconName)}
                  className={`p-1 rounded transition-colors ${
                    newTabIcon === iconName
                      ? "bg-primary/20 text-primary"
                      : "text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50"
                  }`}
                  title={iconName}
                >
                  <DynamicIcon name={iconName} size={14} />
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddSubmit}
                disabled={isNameTaken || !newTabName.trim()}
                className="flex-1 text-xs px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewTabName("");
                  setNewTabIcon("cpu");
                }}
                className="flex-1 text-xs px-2 py-1 rounded text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50 transition-colors"
          >
            <Plus size={16} />
            Add Tab
          </button>
        )}
      </nav>

      {/* System status — pinned to bottom */}
      <div className="px-2 space-y-2 shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-4 flex items-center justify-center shrink-0">
            {health?.mqtt === "connected" ? (
              <Wifi size={14} className="text-[#22C55E]" />
            ) : (
              <WifiOff size={14} className="text-[#EF4444]" />
            )}
          </div>
          <span className="text-[#9AA6B2]">
            MQTT {health?.mqtt === "connected" ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#6B7785]">
          <div className="w-4 flex items-center justify-center shrink-0">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
          </div>
          WebSocket {wsConnected ? "Live" : "Offline"}
        </div>
      </div>
    </aside>
  );
}
