// frontend/src/components/SnippetPicker.tsx — Code snippet picker for the automation editor

import { useState, useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Search,
  Blocks,
  Radio,
  Globe,
  Filter,
  Cpu,
  Clock,
  FileCode,
  Lightbulb,
  Plug,
} from "lucide-react";

const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

interface Snippet {
  id: string;
  name: string;
  description: string;
  code: string;
}

interface SnippetGroup {
  category: string;
  icon: string;
  snippets: Snippet[];
}

interface SnippetPickerProps {
  onInsert: (code: string) => void;
}

const ICON_MAP: Record<string, typeof Radio> = {
  radio: Radio,
  globe: Globe,
  filter: Filter,
  cpu: Cpu,
  clock: Clock,
  "file-code": FileCode,
  lightbulb: Lightbulb,
  plug: Plug,
};

function CategoryIcon({ name }: { name: string }) {
  const Icon = ICON_MAP[name] || Blocks;
  return <Icon size={14} />;
}

export function SnippetPicker({ onInsert }: SnippetPickerProps) {
  const [groups, setGroups] = useState<SnippetGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/automations/snippets`);
        if (!res.ok) return;
        const data: SnippetGroup[] = await res.json();
        if (!cancelled) {
          setGroups(data);
          // Expand first group by default
          if (data.length > 0) setExpanded(new Set([data[0].category]));
        }
      } catch {
        // Snippets unavailable — picker just shows empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        snippets: g.snippets.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.snippets.length > 0);
  }, [groups, search]);

  const toggleGroup = (category: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const handleInsert = (snippet: Snippet) => {
    onInsert(snippet.code);
    setCopiedId(snippet.id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  if (loading) {
    return (
      <div className="text-xs text-[#6B7785] p-3">Loading snippets…</div>
    );
  }

  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2A3441]">
        <Blocks size={14} className="text-primary shrink-0" />
        <span className="text-xs font-semibold text-[#E6EDF3]">Snippets</span>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7785]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search snippets…"
            className="w-full pl-7 pr-2 py-1.5 text-[11px] rounded-md bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-auto px-1">
        {filtered.map((group) => {
          const isExpanded = expanded.has(group.category);
          return (
            <div key={group.category} className="mb-1">
              {/* Category header */}
              <button
                onClick={() => toggleGroup(group.category)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-[#9AA6B2] hover:text-[#E6EDF3] rounded-md hover:bg-[#1A2330] transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <CategoryIcon name={group.icon} />
                <span>{group.category}</span>
                <span className="ml-auto text-[10px] text-[#6B7785]">
                  {group.snippets.length}
                </span>
              </button>

              {/* Snippet items */}
              {isExpanded && (
                <div className="ml-2 space-y-0.5">
                  {group.snippets.map((snippet) => (
                    <button
                      key={snippet.id}
                      onClick={() => handleInsert(snippet)}
                      className="w-full flex items-start gap-2 px-2 py-1.5 text-left rounded-md hover:bg-[#1A2330] transition-colors group"
                      title={snippet.description}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-[#E6EDF3] truncate">
                          {snippet.name}
                        </div>
                        <div className="text-[10px] text-[#6B7785] truncate">
                          {snippet.description}
                        </div>
                      </div>
                      <div className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {copiedId === snippet.id ? (
                          <span className="text-[10px] text-[#22C55E]">
                            Inserted
                          </span>
                        ) : (
                          <Copy size={11} className="text-[#6B7785]" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && search.trim() && (
          <div className="text-center py-4 text-[10px] text-[#6B7785]">
            No snippets match "{search}"
          </div>
        )}
      </div>
    </div>
  );
}
