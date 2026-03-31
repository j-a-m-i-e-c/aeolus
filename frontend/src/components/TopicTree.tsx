// frontend/src/components/TopicTree.tsx — Visual MQTT topic tree

import { useState, useMemo } from "react";
import { useDeviceStore } from "../store/device-store";
import { ChevronRight, ChevronDown, FolderTree, Hash } from "lucide-react";

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  lastPayload?: string;
  lastSeen?: number;
  count: number;
}

function buildTree(messages: { topic: string; payload: string; timestamp: number }[]): TreeNode {
  const root: TreeNode = { name: "root", children: new Map(), count: 0 };

  for (const msg of messages) {
    const parts = msg.topic.split("/");
    let current = root;
    for (const part of parts) {
      if (!current.children.has(part)) {
        current.children.set(part, { name: part, children: new Map(), count: 0 });
      }
      current = current.children.get(part)!;
    }
    current.lastPayload = msg.payload;
    current.lastSeen = msg.timestamp;
    current.count++;
  }

  return root;
}

function TreeNodeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.size > 0;
  const isLeaf = node.children.size === 0 && node.lastPayload !== undefined;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-0.5 px-2 hover:bg-elevated/50 rounded cursor-pointer text-xs`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => setOpen(!open)}
      >
        {hasChildren ? (
          open ? <ChevronDown size={12} className="text-[#6B7785] shrink-0" /> : <ChevronRight size={12} className="text-[#6B7785] shrink-0" />
        ) : (
          <Hash size={12} className="text-primary shrink-0" />
        )}
        <span className={`font-mono ${isLeaf ? "text-primary" : "text-[#E6EDF3]"}`}>
          {node.name}
        </span>
        {node.count > 0 && (
          <span className="text-[10px] text-[#6B7785] ml-1">({node.count})</span>
        )}
        {isLeaf && node.lastPayload && (
          <span className="text-accent font-mono ml-auto truncate max-w-[120px]" title={node.lastPayload}>
            {node.lastPayload}
          </span>
        )}
      </div>
      {open && hasChildren && (
        <div>
          {Array.from(node.children.values()).map((child) => (
            <TreeNodeView key={child.name} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TopicTree() {
  const messages = useDeviceStore((s) => s.mqttMessages);
  const [expanded, setExpanded] = useState(true);

  const tree = useMemo(() => buildTree(messages), [messages]);
  const hasTopics = tree.children.size > 0;

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider hover:text-[#E6EDF3] transition-colors border-b border-[#2A3441]"
      >
        <FolderTree size={14} className="text-primary" />
        Topic Tree
        {expanded ? <ChevronDown size={14} className="ml-auto" /> : <ChevronRight size={14} className="ml-auto" />}
      </button>

      {expanded && (
        <div className="max-h-48 overflow-y-auto py-1">
          {!hasTopics ? (
            <div className="px-4 py-4 text-center text-[#6B7785] text-xs">
              No topics seen yet
            </div>
          ) : (
            Array.from(tree.children.values()).map((node) => (
              <TreeNodeView key={node.name} node={node} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
