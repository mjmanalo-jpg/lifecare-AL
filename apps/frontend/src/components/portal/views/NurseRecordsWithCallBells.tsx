"use client";

import { useState, useMemo } from "react";
import { Search, Phone, Clock, AlertCircle, CheckCircle2, XCircle, X } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { updateRecord } from "@/lib/api";
import Swal from "@/lib/swal";

interface Resident {
  id: string;
  firstName: string;
  lastName: string;
  roomNumber: string;
  careLevel: string;
  admissionDate: string;
}

interface CallBell {
  id: string;
  residentId: string;
  status: "PENDING" | "RESPONDED" | "RESOLVED" | "CANCELLED";
  reason: string;
  createdAt: string;
  respondedAt?: string;
  resolvedAt?: string;
  notes?: string;
}

export default function NurseRecordsWithCallBells() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedResident, setSelectedResident] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");
  const [resolveFor, setResolveFor] = useState<{ bellId: string; reason: string; residentName: string } | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [resolveBusy, setResolveBusy] = useState(false);

  // Fetch residents and call bells
  const { data: residents } = useLiveQuery<Resident>("residents", {
    query: "take=200",
    tables: ["Resident"],
  });

  const { data: callBells, refetch: refetchCallBells } = useLiveQuery<CallBell>("call-bells", {
    query: "take=200",
    tables: ["CallBell"],
  });

  // Map residents with their active call bells
  const residentsWithBells = useMemo(() => {
    return residents.map((resident) => {
      const activeBells = callBells.filter(
        (bell) =>
          bell.residentId === resident.id && bell.status !== "RESOLVED" && bell.status !== "CANCELLED"
      );
      const pendingBells = activeBells.filter((b) => b.status === "PENDING");
      return { ...resident, activeBells, pendingBells };
    });
  }, [residents, callBells]);

  // Filter by search term
  const filteredResidents = useMemo(() => {
    return residentsWithBells.filter(
      (r) =>
        r.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.roomNumber.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [residentsWithBells, searchTerm]);

  const selectedResidentData = selectedResident
    ? residentsWithBells.find((r) => r.id === selectedResident)
    : null;

  const handleBellRespond = async (bellId: string, residentName: string) => {
    try {
      await updateRecord("call-bells", bellId, {
        status: "RESPONDED",
        respondedAt: new Date().toISOString(),
      });
      await refetchCallBells();
      Swal.fire({
        title: "Responded",
        text: `Responded to call from ${residentName}`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        title: "Error",
        text: err instanceof Error ? err.message : "Failed to respond",
        icon: "error",
      });
    }
  };

  const openBellResolve = (bellId: string, reason: string, residentName: string) => {
    setResolveNotes("");
    setResolveFor({ bellId, reason, residentName });
  };

  const submitBellResolve = async () => {
    if (!resolveFor) return;
    setResolveBusy(true);
    const { bellId, residentName } = resolveFor;
    try {
      await updateRecord("call-bells", bellId, {
        status: "RESOLVED",
        resolvedAt: new Date().toISOString(),
        notes: resolveNotes.trim() || "Resolved",
      });
      await refetchCallBells();
      setResolveFor(null);
      Swal.fire({
        title: "Resolved",
        text: `Call bell from ${residentName} marked resolved`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        title: "Error",
        text: err instanceof Error ? err.message : "Failed to resolve",
        icon: "error",
      });
    } finally {
      setResolveBusy(false);
    }
  };

  if (viewMode === "detail" && selectedResidentData) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => {
                setViewMode("list");
                setSelectedResident(null);
              }}
              className="text-blue-600 hover:text-blue-800 font-medium mb-2 flex items-center gap-2"
            >
              ← Back to Residents
            </button>
            <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              {selectedResidentData.firstName} {selectedResidentData.lastName}
            </h1>
            <p className="text-gray-600 mt-1">Room {selectedResidentData.roomNumber}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Resident Info */}
          <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="font-bold text-lg mb-4">Resident Information</h2>
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-gray-600 font-semibold">Care Level</p>
                <p className="text-gray-900">{selectedResidentData.careLevel}</p>
              </div>
              <div>
                <p className="text-gray-600 font-semibold">Admission Date</p>
                <p className="text-gray-900">
                  {new Date(selectedResidentData.admissionDate).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-gray-600 font-semibold">Active Call Bells</p>
                <p className="text-2xl font-bold text-red-600">
                  {selectedResidentData.pendingBells.length}
                </p>
              </div>
            </div>
          </div>

          {/* Active Call Bells */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Phone className="w-5 h-5 text-red-500" />
              Active Call Bells
            </h2>

            {selectedResidentData.activeBells.length > 0 ? (
              <div className="space-y-3">
                {selectedResidentData.activeBells.map((bell) => (
                  <div
                    key={bell.id}
                    className={`p-4 rounded-lg border ${
                      bell.status === "PENDING"
                        ? "bg-red-50 border-red-200"
                        : "bg-yellow-50 border-yellow-200"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{bell.reason}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {Math.round(
                            // eslint-disable-next-line react-hooks/purity
                            (Date.now() - new Date(bell.createdAt).getTime()) / 60000
                          )}{" "}
                          min ago
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          bell.status === "PENDING"
                            ? "bg-red-200 text-red-800"
                            : "bg-yellow-200 text-yellow-800"
                        }`}
                      >
                        {bell.status}
                      </span>
                    </div>

                    {bell.notes && (
                      <p className="text-sm text-gray-700 p-2 bg-white/50 rounded border border-gray-200 mb-3">
                        📝 {bell.notes}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {bell.status === "PENDING" && (
                        <button
                          onClick={() => handleBellRespond(bell.id, selectedResidentData.firstName)}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded-lg transition"
                        >
                          <Clock className="w-4 h-4" />
                          Respond
                        </button>
                      )}
                      <button
                        onClick={() =>
                          openBellResolve(bell.id, bell.reason, selectedResidentData.firstName)
                        }
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Resolve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <p>No active call bells for this resident</p>
              </div>
            )}
          </div>
        </div>

        {/* Resolve call bell modal */}
        {resolveFor && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !resolveBusy && setResolveFor(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-6 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">Resolve Call Bell</h2>
                  <p className="text-sm text-green-100">{resolveFor.residentName} • Room {selectedResidentData.roomNumber}</p>
                </div>
                <button onClick={() => setResolveFor(null)} className="p-2 hover:bg-green-700/20 rounded-lg transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
                  <p className="text-gray-900 font-medium">{resolveFor.reason}</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Resolution Notes</label>
                  <textarea
                    autoFocus
                    value={resolveNotes}
                    onChange={(e) => setResolveNotes(e.target.value)}
                    placeholder="Enter what was done to resolve this call..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none text-sm"
                    rows={3}
                  />
                </div>
              </div>
              <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex gap-3">
                <button
                  onClick={() => setResolveFor(null)}
                  disabled={resolveBusy}
                  className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submitBellResolve()}
                  disabled={resolveBusy}
                  className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition disabled:opacity-60"
                >
                  {resolveBusy ? "Resolving…" : "Mark Resolved"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // List View
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
          Resident Records & Call Bells
        </h1>
        <p className="text-gray-600">View resident records with active call bells highlighted</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or room number..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600 font-semibold">Total Residents</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{residentsWithBells.length}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-red-200 bg-red-50">
          <p className="text-sm text-red-700 font-semibold">Active Call Bells</p>
          <p className="text-3xl font-bold text-red-600 mt-1">
            {residentsWithBells.reduce((sum, r) => sum + r.activeBells.length, 0)}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-orange-200 bg-orange-50">
          <p className="text-sm text-orange-700 font-semibold">Pending</p>
          <p className="text-3xl font-bold text-orange-600 mt-1">
            {residentsWithBells.reduce((sum, r) => sum + r.pendingBells.length, 0)}
          </p>
        </div>
      </div>

      {/* Residents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredResidents.map((resident) => (
          <div
            key={resident.id}
            onClick={() => {
              setSelectedResident(resident.id);
              setViewMode("detail");
            }}
            className={`p-4 rounded-lg border cursor-pointer transition hover:shadow-lg ${
              resident.pendingBells.length > 0
                ? "border-red-200 bg-red-50 hover:border-red-300"
                : resident.activeBells.length > 0
                ? "border-yellow-200 bg-yellow-50 hover:border-yellow-300"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            {/* Call Bell Badge */}
            {resident.pendingBells.length > 0 && (
              <div className="flex items-center gap-2 mb-3 p-2 bg-red-100 rounded-lg border border-red-200">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span className="text-xs font-bold text-red-700">
                  {resident.pendingBells.length} PENDING BELL{resident.pendingBells.length > 1 ? "S" : ""}
                </span>
              </div>
            )}

            {/* Resident Header */}
            <div className="mb-3">
              <h3 className="font-bold text-lg text-gray-900">
                {resident.firstName} {resident.lastName}
              </h3>
              <p className="text-sm text-gray-600 mt-1">Room {resident.roomNumber}</p>
            </div>

            {/* Care Level */}
            <div className="mb-3 pb-3 border-b border-gray-200">
              <p className="text-xs text-gray-600 font-semibold">CARE LEVEL</p>
              <p className="text-sm font-semibold text-gray-900">{resident.careLevel}</p>
            </div>

            {/* Call Bell Status */}
            {resident.activeBells.length > 0 ? (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-red-500" />
                <span className="font-semibold">
                  {resident.activeBells.length} Active
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>No active bells</span>
              </div>
            )}

            {/* View Button */}
            <button className="w-full mt-4 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition text-sm">
              View Details
            </button>
          </div>
        ))}
      </div>

      {filteredResidents.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          No residents match your search
        </div>
      )}
    </div>
  );
}
