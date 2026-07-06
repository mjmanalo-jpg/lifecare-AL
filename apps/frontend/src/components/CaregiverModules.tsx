"use client";

import React from "react";
import { AlertTriangle, MessageSquare, Clock, Activity, Plus, X, Check, Phone, Send } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ============= EMERGENCY CALL SYSTEM =============
export const EmergencyCallSystem = ({
  callBells,
  onAcknowledge
}: {
  callBells: any[];
  onAcknowledge: (id: number) => void;
}) => (
  <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
    <div className="flex items-center gap-2 mb-4">
      <AlertTriangle className="w-5 h-5 text-red-500" />
      <h3 className="text-lg font-bold text-foreground">Emergency Call Bells</h3>
    </div>
    <div className="space-y-2">
      {callBells.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No active calls</p>
      ) : (
        callBells.map(call => (
          <div key={call.id} className={`p-3 rounded-lg border flex justify-between items-center ${
            call.status === "active"
              ? "bg-red-500/15 border-red-500/30"
              : "bg-amber-500/10 border-amber-500/20"
          }`}>
            <div>
              <p className="text-xs font-bold text-foreground">{call.resident}</p>
              <p className="text-[9px] text-muted-foreground">Room {call.room} • {call.time}</p>
            </div>
            {call.status === "active" && (
              <button
                onClick={() => onAcknowledge(call.id)}
                className="px-3 py-1 bg-green-500/20 text-green-400 rounded border border-green-500/30 text-[10px] font-bold hover:bg-green-500/30"
              >
                Acknowledge
              </button>
            )}
          </div>
        ))
      )}
    </div>
  </div>
);

// ============= INCIDENT QUICK REPORT =============
export const IncidentQuickReport = ({
  showForm,
  onShowForm,
  newIncident,
  onIncidentChange,
  onSubmit
}: {
  showForm: boolean;
  onShowForm: (show: boolean) => void;
  newIncident: any;
  onIncidentChange: (field: string, value: string) => void;
  onSubmit: () => void;
}) => (
  <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-orange-500" />
        <h3 className="text-lg font-bold text-foreground">Incident Report</h3>
      </div>
      <button
        onClick={() => onShowForm(!showForm)}
        className="px-3 py-1.5 bg-orange-500/20 text-orange-400 rounded-lg border border-orange-500/30 text-[10px] font-bold hover:bg-orange-500/30"
      >
        <Plus className="w-3.5 h-3.5 inline mr-1" /> Report
      </button>
    </div>

    <AnimatePresence>
      {showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 mb-4 pb-4 border-b border-border/50">
          <select
            value={newIncident.type}
            onChange={(e) => onIncidentChange("type", e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:border-amber-500 focus:outline-none"
          >
            <option value="Fall">Fall</option>
            <option value="Medication Error">Medication Error</option>
            <option value="Behavioral">Behavioral Incident</option>
            <option value="Injury">Injury</option>
            <option value="Other">Other</option>
          </select>

          <select
            value={newIncident.severity}
            onChange={(e) => onIncidentChange("severity", e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:border-amber-500 focus:outline-none"
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>

          <input
            type="text"
            placeholder="Resident name"
            value={newIncident.resident}
            onChange={(e) => onIncidentChange("resident", e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:border-amber-500 focus:outline-none"
          />

          <textarea
            placeholder="Incident details..."
            value={newIncident.notes}
            onChange={(e) => onIncidentChange("notes", e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:border-amber-500 focus:outline-none resize-none h-20"
          />

          <button
            onClick={onSubmit}
            className="w-full px-3 py-2 bg-red-500/20 text-red-400 rounded-lg border border-red-500/30 text-[10px] font-bold hover:bg-red-500/30"
          >
            Submit Report
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// ============= QUICK MESSAGING =============
export const QuickMessaging = ({
  messages,
  showMessaging,
  onShowMessaging,
  newMessage,
  onMessageChange,
  onSendMessage
}: {
  messages: any[];
  showMessaging: boolean;
  onShowMessaging: (show: boolean) => void;
  newMessage: string;
  onMessageChange: (msg: string) => void;
  onSendMessage: () => void;
}) => (
  <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-blue-500" />
        <h3 className="text-lg font-bold text-foreground">Messages</h3>
      </div>
      <span className="text-[9px] font-bold bg-blue-500/10 text-blue-400 px-2 py-1 rounded">
        {messages.filter(m => m.status === "pending").length} Pending
      </span>
    </div>

    <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
      {messages.map(msg => (
        <div key={msg.id} className={`p-3 rounded-lg border text-xs ${
          msg.status === "pending"
            ? "bg-blue-500/10 border-blue-500/20"
            : "bg-green-500/10 border-green-500/20"
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-foreground">{msg.from} → {msg.to}</p>
              <p className="text-muted-foreground mt-1">{msg.text}</p>
            </div>
            <span className="text-[8px] text-muted-foreground">{msg.timestamp}</span>
          </div>
        </div>
      ))}
    </div>

    <button
      onClick={() => onShowMessaging(!showMessaging)}
      className="w-full px-3 py-2 bg-blue-500/20 text-blue-400 rounded-lg border border-blue-500/30 text-[10px] font-bold hover:bg-blue-500/30"
    >
      <Send className="w-3.5 h-3.5 inline mr-1" /> Send Message
    </button>
  </div>
);

// ============= VITALS QUICK LOG =============
export const VitalsQuickLog = ({
  vitalsLog,
  showVitalsForm,
  onShowForm,
  newVitals,
  onVitalsChange,
  onSubmit
}: {
  vitalsLog: any[];
  showVitalsForm: boolean;
  onShowForm: (show: boolean) => void;
  newVitals: any;
  onVitalsChange: (field: string, value: string) => void;
  onSubmit: () => void;
}) => (
  <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-green-500" />
        <h3 className="text-lg font-bold text-foreground">Vitals Log</h3>
      </div>
      <button
        onClick={() => onShowForm(!showVitalsForm)}
        className="px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg border border-green-500/30 text-[10px] font-bold hover:bg-green-500/30"
      >
        <Plus className="w-3.5 h-3.5 inline mr-1" /> Log
      </button>
    </div>

    <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
      {vitalsLog.slice(0, 4).map(vital => (
        <div key={vital.id} className="p-2 bg-foreground/5 border border-border rounded-lg text-[9px]">
          <p className="font-semibold text-foreground">{vital.resident}</p>
          <div className="grid grid-cols-3 gap-1 mt-1 text-muted-foreground">
            <span>BP: {vital.bp}</span>
            <span>Temp: {vital.temp}</span>
            <span>O2: {vital.o2}</span>
          </div>
        </div>
      ))}
    </div>

    <AnimatePresence>
      {showVitalsForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-2 mb-4 pb-4 border-b border-border/50">
          <input
            type="text"
            placeholder="Resident name"
            value={newVitals.resident}
            onChange={(e) => onVitalsChange("resident", e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:border-green-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="BP (120/80)"
            value={newVitals.bp}
            onChange={(e) => onVitalsChange("bp", e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:border-green-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Temp (98.6°F)"
            value={newVitals.temp}
            onChange={(e) => onVitalsChange("temp", e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:border-green-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="O2 (98%)"
            value={newVitals.o2}
            onChange={(e) => onVitalsChange("o2", e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:border-green-500 focus:outline-none"
          />
          <button
            onClick={onSubmit}
            className="w-full px-3 py-2 bg-green-500/20 text-green-400 rounded-lg border border-green-500/30 text-[10px] font-bold hover:bg-green-500/30"
          >
            Log Vitals
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// ============= TIME TRACKING =============
export const TimeTracking = ({
  shiftTime,
  onClockToggle,
  onBreakToggle
}: {
  shiftTime: any;
  onClockToggle: () => void;
  onBreakToggle: () => void;
}) => (
  <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
    <div className="flex items-center gap-2 mb-4">
      <Clock className="w-5 h-5 text-purple-500" />
      <h3 className="text-lg font-bold text-foreground">Shift Time</h3>
    </div>

    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-foreground/5 border border-border">
          <p className="text-[9px] text-muted-foreground font-bold uppercase">Clock In</p>
          <p className="text-sm font-bold text-foreground mt-1">{shiftTime.clockIn}</p>
        </div>
        <div className="p-3 rounded-lg bg-foreground/5 border border-border">
          <p className="text-[9px] text-muted-foreground font-bold uppercase">Hours</p>
          <p className="text-sm font-bold text-amber-500 mt-1">{shiftTime.totalHours}h</p>
        </div>
      </div>

      <button
        onClick={onClockToggle}
        className={`w-full px-3 py-2 rounded-lg border text-[10px] font-bold ${
          shiftTime.status === "clocked-in"
            ? "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
            : "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30"
        }`}
      >
        {shiftTime.status === "clocked-in" ? "Clock Out" : "Clock In"}
      </button>

      <button
        onClick={onBreakToggle}
        className="w-full px-3 py-2 rounded-lg border border-orange-500/30 bg-orange-500/20 text-orange-400 text-[10px] font-bold hover:bg-orange-500/30"
      >
        {shiftTime.breakStart ? "End Break" : "Start Break"}
      </button>
    </div>
  </div>
);
