"use client";

import { useMemo, useState } from "react";
import {
  DoorOpen, Search, X, Eye, Edit, Building2, MapPin,
  ChevronDown, ChevronRight, Users, DollarSign, BedDouble,
  Wifi, Bath, Snowflake, Maximize, Check, XCircle, Settings,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptRoom, residentName } from "@/lib/adapters";
import { updateRecord } from "@/lib/api";

type Room = ReturnType<typeof adaptRoom>;

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-800 border-green-200",
  OCCUPIED: "bg-blue-100 text-blue-800 border-blue-200",
  MAINTENANCE: "bg-yellow-100 text-yellow-800 border-yellow-200",
  RESERVED: "bg-purple-100 text-purple-800 border-purple-200",
};
const STATUS_CARD: Record<string, string> = {
  AVAILABLE: "border-green-300 bg-green-50/30",
  OCCUPIED: "border-blue-300 bg-blue-50/30",
  MAINTENANCE: "border-yellow-300 bg-yellow-50/30",
  RESERVED: "border-purple-300 bg-purple-50/30",
};
const STATUS_HEADER: Record<string, string> = {
  AVAILABLE: "bg-green-500",
  OCCUPIED: "bg-blue-500",
  MAINTENANCE: "bg-yellow-500",
  RESERVED: "bg-purple-500",
};
const TYPE_LABEL: Record<string, string> = {
  PRIVATE: "Private", SEMI_PRIVATE: "Semi-Private", WARD: "Ward", SUITE: "Suite",
};

const FEATURE_ICONS: Record<string, React.ReactNode> = {
  wifi: <Wifi className="w-3 h-3" />,
  bath: <Bath className="w-3 h-3" />,
  ac: <Snowflake className="w-3 h-3" />,
  balcony: <Maximize className="w-3 h-3" />,
  call: <Bell className="w-3 h-3" />,
  wheelchair: <Accessibility className="w-3 h-3" />,
};

export default function FacilityRooms() {
  const { data: roomRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "rooms", { query: "take=100", tables: ["Room"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=100", tables: ["Resident"] }
  );
  const rooms = useMemo<Room[]>(() => roomRows.map(adaptRoom), [roomRows]);

  const residentMap = useMemo(() => {
    const m = new Map<string, any[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    (residentRows ?? []).forEach((r: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const room = r.roomNumber;
      if (!m.has(room)) m.set(room, []);
      m.get(room)!.push(r);
    });
    return m;
  }, [residentRows]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [wingFilter, setWingFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<Room | null>(null);
  const [editing, setEditing] = useState<Room | null>(null);
  const [editingStatus, setEditingStatus] = useState(false);
  const [editForm, setEditForm] = useState({
    roomNumber: "", floor: "", wing: "", roomType: "", capacity: 1,
    status: "AVAILABLE", features: "", rateMonthly: "", notes: "",
  });

  const wings = useMemo(() => {
    const s = new Set(rooms.map((r) => r.wing));
    return Array.from(s).sort();
  }, [rooms]);

  const floors = useMemo(() => {
    const s = new Set(rooms.map((r) => r.floor).filter((f) => f !== "—").map(Number));
    return Array.from(s).sort((a, b) => a - b);
  }, [rooms]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms.filter((r) => {
      if (q && !r.roomNumber.toLowerCase().includes(q) && !r.wing.toLowerCase().includes(q) && !r.features.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (wingFilter !== "all" && r.wing !== wingFilter) return false;
      if (typeFilter !== "all" && r.roomType !== typeFilter) return false;
      return true;
    });
  }, [rooms, search, statusFilter, wingFilter, typeFilter]);

  const roomsByFloor = useMemo(() => {
    const map = new Map<string, Room[]>();
    filtered.forEach((r) => {
      const key = `Floor ${r.floor}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      const na = parseInt(a.replace("Floor ", ""));
      const nb = parseInt(b.replace("Floor ", ""));
      return na - nb;
    });
  }, [filtered]);

  const stats = useMemo(() => ({
    total: rooms.length,
    occupied: rooms.filter((r) => r.status === "OCCUPIED").length,
    available: rooms.filter((r) => r.status === "AVAILABLE").length,
    maintenance: rooms.filter((r) => r.status === "MAINTENANCE").length,
    reserved: rooms.filter((r) => r.status === "RESERVED").length,
  }), [rooms]);

  const occupancyRate = stats.total ? Math.round((stats.occupied / stats.total) * 100) : 0;

  const toggleFloor = (floor: string) => {
    const next = new Set(expandedFloors);
    if (next.has(floor)) next.delete(floor); else next.add(floor);
    setExpandedFloors(next);
  };

  const startEditing = (room: Room) => {
    setEditing(room);
    setEditingStatus(false);
    setEditForm({
      roomNumber: room.roomNumber, floor: String(room.floor),
      wing: room.wing, roomType: room.roomType, capacity: room.capacity,
      status: room.status, features: room.features,
      rateMonthly: room.rateMonthly ? String(room.rateMonthly) : "",
      notes: room.notes,
    });
  };

  const handleSaveEdit = async () => {
    const result = await Swal.fire({
      title: "Save Changes?", text: `Update Room ${editForm.roomNumber}?`, icon: "question",
      showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280",
      confirmButtonText: "Save", cancelButtonText: "Cancel",
    });
    if (result.isConfirmed && editing) {
      try {
        await updateRecord("rooms", editing.id, {
          roomNumber: editForm.roomNumber, floor: Number(editForm.floor) || null,
          wing: editForm.wing, roomType: editForm.roomType, capacity: editForm.capacity,
          status: editForm.status, features: editForm.features,
          rateMonthly: Number(editForm.rateMonthly) || null, notes: editForm.notes,
        });
        await refetch();
        setEditing(null);
        Swal.fire({ title: "Saved", text: `Room ${editForm.roomNumber} updated.`, icon: "success", timer: 1500, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not update room.", icon: "error" });
      }
    }
  };

  const quickStatusChange = async (room: Room, status: string) => {
    if (room.status === status) return;
    const result = await Swal.fire({
      title: "Change Status?", text: `Set Room ${room.roomNumber} to ${status.charAt(0) + status.slice(1).toLowerCase()}?`, icon: "question",
      showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280",
      confirmButtonText: "Change", cancelButtonText: "Cancel",
    });
    if (result.isConfirmed) {
      try {
        await updateRecord("rooms", room.id, { status });
        await refetch();
      } catch (err) {
        Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not update status.", icon: "error" });
      }
    }
  };

  const RoomCard = ({ room }: { room: Room }) => {
    const residents = residentMap.get(room.roomNumber) ?? [];
    return (
      <div className={`rounded-xl border-2 ${STATUS_CARD[room.status] || "border-gray-200"} bg-white overflow-hidden hover:shadow-lg transition-all active:scale-[0.98]`}>
        <div className={`${STATUS_HEADER[room.status] || "bg-gray-500"} px-4 py-2 flex items-center justify-between`}>
          <span className="text-white font-bold text-lg">Room {room.roomNumber}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_BADGE[room.status] || "bg-gray-100 text-gray-800"}`}>
            {room.status.charAt(0) + room.status.slice(1).toLowerCase()}
          </span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Floor {room.floor}</span>
            <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {room.wing}</span>
            <span className="flex items-center gap-1"><BedDouble className="w-3.5 h-3.5" /> {TYPE_LABEL[room.roomType] || room.roomType}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>{room.capacity === 1 ? "Single" : `${room.capacity} beds`}</span>
            {room.rateMonthly && (
              <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" /> {room.rateMonthly.toLocaleString()}/mo</span>
            )}
          </div>
          {room.features && (
            <div className="flex flex-wrap gap-1.5">
              {room.features.split(",").map((f, i) => {
                const key = f.trim().toLowerCase();
                return (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                    {FEATURE_ICONS[key] ?? null}
                    {f.trim()}
                  </span>
                );
              })}
            </div>
          )}
          {residents.length > 0 && (
            <div className="bg-blue-50 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Occupants</p>
              {residents.map((r: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <p key={r.id} className="text-sm text-blue-900">{residentName(r)}</p>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setViewing(room)} className="flex-1 px-3 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1">
              <Eye className="w-3.5 h-3.5" /> View
            </button>
            <button onClick={() => startEditing(room)} className="flex-1 px-3 py-2 bg-yellow-50 text-yellow-600 hover:bg-yellow-100 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1">
              <Edit className="w-3.5 h-3.5" /> Edit
            </button>
            <div className="relative group">
              <button className="px-3 py-2 bg-gray-50 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium transition">
                <Settings className="w-3.5 h-3.5" />
              </button>
              <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-20 hidden group-hover:block min-w-[140px]">
                {["AVAILABLE", "OCCUPIED", "MAINTENANCE", "RESERVED"].map((s) => (
                  <button key={s} onClick={() => { quickStatusChange(room, s); }} className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${room.status === s ? "font-semibold" : ""}`}>
                    {room.status === s ? <Check className="w-3.5 h-3.5 text-green-600" /> : <XCircle className="w-3.5 h-3.5 text-gray-300" />}
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Room Management
          </h1>
          <p className="text-gray-600">Manage facility rooms, assignments, and maintenance</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label="Total Rooms" value={String(stats.total)} icon={DoorOpen} color="blue" />
        <StatBox label="Occupied" value={String(stats.occupied)} icon={Building2} color="green" />
        <StatBox label="Available" value={String(stats.available)} icon={MapPin} color="emerald" />
        <StatBox label="In Maintenance" value={String(stats.maintenance)} icon={Settings} color="amber" />
        <StatBox label="Occupancy" value={`${occupancyRate}%`} icon={Users} color="purple" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="Search room number, wing, features..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none bg-white text-sm">
          <option value="all">All Status</option>
          <option value="AVAILABLE">Available</option>
          <option value="OCCUPIED">Occupied</option>
          <option value="MAINTENANCE">Maintenance</option>
          <option value="RESERVED">Reserved</option>
        </select>
        <select value={wingFilter} onChange={(e) => setWingFilter(e.target.value)}
          className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none bg-white text-sm">
          <option value="all">All Wings</option>
          {wings.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none bg-white text-sm">
          <option value="all">All Types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button onClick={() => setViewMode("grid")} className={`px-4 py-3 text-sm font-medium transition ${viewMode === "grid" ? "bg-yellow-400 text-black" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Grid
          </button>
          <button onClick={() => setViewMode("table")} className={`px-4 py-3 text-sm font-medium transition ${viewMode === "table" ? "bg-yellow-400 text-black" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Table
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load rooms: {error}</div>}

      {loading && rooms.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          <div className="inline-block w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p>Loading rooms...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">No rooms match your filters.</div>
      ) : viewMode === "grid" ? (
        <div className="space-y-4">
          {roomsByFloor.map(([floor, floorRooms]) => {
            const isExpanded = expandedFloors.has(floor);
            return (
              <div key={floor} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button onClick={() => toggleFloor(floor)} className="w-full flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-gray-50 hover:bg-gray-100 transition border-b border-gray-200">
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-500" /> : <ChevronRight className="w-5 h-5 text-gray-500" />}
                    <span className="font-bold text-gray-900">{floor}</span>
                    <span className="text-sm text-gray-500">({floorRooms.length} rooms)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["OCCUPIED", "AVAILABLE", "MAINTENANCE", "RESERVED"].map((s) => {
                      const c = floorRooms.filter((r) => r.status === s).length;
                      return c > 0 ? (
                        <span key={s} className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[s]}`}>{c} {s.charAt(0) + s.slice(1).toLowerCase()}</span>
                      ) : null;
                    })}
                  </div>
                </button>
                {isExpanded && (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {floorRooms.map((room) => <RoomCard key={room.id} room={room} />)}
                  </div>
                )}
              </div>
            );
          })}
          <div className="text-sm text-gray-500 text-center">{filtered.length} of {rooms.length} rooms</div>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-gray-600 font-semibold">
                    <th className="px-6 py-4">Room</th>
                    <th className="px-6 py-4">Floor</th>
                    <th className="px-6 py-4">Wing</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Capacity</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Rate</th>
                    <th className="px-6 py-4">Occupant</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filtered.map((room) => {
                    const residents = residentMap.get(room.roomNumber) ?? [];
                    return (
                      <tr key={room.id} className="hover:bg-gray-50 transition">
                        <td className="px-6 py-4 font-medium text-gray-900">{room.roomNumber}</td>
                        <td className="px-6 py-4 text-gray-700">{room.floor}</td>
                        <td className="px-6 py-4 text-gray-700">{room.wing}</td>
                        <td className="px-6 py-4 text-gray-700">{TYPE_LABEL[room.roomType] || room.roomType}</td>
                        <td className="px-6 py-4 text-gray-700">{room.capacity === 1 ? "Single" : `Shared (${room.capacity})`}</td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[room.status] || "bg-gray-100 text-gray-800"}`}>
                            {room.status.charAt(0) + room.status.slice(1).toLowerCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-700">${room.rateMonthly?.toLocaleString() ?? "—"}</td>
                        <td className="px-6 py-4 text-gray-600 text-xs">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {residents.length > 0 ? residents.map((r: any) => <div key={r.id}>{residentName(r)}</div>) : "—"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <div className="relative group">
                              <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition"><Settings className="w-4 h-4" /></button>
                              <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-20 hidden group-hover:block min-w-[140px]">
                                {["AVAILABLE", "OCCUPIED", "MAINTENANCE", "RESERVED"].map((s) => (
                                  <button key={s} onClick={() => quickStatusChange(room, s)} className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${room.status === s ? "font-semibold" : ""}`}>
                                    {room.status === s ? <Check className="w-3.5 h-3.5 text-green-600" /> : <XCircle className="w-3.5 h-3.5 text-gray-300" />}
                                    {s.charAt(0) + s.slice(1).toLowerCase()}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <button onClick={() => setViewing(room)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="View details"><Eye className="w-4 h-4" /></button>
                            <button onClick={() => startEditing(room)} className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition" title="Edit room"><Edit className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-sm text-gray-600">Showing {filtered.length} of {rooms.length} rooms</div>
        </>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90dvh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-400 to-blue-500 text-white p-4 sm:p-6 flex items-center justify-between border-b border-blue-600">
              <h2 className="text-xl sm:text-2xl font-bold">Room {viewing.roomNumber}</h2>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-blue-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 sm:p-8 space-y-6">
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-4 h-4 rounded-full ${viewing.status === "AVAILABLE" ? "bg-green-500" : viewing.status === "OCCUPIED" ? "bg-blue-500" : viewing.status === "MAINTENANCE" ? "bg-yellow-500" : "bg-purple-500"}`} />
                <div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[viewing.status] || "bg-gray-100 text-gray-800"}`}>
                    {viewing.status.charAt(0) + viewing.status.slice(1).toLowerCase()}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div><label className="block text-sm font-semibold text-gray-600 mb-2">Room Number</label><p className="text-lg font-medium text-gray-900">{viewing.roomNumber}</p></div>
                <div><label className="block text-sm font-semibold text-gray-600 mb-2">Floor</label><p className="text-lg text-gray-900">{viewing.floor}</p></div>
                <div><label className="block text-sm font-semibold text-gray-600 mb-2">Wing</label><p className="text-lg text-gray-900">{viewing.wing}</p></div>
                <div><label className="block text-sm font-semibold text-gray-600 mb-2">Type</label><p className="text-lg text-gray-900">{TYPE_LABEL[viewing.roomType] || viewing.roomType}</p></div>
                <div><label className="block text-sm font-semibold text-gray-600 mb-2">Capacity</label><p className="text-lg text-gray-900">{viewing.capacity === 1 ? "Single" : `Shared (${viewing.capacity} beds)`}</p></div>
                <div><label className="block text-sm font-semibold text-gray-600 mb-2">Rate</label><p className="text-lg text-gray-900">{viewing.rateMonthly ? `$${viewing.rateMonthly.toLocaleString()}/mo` : "—"}</p></div>
                {viewing.features && <div className="col-span-2"><label className="block text-sm font-semibold text-gray-600 mb-2">Features</label><p className="text-gray-900">{viewing.features}</p></div>}
                {viewing.notes && <div className="col-span-2"><label className="block text-sm font-semibold text-gray-600 mb-2">Notes</label><p className="text-gray-900 whitespace-pre-wrap">{viewing.notes}</p></div>}
                {(() => {
                  const residents = residentMap.get(viewing.roomNumber) ?? [];
                  return residents.length > 0 ? (
                    <div className="col-span-2">
                      <label className="block text-sm font-semibold text-gray-600 mb-2">Current Occupants</label>
                      <ul className="space-y-1">
                        {residents.map((r: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                          <li key={r.id} className="flex items-center gap-2 text-gray-900">
                            <Users className="w-4 h-4 text-blue-500" />
                            {residentName(r)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 sm:px-8 py-4 flex items-center justify-between">
              <button onClick={() => setViewing(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
              <button onClick={() => { startEditing(viewing); setViewing(null); }} className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">Edit</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90dvh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-4 sm:p-6 flex items-center justify-between border-b border-yellow-600">
              <h2 className="text-xl sm:text-2xl font-bold">Edit Room {editForm.roomNumber}</h2>
              <button onClick={() => setEditing(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 sm:p-8 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div><label className="block text-sm font-semibold text-gray-700 mb-2">Room Number</label><input type="text" value={editForm.roomNumber} onChange={(e) => setEditForm({ ...editForm, roomNumber: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-2">Floor</label><input type="number" value={editForm.floor} onChange={(e) => setEditForm({ ...editForm, floor: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-2">Wing</label><input type="text" value={editForm.wing} onChange={(e) => setEditForm({ ...editForm, wing: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-2">Type</label><select value={editForm.roomType} onChange={(e) => setEditForm({ ...editForm, roomType: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none bg-white">
                  <option value="PRIVATE">Private</option>
                  <option value="SEMI_PRIVATE">Semi-Private</option>
                  <option value="WARD">Ward</option>
                  <option value="SUITE">Suite</option>
                </select></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-2">Capacity</label><input type="number" min="1" value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: Number(e.target.value) || 1 })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-2">Rate (Monthly $)</label><input type="number" value={editForm.rateMonthly} onChange={(e) => setEditForm({ ...editForm, rateMonthly: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-2">Status</label><select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none bg-white">
                  <option value="AVAILABLE">Available</option>
                  <option value="OCCUPIED">Occupied</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="RESERVED">Reserved</option>
                </select></div>
                <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-2">Features</label><input type="text" value={editForm.features} onChange={(e) => setEditForm({ ...editForm, features: e.target.value })} placeholder="e.g. AC, Private bath, Balcony" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label><textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 sm:px-8 py-4 flex items-center justify-between">
              <button onClick={() => setEditing(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
              <button onClick={handleSaveEdit} className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Bell(props: any) { return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Accessibility(props: any) { return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/></svg>; }

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
  const COLORS: Record<string, string> = { blue: "text-blue-600 bg-blue-50", green: "text-green-600 bg-green-50", emerald: "text-emerald-600 bg-emerald-50", amber: "text-amber-600 bg-amber-50", red: "text-red-600 bg-red-50", purple: "text-purple-600 bg-purple-50" };
  return (
    <div className={`rounded-lg border p-4 ${COLORS[color] || COLORS.blue}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600">{label}</p>
        <Icon className={`w-4 h-4 ${COLORS[color]?.split(" ")[0] || "text-blue-600"}`} />
      </div>
      <p className={`text-xl sm:text-2xl font-bold mt-1 ${COLORS[color]?.split(" ")[0] || "text-blue-600"}`}>{value}</p>
    </div>
  );
}
