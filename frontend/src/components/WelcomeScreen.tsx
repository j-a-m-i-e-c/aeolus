// frontend/src/components/WelcomeScreen.tsx — Onboarding screen for empty dashboard

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Zap, Plug, Code } from "lucide-react";
import { AeolusLogo } from "./AeolusLogo";
import { startSimulator } from "../lib/api-client";

export function WelcomeScreen() {
  const navigate = useNavigate();
  const [simLoading, setSimLoading] = useState(false);
  const [simStarted, setSimStarted] = useState(false);

  const handleStartSimulator = async () => {
    setSimLoading(true);
    try {
      await startSimulator();
      setSimStarted(true);
    } catch {
      // toast or silent fail
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col items-center justify-center min-h-[70vh] gap-8 px-4"
    >
      <AeolusLogo size={80} />

      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-[#E6EDF3]">Welcome to Aeolus</h1>
        <p className="text-[#9AA6B2] text-base max-w-md">
          Your local-first IoT automation platform
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl mt-4">
        {/* Enable Simulator */}
        <button
          onClick={handleStartSimulator}
          disabled={simLoading || simStarted}
          className="group flex flex-col items-center gap-3 p-6 rounded-xl bg-[#121821] border border-[#2A3441] hover:border-[#3BA4FF]/50 transition-all duration-200 text-center disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <div className="w-10 h-10 rounded-lg bg-[#3BA4FF]/10 flex items-center justify-center group-hover:bg-[#3BA4FF]/20 transition-colors">
            <Zap size={20} className="text-[#3BA4FF]" />
          </div>
          <span className="text-sm font-semibold text-[#E6EDF3]">
            {simStarted ? "Simulator Running" : "Enable Simulator"}
          </span>
          <span className="text-xs text-[#6B7785] leading-relaxed">
            See Aeolus in action with simulated devices
          </span>
        </button>

        {/* Connect Devices */}
        <button
          onClick={() => navigate("/connectors")}
          className="group flex flex-col items-center gap-3 p-6 rounded-xl bg-[#121821] border border-[#2A3441] hover:border-[#5CE1E6]/50 transition-all duration-200 text-center"
        >
          <div className="w-10 h-10 rounded-lg bg-[#5CE1E6]/10 flex items-center justify-center group-hover:bg-[#5CE1E6]/20 transition-colors">
            <Plug size={20} className="text-[#5CE1E6]" />
          </div>
          <span className="text-sm font-semibold text-[#E6EDF3]">Connect Devices</span>
          <span className="text-xs text-[#6B7785] leading-relaxed">
            Set up Philips Hue, TP-Link Kasa, or MQTT devices
          </span>
        </button>

        {/* Write Automations */}
        <div className="group flex flex-col items-center gap-3 p-6 rounded-xl bg-[#121821] border border-[#2A3441] text-center">
          <div className="w-10 h-10 rounded-lg bg-[#22C55E]/10 flex items-center justify-center">
            <Code size={20} className="text-[#22C55E]" />
          </div>
          <span className="text-sm font-semibold text-[#E6EDF3]">Write Automations</span>
          <span className="text-xs text-[#6B7785] leading-relaxed">
            Create a custom tab and add an Automation pane to start coding
          </span>
        </div>
      </div>
    </motion.div>
  );
}
