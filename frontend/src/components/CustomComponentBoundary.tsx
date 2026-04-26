// frontend/src/components/CustomComponentBoundary.tsx — Error boundary for custom automation UI components

import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface BoundaryProps {
  children: ReactNode;
  onFallback: () => void;
}

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class CustomComponentBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Aeolus] Custom component error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            padding: "24px",
            height: "100%",
            background: "#121821",
            borderRadius: "12px",
            border: "1px solid #2A3441",
          }}
        >
          <div
            style={{
              color: "#EF4444",
              fontSize: "13px",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Custom component error
          </div>
          <div
            style={{
              color: "#E6EDF3",
              fontSize: "11px",
              fontFamily: "'JetBrains Mono', monospace",
              textAlign: "center",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              wordBreak: "break-word",
            }}
          >
            {this.state.error?.message || "Unknown error"}
          </div>
          <button
            onClick={this.props.onFallback}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 500,
              borderRadius: "8px",
              background: "rgba(59, 164, 255, 0.2)",
              color: "#3BA4FF",
              border: "1px solid rgba(59, 164, 255, 0.3)",
              cursor: "pointer",
            }}
          >
            Show Default View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
