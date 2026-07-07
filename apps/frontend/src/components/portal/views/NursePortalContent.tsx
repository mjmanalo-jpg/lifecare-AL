"use client";

import { useState } from "react";
import StatCard from "@/components/portal/widgets/StatCard";
import ChartContainer from "@/components/portal/widgets/ChartContainer";
import AlertBanner from "@/components/portal/widgets/AlertBanner";
import VitalsPanel, { VitalReading } from "@/components/portal/widgets/VitalsPanel";
import ResidentCard from "@/components/portal/widgets/ResidentCard";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import {
  Activity,
  AlertTriangle,
  Users,
  Heart,
  Grid,
  Zap,
  X,
  Search,
  Eye,
  Filter,
  Clock,
  CheckCircle,
  Trash2,
} from "lucide-react";
import { useMemo, useEffect } from "react";

interface NursePortalContentProps {
  tab: string;
}

import Swal from "sweetalert2";

export default function NursePortalContent({ tab }: NursePortalContentProps) {
  const [showVitalsModal, setShowVitalsModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedResidents, setSelectedResidents] = useState<Set<string>>(new Set());
  const [selectedResident, setSelectedResident] = useState<typeof mockResidents[0] | null>(null);
  const [editingResident, setEditingResident] = useState<typeof mockResidents[0] | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    room: string;
    careLevel: "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";
    allergies: string;
    medications: string;
    conditions: string;
  }>({
    name: "",
    room: "",
    careLevel: "INDEPENDENT",
    allergies: "Penicillin, Sulfa drugs",
    medications: "Lisinopril 10mg, Metformin 500mg",
    conditions: "Hypertension, Type 2 Diabetes",
  });

  const startEditing = () => {
    if (selectedResident) {
      setEditingResident(selectedResident);
      setEditForm({
        name: selectedResident.name,
        room: selectedResident.room,
        careLevel: selectedResident.careLevel,
        allergies: "Penicillin, Sulfa drugs",
        medications: "Lisinopril 10mg, Metformin 500mg",
        conditions: "Hypertension, Type 2 Diabetes",
      });
    }
  };

  const handleSaveEdit = async () => {
    const result = await Swal.fire({
      title: "Save Changes?",
      text: `Update record for ${editForm.name}?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#fbbf24",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Save",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      Swal.fire({
        title: "Saved",
        text: `${editForm.name}'s record has been updated.`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      setEditingResident(null);
      setSelectedResident(null);
    }
  };

  // Incidents Management
  const mockIncidentsData = [
    { id: "1", type: "Fall", severity: "critical", resident: "Eleanor Fitzroy", room: "305", timestamp: new Date(Date.now() - 15 * 60000), status: "open", description: "Unsteady gait during ambulation. Resident nearly fell.", notes: "Assigned mobility assistance.", resolved: false },
    { id: "2", type: "Medication Error", severity: "high", resident: "Arthur Pendelton", room: "302", timestamp: new Date(Date.now() - 45 * 60000), status: "in-progress", description: "Wrong dosage administered.", notes: "Physician notified. Monitoring vitals.", resolved: false },
    { id: "3", type: "Behavioral Change", severity: "high", resident: "Eleanor Fitzroy", room: "305", timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), status: "closed", description: "Increased confusion and agitation.", notes: "Resolved with medication adjustment.", resolved: true },
    { id: "4", type: "Vital Sign Alert", severity: "medium", resident: "Robert Chen", room: "310", timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000), status: "closed", description: "Blood pressure spike to 165/95.", notes: "Resolved with rest and monitoring.", resolved: true },
    { id: "5", type: "Equipment Malfunction", severity: "medium", resident: "Margaret Wilson", room: "312", timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000), status: "closed", description: "Call bell not functioning.", notes: "Maintenance repaired unit.", resolved: true },
    { id: "6", type: "Skin Breakdown", severity: "high", resident: "James Murphy", room: "308", timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000), status: "open", description: "Pressure ulcer detected on sacrum.", notes: "Wound care initiated. Monitor daily.", resolved: false },
    { id: "7", type: "Dietary Issue", severity: "low", resident: "Arthur Pendelton", room: "302", timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000), status: "closed", description: "Resident choking during meal.", notes: "Adjusted food consistency. No aspiration.", resolved: true },
    { id: "8", type: "Infection Risk", severity: "critical", resident: "Margaret Wilson", room: "312", timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000), status: "in-progress", description: "Signs of urinary tract infection.", notes: "Lab culture sent. Started antibiotics.", resolved: false },
  ];

  const [incidents, setIncidents] = useState(mockIncidentsData);
  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentFilterSeverity, setIncidentFilterSeverity] = useState<string>("all");
  const [incidentFilterStatus, setIncidentFilterStatus] = useState<string>("all");
  const [viewingIncident, setViewingIncident] = useState<typeof mockIncidentsData[0] | null>(null);
  const [incidentPage, setIncidentPage] = useState(1);
  const [incidentItemsPerPage, setIncidentItemsPerPage] = useState(10);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      const matchesSearch =
        incident.type.toLowerCase().includes(incidentSearch.toLowerCase()) ||
        incident.resident.toLowerCase().includes(incidentSearch.toLowerCase()) ||
        incident.room.toLowerCase().includes(incidentSearch.toLowerCase());

      const matchesSeverity = incidentFilterSeverity === "all" || incident.severity === incidentFilterSeverity;
      const matchesStatus = incidentFilterStatus === "all" || incident.status === incidentFilterStatus;

      return matchesSearch && matchesSeverity && matchesStatus;
    });
  }, [incidents, incidentSearch, incidentFilterSeverity, incidentFilterStatus]);

  const incidentTotalPages = Math.ceil(filteredIncidents.length / incidentItemsPerPage);
  const incidentStartIndex = (incidentPage - 1) * incidentItemsPerPage;
  const incidentEndIndex = incidentStartIndex + incidentItemsPerPage;
  const paginatedIncidents = filteredIncidents.slice(incidentStartIndex, incidentEndIndex);

  useEffect(() => {
    setIncidentPage(1);
  }, [incidentSearch, incidentFilterSeverity, incidentFilterStatus]);

  const handleDeleteIncident = async (id: string) => {
    const result = await Swal.fire({
      title: "Delete Incident?",
      text: "Remove this incident from log?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      setIncidents(incidents.filter((i) => i.id !== id));
      Swal.fire({
        title: "Deleted",
        text: "Incident removed.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    }
  };

  const handleResolveIncident = async (id: string) => {
    const result = await Swal.fire({
      title: "Resolve Incident?",
      text: "Mark this incident as resolved?",
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#10b981",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Resolve",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      setIncidents(
        incidents.map((i) =>
          i.id === id ? { ...i, status: "closed", resolved: true } : i
        )
      );
      Swal.fire({
        title: "Resolved",
        text: "Incident marked as closed.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    }
  };

  const [vitals] = useState<VitalReading[]>([
    {
      type: "HEART_RATE",
      value: 78,
      unit: "bpm",
      normal: true,
      lastUpdated: new Date(),
    },
    {
      type: "TEMPERATURE",
      value: 37.0,
      unit: "°C",
      normal: true,
      lastUpdated: new Date(),
    },
    {
      type: "BLOOD_PRESSURE",
      value: 120,
      unit: "mmHg",
      normal: true,
      lastUpdated: new Date(),
    },
    {
      type: "OXYGEN",
      value: 98,
      unit: "%",
      normal: true,
      lastUpdated: new Date(),
    },
  ]);

  // Mock data for demo
  const mockVitalsData = [
    { name: "12 AM", value: 72 },
    { name: "4 AM", value: 70 },
    { name: "8 AM", value: 75 },
    { name: "12 PM", value: 78 },
    { name: "4 PM", value: 80 },
    { name: "8 PM", value: 76 },
  ];

  type Resident = {
    id: string;
    name: string;
    room: string;
    careLevel: "INDEPENDENT" | "ASSISTED" | "MEMORY" | "SKILLED";
    status: "ACTIVE" | "INACTIVE";
    alertsCount: number;
  };

  const mockResidents: Resident[] = [
    {
      id: "1",
      name: "Arthur Pendelton",
      room: "302",
      careLevel: "ASSISTED",
      status: "ACTIVE",
      alertsCount: 0,
    },
    {
      id: "2",
      name: "Eleanor Fitzroy",
      room: "305",
      careLevel: "MEMORY",
      status: "ACTIVE",
      alertsCount: 1,
    },
    {
      id: "3",
      name: "Robert Chen",
      room: "308",
      careLevel: "SKILLED",
      status: "ACTIVE",
      alertsCount: 0,
    },
  ];

  if (tab === "monitoring") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Real-Time Monitoring</h2>

          {/* Vital Signs Button */}
          <button
            onClick={() => setShowVitalsModal(true)}
            className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
          >
            Vital Signs • Arthur Pendelton
          </button>
        </div>

        {/* Full Width Camera Feed — Hybrid Mode (Local + Tapo IP) */}
        <div className="w-full bg-black rounded-lg overflow-hidden shadow-xl border-2 border-yellow-300">
          <CameraVisionFeed cameraMode="hybrid" />
        </div>

        {/* Heart Rate Trend Chart */}
        <ChartContainer
          title="Heart Rate Trend (24h)"
          type="area"
          data={mockVitalsData}
          dataKey="value"
          xAxisKey="name"
          colors={["#ef4444"]}
          height={250}
        />

        {/* Alerts Section */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">Active Alerts</h3>
          <AlertBanner
            type="warning"
            title="Fall Risk Detected"
            message="Resident showing unsteady gait pattern"
            resident="Arthur Pendelton (Room 302)"
            timestamp={new Date()}
            action={{
              label: "Review Footage",
              onClick: () => console.log("Reviewing..."),
            }}
          />
        </div>

        {/* Vitals Modal */}
        {showVitalsModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-96 overflow-y-auto">
              {/* Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-gray-900 to-black text-white p-6 flex items-center justify-between border-b border-yellow-300">
                <h3 className="text-xl font-bold">Vital Signs • Arthur Pendelton</h3>
                <button
                  onClick={() => setShowVitalsModal(false)}
                  className="p-2 hover:bg-gray-700 rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6">
                <VitalsPanel vitals={vitals} resident="Arthur Pendelton" />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (tab === "incidents") {
    const incidentStats = {
      total: incidents.length,
      open: incidents.filter((i) => i.status === "open").length,
      critical: incidents.filter((i) => i.severity === "critical" && i.status !== "closed").length,
      resolved: incidents.filter((i) => i.resolved).length,
    };

    const getSeverityColor = (severity: string) => {
      switch (severity) {
        case "critical":
          return "bg-red-100 text-red-800 border-red-300";
        case "high":
          return "bg-orange-100 text-orange-800 border-orange-300";
        case "medium":
          return "bg-yellow-100 text-yellow-800 border-yellow-300";
        default:
          return "bg-green-100 text-green-800 border-green-300";
      }
    };

    const getStatusColor = (status: string) => {
      switch (status) {
        case "open":
          return "bg-red-50 border-red-200";
        case "in-progress":
          return "bg-yellow-50 border-yellow-200";
        case "closed":
          return "bg-green-50 border-green-200";
        default:
          return "bg-gray-50 border-gray-200";
      }
    };

    const getSeverityIcon = (severity: string) => {
      switch (severity) {
        case "critical":
          return "🚨";
        case "high":
          return "⚠️";
        case "medium":
          return "⚡";
        default:
          return "ℹ️";
      }
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-2">
            Incident Log
          </h1>
          <p className="text-gray-600">Track and manage resident incidents and safety events</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-600 font-semibold">Total Incidents</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{incidentStats.total}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-red-200 bg-red-50">
            <p className="text-sm text-red-700 font-semibold">Open</p>
            <p className="text-3xl font-bold text-red-600 mt-1">{incidentStats.open}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-orange-200 bg-orange-50">
            <p className="text-sm text-orange-700 font-semibold">Critical</p>
            <p className="text-3xl font-bold text-orange-600 mt-1">{incidentStats.critical}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-green-200 bg-green-50">
            <p className="text-sm text-green-700 font-semibold">Resolved</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{incidentStats.resolved}</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by type, resident, or room..."
              value={incidentSearch}
              onChange={(e) => setIncidentSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Severity</label>
              <select
                value={incidentFilterSeverity}
                onChange={(e) => setIncidentFilterSeverity(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              >
                <option value="all">All Levels</option>
                <option value="critical">Critical Only</option>
                <option value="high">High & Above</option>
                <option value="medium">Medium & Above</option>
                <option value="low">Low Priority</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
              <select
                value={incidentFilterStatus}
                onChange={(e) => setIncidentFilterStatus(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              >
                <option value="all">All Status</option>
                <option value="open">Open Only</option>
                <option value="in-progress">In Progress</option>
                <option value="closed">Resolved Only</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Show per page</label>
              <select
                value={incidentItemsPerPage}
                onChange={(e) => {
                  setIncidentItemsPerPage(parseInt(e.target.value));
                  setIncidentPage(1);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              >
                <option value={10}>10 per page</option>
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
            </div>
          </div>
        </div>

        {/* Incidents List */}
        <div className="space-y-3">
          {paginatedIncidents.length > 0 ? (
            paginatedIncidents.map((incident) => (
              <div
                key={incident.id}
                className={`p-4 rounded-lg border transition ${getStatusColor(incident.status)}`}
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl mt-1">{getSeverityIcon(incident.severity)}</div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h4 className={`text-lg font-bold ${incident.resolved ? "line-through text-gray-500" : "text-gray-900"}`}>
                          {incident.type}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">
                          {incident.resident} • Room {incident.room}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className={`px-2 py-1 rounded text-xs font-semibold border ${getSeverityColor(incident.severity)}`}>
                          {incident.severity.toUpperCase()}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-semibold bg-gray-200 text-gray-800`}>
                          {incident.status.toUpperCase()}
                        </span>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                          {new Date(incident.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    <p className="text-sm text-gray-900 mb-2">{incident.description}</p>

                    {incident.notes && (
                      <p className="text-sm text-gray-600 p-2 bg-gray-100 rounded border-l-2 border-yellow-400 mb-3">
                        📝 {incident.notes}
                      </p>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setViewingIncident(incident)}
                        className="flex items-center gap-1 px-3 py-1 text-blue-600 hover:bg-blue-50 rounded text-sm font-medium transition"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </button>
                      {incident.status !== "closed" && (
                        <button
                          onClick={() => handleResolveIncident(incident.id)}
                          className="flex items-center gap-1 px-3 py-1 text-green-600 hover:bg-green-50 rounded text-sm font-medium transition"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Resolve
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteIncident(incident.id)}
                        className="flex items-center gap-1 px-3 py-1 text-red-600 hover:bg-red-50 rounded text-sm font-medium transition"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              No incidents match your filters.
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredIncidents.length > 0 && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm text-gray-600">
              Showing {incidentStartIndex + 1}-{Math.min(incidentEndIndex, filteredIncidents.length)} of {filteredIncidents.length} incidents
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIncidentPage(Math.max(1, incidentPage - 1))}
                disabled={incidentPage === 1}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
              >
                Previous
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: incidentTotalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setIncidentPage(page)}
                    className={`px-3 py-2 rounded-lg font-medium transition ${
                      incidentPage === page
                        ? "bg-yellow-400 text-black"
                        : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setIncidentPage(Math.min(incidentTotalPages, incidentPage + 1))}
                disabled={incidentPage === incidentTotalPages}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Incident Details Modal */}
        {viewingIncident && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className={`sticky top-0 bg-gradient-to-r ${
                viewingIncident.severity === "critical"
                  ? "from-red-400 to-red-500"
                  : viewingIncident.severity === "high"
                  ? "from-orange-400 to-orange-500"
                  : "from-blue-400 to-blue-500"
              } text-white p-6 flex items-center justify-between`}>
                <div>
                  <h2 className="text-2xl font-bold">{getSeverityIcon(viewingIncident.severity)} {viewingIncident.type}</h2>
                  <p className="text-white/90">{viewingIncident.resident} • Room {viewingIncident.room}</p>
                </div>
                <button
                  onClick={() => setViewingIncident(null)}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Severity</label>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${getSeverityColor(viewingIncident.severity)}`}>
                      {viewingIncident.severity.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Status</label>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${
                      viewingIncident.status === "open"
                        ? "bg-red-100 text-red-800"
                        : viewingIncident.status === "in-progress"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-green-100 text-green-800"
                    }`}>
                      {viewingIncident.status.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Timestamp</label>
                    <p className="text-gray-900 font-medium">{new Date(viewingIncident.timestamp).toLocaleString()}</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-gray-900 mb-2">Description</h3>
                  <p className="text-gray-700 p-3 bg-gray-50 rounded border border-gray-200">{viewingIncident.description}</p>
                </div>

                {viewingIncident.notes && (
                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                    <h3 className="font-bold text-gray-900 mb-2">Notes</h3>
                    <p className="text-gray-900">{viewingIncident.notes}</p>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button
                  onClick={() => setViewingIncident(null)}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Close
                </button>
                {viewingIncident.status !== "closed" && (
                  <button
                    onClick={() => {
                      handleResolveIncident(viewingIncident.id);
                      setViewingIncident(null);
                    }}
                    className="px-6 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition"
                  >
                    Mark Resolved
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (tab === "records") {
    const filteredResidents = mockResidents.filter(
      (r) =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.room.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const allSelected = filteredResidents.length > 0 &&
      filteredResidents.every((r) => selectedResidents.has(r.id));

    const handleSelectAll = () => {
      if (allSelected) {
        const newSelected = new Set(selectedResidents);
        filteredResidents.forEach((r) => newSelected.delete(r.id));
        setSelectedResidents(newSelected);
      } else {
        const newSelected = new Set(selectedResidents);
        filteredResidents.forEach((r) => newSelected.add(r.id));
        setSelectedResidents(newSelected);
      }
    };

    const handleToggleResident = (id: string) => {
      const newSelected = new Set(selectedResidents);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      setSelectedResidents(newSelected);
    };

    const handleDeleteSelected = async () => {
      if (selectedResidents.size === 0) {
        Swal.fire({
          title: "No Selection",
          text: "Please select at least one resident to delete.",
          icon: "warning",
          confirmButtonColor: "#fbbf24",
        });
        return;
      }

      const result = await Swal.fire({
        title: "Delete Selected Residents?",
        text: `You are about to delete ${selectedResidents.size} resident(s). This action cannot be undone.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#dc2626",
        cancelButtonColor: "#6b7280",
        confirmButtonText: "Yes, Delete",
        cancelButtonText: "Cancel",
      });

      if (result.isConfirmed) {
        // Simulate deletion
        setSelectedResidents(new Set());
        Swal.fire({
          title: "Deleted",
          text: `${selectedResidents.size} resident(s) have been deleted.`,
          icon: "success",
          timer: 1500,
          showConfirmButton: false,
        });
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Resident Records</h2>
          {selectedResidents.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition active:scale-95"
            >
              Delete Selected ({selectedResidents.size})
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search by name or room number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none bg-white text-gray-900"
          />
          <svg
            className="absolute right-4 top-3.5 w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Responsive Table */}
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-gray-900 to-black text-white">
              <tr>
                <th className="px-6 py-4 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleSelectAll}
                    className="w-5 h-5 cursor-pointer rounded"
                  />
                </th>
                <th className="px-6 py-4 text-left font-semibold">Name</th>
                <th className="px-6 py-4 text-left font-semibold">Room</th>
                <th className="px-6 py-4 text-left font-semibold">Care Level</th>
                <th className="px-6 py-4 text-left font-semibold">Status</th>
                <th className="px-6 py-4 text-left font-semibold">Alerts</th>
                <th className="px-6 py-4 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredResidents.length > 0 ? (
                filteredResidents.map((resident, idx) => (
                  <tr
                    key={resident.id}
                    className={`border-t border-gray-200 hover:bg-yellow-50 transition ${
                      idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                    }`}
                  >
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedResidents.has(resident.id)}
                        onChange={() => handleToggleResident(resident.id)}
                        className="w-5 h-5 cursor-pointer rounded"
                      />
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-900">
                      {resident.name}
                    </td>
                    <td className="px-6 py-4 text-gray-700">{resident.room}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          resident.careLevel === "INDEPENDENT"
                            ? "bg-green-100 text-green-800"
                            : resident.careLevel === "ASSISTED"
                            ? "bg-blue-100 text-blue-800"
                            : resident.careLevel === "MEMORY"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-orange-100 text-orange-800"
                        }`}
                      >
                        {resident.careLevel.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          resident.status === "ACTIVE"
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {resident.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {resident.alertsCount > 0 ? (
                        <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                          {resident.alertsCount}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => setSelectedResident(resident)}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-sm"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    No residents found matching "{searchQuery}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Results Count */}
        <div className="text-sm text-gray-600">
          Showing {filteredResidents.length} of {mockResidents.length} residents
          {selectedResidents.size > 0 && ` • ${selectedResidents.size} selected`}
        </div>

        {/* Resident Detail Modal */}
        {selectedResident && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-gray-900 to-black text-white p-6 flex items-center justify-between border-b border-yellow-300">
                <h2 className="text-2xl font-bold">{selectedResident.name}</h2>
                <button
                  onClick={() => setSelectedResident(null)}
                  className="p-2 hover:bg-gray-700 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-8 space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-600 mb-2">Room Number</h3>
                    <p className="text-2xl font-bold text-gray-900">{selectedResident.room}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-600 mb-2">Status</h3>
                    <span className={`inline-block px-4 py-2 rounded-lg font-semibold ${
                      selectedResident.status === "ACTIVE"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}>
                      {selectedResident.status}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-600 mb-2">Care Level</h3>
                    <span className={`inline-block px-4 py-2 rounded-lg font-semibold ${
                      selectedResident.careLevel === "INDEPENDENT"
                        ? "bg-green-100 text-green-800"
                        : selectedResident.careLevel === "ASSISTED"
                        ? "bg-blue-100 text-blue-800"
                        : selectedResident.careLevel === "MEMORY"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-orange-100 text-orange-800"
                    }`}>
                      {selectedResident.careLevel.replace("_", " ")}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-600 mb-2">Active Alerts</h3>
                    <p className="text-2xl font-bold text-gray-900">{selectedResident.alertsCount}</p>
                  </div>
                </div>

                {/* Divider */}
                <hr className="border-gray-200" />

                {/* Medical History */}
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Medical Information</h3>
                  <div className="space-y-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Allergies</p>
                      <p className="font-semibold text-gray-900">Penicillin, Sulfa drugs</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Current Medications</p>
                      <p className="font-semibold text-gray-900">Lisinopril 10mg, Metformin 500mg</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Chronic Conditions</p>
                      <p className="font-semibold text-gray-900">Hypertension, Type 2 Diabetes</p>
                    </div>
                  </div>
                </div>

                {/* Recent Activity */}
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-3 pb-3 border-b border-gray-200">
                      <span className="text-gray-400 text-xs">Today</span>
                      <div>
                        <p className="font-medium text-gray-900">Vital signs recorded</p>
                        <p className="text-gray-600">HR: 75 bpm, BP: 120/80</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 pb-3 border-b border-gray-200">
                      <span className="text-gray-400 text-xs">Yesterday</span>
                      <div>
                        <p className="font-medium text-gray-900">Physical therapy session</p>
                        <p className="text-gray-600">30 minutes, mobility improved</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="text-gray-400 text-xs">2 days ago</span>
                      <div>
                        <p className="font-medium text-gray-900">Medication adjustment</p>
                        <p className="text-gray-600">Blood pressure medication increased</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button
                  onClick={() => setSelectedResident(null)}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Close
                </button>
                <button
                  onClick={startEditing}
                  className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
                >
                  Edit Record
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingResident && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              {/* Edit Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-6 flex items-center justify-between border-b border-yellow-600">
                <h2 className="text-2xl font-bold">Edit Record</h2>
                <button
                  onClick={() => setEditingResident(null)}
                  className="p-2 hover:bg-yellow-600/20 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Edit Form */}
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Room Number
                    </label>
                    <input
                      type="text"
                      value={editForm.room}
                      onChange={(e) => setEditForm({ ...editForm, room: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Care Level
                    </label>
                    <select
                      value={editForm.careLevel}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          careLevel: e.target.value as any,
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    >
                      <option value="INDEPENDENT">Independent</option>
                      <option value="ASSISTED">Assisted</option>
                      <option value="MEMORY">Memory Care</option>
                      <option value="SKILLED">Skilled Nursing</option>
                    </select>
                  </div>
                </div>

                {/* Medical Info */}
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Medical Information</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Allergies
                      </label>
                      <textarea
                        value={editForm.allergies}
                        onChange={(e) => setEditForm({ ...editForm, allergies: e.target.value })}
                        rows={2}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Current Medications
                      </label>
                      <textarea
                        value={editForm.medications}
                        onChange={(e) => setEditForm({ ...editForm, medications: e.target.value })}
                        rows={2}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Chronic Conditions
                      </label>
                      <textarea
                        value={editForm.conditions}
                        onChange={(e) => setEditForm({ ...editForm, conditions: e.target.value })}
                        rows={2}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Edit Modal Footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button
                  onClick={() => setEditingResident(null)}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Default: Dashboard tab
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-foreground">Clinical Dashboard</h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Active Residents"
          value="12"
          icon={Users}
          trend={{ direction: "up", percent: 5 }}
          backgroundColor="bg-blue-50"
          textColor="text-blue-900"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Pending Alerts"
          value="3"
          icon={AlertTriangle}
          backgroundColor="bg-yellow-50"
          textColor="text-yellow-900"
          iconColor="text-yellow-500"
        />
        <StatCard
          title="Avg Heart Rate"
          value="76"
          unit="bpm"
          icon={Heart}
          backgroundColor="bg-red-50"
          textColor="text-red-900"
          iconColor="text-red-500"
        />
        <StatCard
          title="System Status"
          value="Healthy"
          icon={Zap}
          backgroundColor="bg-green-50"
          textColor="text-green-900"
          iconColor="text-green-500"
        />
      </div>

      {/* Vitals Panel */}
      <VitalsPanel vitals={vitals} resident="Arthur Pendelton (Room 302)" />

      {/* Chart */}
      <ChartContainer
        title="Heart Rate Trend (24 hours)"
        type="area"
        data={mockVitalsData}
        dataKey="value"
        xAxisKey="name"
        colors={["#ef4444"]}
        height={250}
      />

      {/* Alerts */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">Recent Alerts</h3>
        <AlertBanner
          type="warning"
          title="Fall Detection"
          message="Possible fall event detected"
          resident="Eleanor Fitzroy (Room 305)"
          timestamp={new Date()}
          action={{
            label: "Review Footage",
            onClick: () => console.log("Reviewing..."),
          }}
        />
      </div>
    </div>
  );
}
