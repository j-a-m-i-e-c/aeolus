// frontend/src/components/MqttInspector.tsx — Live MQTT message feed

import { useState, useEffect, useCallback } from "react";
import { useDeviceStore } from "../store/device-store";
import { useAuthStore } from "../store/auth-store";
import { Radio, Trash2, ChevronDown, ChevronUp, Send, Lock, LockOpen, ShieldOff, Plus } from "lucide-react";
import {
  publishMqtt,
  fetchPrivateTopics,
  addPrivateTopic,
  removePrivateTopic,
  type PrivateTopic,
} from "../lib/api-client";
import { matchesAnyFilter, isValidTopicFilter } from "../lib/topic-filter";

export function MqttInspector() {
  const messages = useDeviceStore((s) => s.mqttMessages);
  const clearMessages = useDeviceStore((s) => s.clearMqttMessages);
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState("");
  const [pubTopic, setPubTopic] = useState("");
  const [pubPayload, setPubPayload] = useState("");
  const [publishing, setPublishing] = useState(false);

  // Private topic filters (admin only).
  const [privateTopics, setPrivateTopics] = useState<PrivateTopic[]>([]);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  const loadPrivateTopics = useCallback(async () => {
    try {
      setPrivateTopics(await fetchPrivateTopics());
    } catch (err) {
      console.error("Failed to load private topics:", err);
    }
  }, []);

  useEffect(() => {
    // Every authenticated user can view and add filters, so load for all.
    void loadPrivateTopics();
  }, [loadPrivateTopics]);

  const patterns = privateTopics.map((t) => t.pattern);
  const trimmedPattern = newPattern.trim();
  const patternInvalid = trimmedPattern !== "" && !isValidTopicFilter(trimmedPattern);
  const canSubmitPattern = trimmedPattern !== "" && !patternInvalid && !privacyBusy;

  const filtered = filter
    ? messages.filter((m) => m.topic.toLowerCase().includes(filter.toLowerCase()))
    : messages;

  const handlePublish = async () => {
    if (!pubTopic.trim()) return;
    setPublishing(true);
    try {
      await publishMqtt(pubTopic.trim(), pubPayload);
      setPubPayload("");
    } catch (err) {
      console.error("Publish failed:", err);
    } finally {
      setPublishing(false);
    }
  };

  const handleAddPattern = async (pattern: string) => {
    const trimmed = pattern.trim();
    if (!trimmed || privacyBusy) return;
    setPrivacyBusy(true);
    setPrivacyError(null);
    try {
      const added = await addPrivateTopic(trimmed);
      setPrivateTopics((prev) =>
        prev.some((t) => t.id === added.id) ? prev : [added, ...prev],
      );
      setNewPattern("");
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : "Failed to add filter");
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleRemovePattern = async (id: string) => {
    if (privacyBusy) return;
    setPrivacyBusy(true);
    setPrivacyError(null);
    try {
      await removePrivateTopic(id);
      setPrivateTopics((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : "Failed to remove filter");
    } finally {
      setPrivacyBusy(false);
    }
  };

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A3441]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider hover:text-[#E6EDF3] transition-colors"
        >
          <Radio size={14} className="text-primary" />
          MQTT Inspector
          {messages.length > 0 && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-mono">
              {messages.length}
            </span>
          )}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="flex items-center gap-2">
          {expanded && (
            <input
              type="text"
              placeholder="Filter topics..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs bg-background border border-[#2A3441] rounded px-2 py-1 text-[#E6EDF3] placeholder-[#6B7785] w-40 focus:outline-none focus:border-primary"
            />
          )}
          {expanded && (
            <button
              onClick={() => setShowPrivacy((v) => !v)}
              className={`transition-colors ${
                showPrivacy || patterns.length > 0 ? "text-primary" : "text-[#6B7785] hover:text-[#E6EDF3]"
              }`}
              title="Manage private topics"
            >
              <Lock size={14} />
              {patterns.length > 0 && (
                <span className="ml-1 text-[10px] font-mono align-top">{patterns.length}</span>
              )}
            </button>
          )}
          <button
            onClick={clearMessages}
            className="text-[#6B7785] hover:text-[#EF4444] transition-colors"
            title="Clear messages"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Private topics management (any user can add/view; only admins remove) */}
      {expanded && showPrivacy && (
        <div className="px-4 py-3 border-b border-[#2A3441] bg-background/40">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={12} className="text-primary" />
            <span className="text-[11px] font-semibold text-[#9AA6B2] uppercase tracking-wider">
              Private topics
            </span>
            <span className="text-[10px] text-[#6B7785]">
              hidden from non-admins on the live feed
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Topic filter (e.g. home/locks/#)"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmitPattern) void handleAddPattern(newPattern);
              }}
              className={`flex-1 text-xs bg-background border rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none ${
                patternInvalid ? "border-[#EF4444] focus:border-[#EF4444]" : "border-[#2A3441] focus:border-primary"
              }`}
            />
            <button
              onClick={() => void handleAddPattern(newPattern)}
              disabled={!canSubmitPattern}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={12} />
              Add
            </button>
          </div>

          {patternInvalid && (
            <div className="text-[11px] text-[#EF4444] mt-1.5">
              Invalid filter: use <span className="font-mono">+</span> for one level and{" "}
              <span className="font-mono">#</span> only as the last level.
            </div>
          )}
          {privacyError && (
            <div className="text-[11px] text-[#EF4444] mt-1.5">{privacyError}</div>
          )}

          {patterns.length === 0 ? (
            <div className="text-[11px] text-[#6B7785] mt-2">
              No private topics. The raw feed is visible to all signed-in users.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {privateTopics.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 text-[11px] font-mono bg-elevated border border-[#2A3441] rounded px-2 py-0.5 text-[#E6EDF3]"
                >
                  {t.pattern}
                  {isAdmin && (
                    <button
                      onClick={() => void handleRemovePattern(t.id)}
                      disabled={privacyBusy}
                      className="text-[#6B7785] hover:text-[#EF4444] transition-colors"
                      title="Remove filter (re-expose topic)"
                    >
                      <LockOpen size={11} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {!isAdmin && patterns.length > 0 && (
            <div className="text-[10px] text-[#6B7785] mt-1.5">
              Only an admin can remove a filter.
            </div>
          )}
        </div>
      )}

      {/* Publish form */}
      {expanded && (
        <div className="px-4 py-2 border-b border-[#2A3441] flex items-center gap-2">
          <input
            type="text"
            placeholder="Topic (e.g. sensor/kitchen/temp)"
            value={pubTopic}
            onChange={(e) => setPubTopic(e.target.value)}
            className="flex-1 text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
          />
          <input
            type="text"
            placeholder="Payload (e.g. 22.5)"
            value={pubPayload}
            onChange={(e) => setPubPayload(e.target.value)}
            className="w-40 text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && pubTopic.trim()) {
                handlePublish();
              }
            }}
          />
          <button
            onClick={handlePublish}
            disabled={!pubTopic.trim() || publishing}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={12} />
            Publish
          </button>
        </div>
      )}

      {/* Message feed */}
      {expanded && (
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[#6B7785] text-xs">
              {messages.length === 0
                ? "Waiting for MQTT messages..."
                : "No messages match filter"}
            </div>
          ) : (
            <div className="divide-y divide-[#2A3441]">
              {filtered.map((msg, i) => {
                const isPrivate = matchesAnyFilter(patterns, msg.topic);
                return (
                  <div
                    key={`${msg.timestamp}-${i}`}
                    className="px-4 py-2 flex items-start gap-4 text-xs hover:bg-elevated/50 group"
                  >
                    <span className="text-[#6B7785] font-mono shrink-0 w-16">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-primary font-mono shrink-0 min-w-0 truncate max-w-[200px]" title={msg.topic}>
                      {msg.topic}
                    </span>
                    <span className="text-accent font-mono truncate flex-1" title={msg.payload}>
                      {msg.payload}
                    </span>
                    {isPrivate ? (
                      <span
                        className="shrink-0 text-primary flex items-center gap-1"
                        title={isAdmin ? "Hidden from non-admins" : "Private topic"}
                      >
                        <Lock size={11} />
                      </span>
                    ) : (
                      <button
                        onClick={() => void handleAddPattern(msg.topic)}
                        disabled={privacyBusy}
                        className="shrink-0 text-[#6B7785] opacity-0 group-hover:opacity-100 hover:text-primary transition-all"
                        title="Make this topic private (hide from non-admins)"
                      >
                        <ShieldOff size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
