import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Bell, MessageSquare, Calendar,
  Image, DollarSign, Target, Heart, Activity, Pill,
  Send, Check, Clock, User, MapPin, Phone
} from "lucide-react";

export default function FamilyPortal() {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/family")
      .then(res => res.json())
      .then(data => {
        setData(data);
        setLoading(false);
      });
  }, []);

  if (loading || !data) return <div className="p-4">Loading family portal...</div>;

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    await fetch("/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendMessage", message: newMessage })
    });
    setNewMessage("");
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-4xl font-bold flex items-center gap-2">
        <Heart className="w-8 h-8 text-red-500" />
        Family Portal - {data.resident.name}
      </h1>

      {/* Emergency Alerts */}
      {data.alerts.some(a => a.status === "PENDING") && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-lg bg-red-500/20 border border-red-500/50 flex items-start gap-3"
        >
          <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-1" />
          <div className="flex-1">
            {data.alerts.filter(a => a.status === "PENDING").map(alert => (
              <div key={alert.id}>
                <h3 className="font-bold text-red-300">{alert.title}</h3>
                <p className="text-sm text-red-200">{alert.message}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: "overview", label: "Daily Report", icon: Activity },
          { id: "alerts", label: "Alerts", icon: Bell },
          { id: "messages", label: "Messages", icon: MessageSquare },
          { id: "photos", label: "Photos", icon: Image },
          { id: "appointments", label: "Appointments", icon: Calendar },
          { id: "expenses", label: "Expenses", icon: DollarSign },
          { id: "goals", label: "Care Goals", icon: Target }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
                activeTab === tab.id
                  ? "bg-blue-500/30 border border-blue-500/50"
                  : "bg-foreground/5 hover:bg-foreground/10"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Daily Report Overview */}
      {activeTab === "overview" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-2xl font-bold">Daily Report</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/30">
              <p className="text-sm text-muted-foreground">Mood</p>
              <p className="text-2xl font-bold text-purple-300">{data.dailyReport.mood}</p>
            </div>
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <p className="text-sm text-muted-foreground">Meals Eaten</p>
              <p className="text-2xl font-bold text-green-300">{data.dailyReport.mealsEaten}%</p>
            </div>
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <p className="text-sm text-muted-foreground">Activity Level</p>
              <p className="text-2xl font-bold text-blue-300">{data.dailyReport.activityLevel}</p>
            </div>
            <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <p className="text-sm text-muted-foreground">Sleep Quality</p>
              <p className="text-2xl font-bold text-yellow-300">{data.dailyReport.sleepQuality}/10</p>
            </div>
            <div className="p-4 rounded-lg bg-pink-500/10 border border-pink-500/30">
              <p className="text-sm text-muted-foreground">Medication</p>
              <p className="text-2xl font-bold text-pink-300">{data.dailyReport.medicationTaken ? "✅ Taken" : "⏰ Pending"}</p>
            </div>
            <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <p className="text-sm text-muted-foreground">Incidents</p>
              <p className="text-2xl font-bold text-orange-300">{data.dailyReport.incidents}</p>
            </div>
          </div>
          <div className="p-4 rounded-lg bg-foreground/5 border border-border">
            <h3 className="font-bold mb-2">Caregiver Notes</h3>
            <p className="text-sm text-muted-foreground">{data.dailyReport.notes}</p>
            <p className="text-xs text-muted-foreground mt-2">- {data.dailyReport.caregiver}</p>
          </div>
        </motion.div>
      )}

      {/* Emergency Alerts */}
      {activeTab === "alerts" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-2xl font-bold">Alert History</h2>
          {data.alerts.map(alert => (
            <div key={alert.id} className={`p-4 rounded-lg border ${
              alert.status === "RESOLVED" ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
            }`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-bold">{alert.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                  {alert.response && (
                    <p className="text-xs text-green-300 mt-2">✅ {alert.response}</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  alert.status === "RESOLVED" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
                }`}>
                  {alert.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{new Date(alert.timestamp).toLocaleString()}</p>
            </div>
          ))}
        </motion.div>
      )}

      {/* Messaging */}
      {activeTab === "messages" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-2xl font-bold">Messages with Care Team</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.messages.map(msg => (
              <div key={msg.id} className="p-4 rounded-lg bg-foreground/5 border border-border">
                <p className="font-semibold text-sm flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {msg.from}
                </p>
                <p className="text-sm mt-2">{msg.text}</p>
                <p className="text-xs text-muted-foreground mt-2">{new Date(msg.timestamp).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Send message to care team..."
              className="flex-1 px-4 py-2 rounded-lg bg-foreground/5 border border-border focus:border-blue-500 outline-none"
            />
            <button
              onClick={sendMessage}
              className="px-4 py-2 bg-blue-500/20 text-blue-300 rounded-lg hover:bg-blue-500/30 flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Send
            </button>
          </div>
        </motion.div>
      )}

      {/* Photo Gallery */}
      {activeTab === "photos" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-2xl font-bold">Photo Gallery</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {data.photos.map(photo => (
              <div key={photo.id} className="p-4 rounded-lg bg-foreground/5 border border-border">
                <Image className="w-16 h-16 mx-auto opacity-50 mb-2" />
                <h3 className="font-semibold text-sm">{photo.title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{photo.caption}</p>
                <p className="text-xs text-muted-foreground mt-2">{new Date(photo.timestamp).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Appointments */}
      {activeTab === "appointments" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-2xl font-bold">Upcoming Appointments</h2>
          {data.appointments.map(apt => (
            <div key={apt.id} className="p-4 rounded-lg bg-foreground/5 border border-border">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-bold flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {apt.type === "Doctor" ? apt.doctor : apt.visitor}
                  </h3>
                  {apt.type === "Doctor" && (
                    <p className="text-sm text-muted-foreground mt-1">Reason: {apt.reason}</p>
                  )}
                  <p className="text-sm mt-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    {new Date(apt.date).toLocaleDateString()} at {apt.time}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (!apt.confirmed) {
                      fetch("/api/family", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "confirmAppointment", appointmentId: apt.id })
                      });
                    }
                  }}
                  className={`px-3 py-2 rounded text-sm flex items-center gap-1 ${
                    apt.confirmed
                      ? "bg-green-500/20 text-green-300"
                      : "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                  }`}
                >
                  {apt.confirmed ? <Check className="w-4 h-4" /> : "Confirm"}
                </button>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* Expenses */}
      {activeTab === "expenses" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-2xl font-bold">Billing - {data.expenses.month}</h2>
          <div className="p-6 rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/30">
            <p className="text-sm text-muted-foreground mb-2">Total This Month</p>
            <p className="text-4xl font-bold text-purple-300">${data.expenses.total}</p>
          </div>
          <div className="space-y-2">
            {data.expenses.breakdown.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-foreground/5 border border-border">
                <span className="text-sm">{item.item}</span>
                <span className="font-bold">${item.amount}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Care Goals */}
      {activeTab === "goals" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-2xl font-bold">Care Goals</h2>
          {data.careGoals.map(goal => (
            <div key={goal.id} className="p-4 rounded-lg bg-foreground/5 border border-border">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold flex items-center gap-2">
                  <Target className="w-4 h-4 text-green-400" />
                  {goal.goal}
                </h3>
                <span className="text-sm font-bold text-green-400">{goal.progress}%</span>
              </div>
              <div className="w-full h-2 bg-foreground/10 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${goal.progress}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground">{goal.notes}</p>
              <p className="text-xs text-muted-foreground mt-2">Started: {new Date(goal.startDate).toLocaleDateString()}</p>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
