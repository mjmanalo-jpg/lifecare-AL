"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  BedDouble, Users, Building2, Activity, RefreshCw, Search, X,
  DoorOpen, ChevronDown, ChevronRight, Filter, LayoutGrid, Table2,
  Eye, Edit, Check, Wrench, Ban, Clock, MapPin, Hash, CreditCard,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, adaptRoom, humanize } from "@/lib/adapters";
import { updateRecord } from "@/lib/api";

const CARE_COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#ef4444"];

type Room = ReturnType<typeof adaptRoom>;
type Resident = ReturnType<typeof adaptResident>;

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string; border: string; icon: LucideIcon }> = {
  OCCUPIED:   { label: "Occupied",   bg: "bg-green-100",  text: "text-green-700",  border: "border-green-400",  icon: Users },
  AVAILABLE:  { label: "Available",  bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-400",   icon: DoorOpen },
  MAINTENANCE:{ label: "Maintenance",bg: "bg-amber-100",  text: "text-amber-700",  border: "border-amber-400",  icon: Wrench },
  RESERVED:   { label: "Reserved",   bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-400", icon: Clock },
};

const ROOM_TYPE_COLORS: Record<string, string> = {
  PRIVATE: "text-indigo-600 bg-indigo-50",
  SEMI_PRIVATE: "text-sky-600 bg-sky-50",
  WARD: "text-teal-600 bg-teal-50",
  SUITE: "text-rose-600 bg-rose-50",
};

export default function FacilityOccupancy() {
  const { data: roomRows, loading, refetch } = useLiveQuery<Record<string, unknown>>(
    "rooms", { query: "take=100", tables: ["Room"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents&take=300", tables: ["Resident", "Incident"] }
  );

  const rooms = useMemo<Room[]>(() => roomRows.map(adaptRoom), [roomRows]);
  const residents = useMemo<Resident[]>(() => residentRows.map(adaptResident), [residentRows]);

  const residentMap = useMemo(() => {
    const m = new Map<string, Resident[]>();
    residents.forEach((r) => {
      const key = r.room;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    });
    return m;
  }, [residents]);

  const totalBeds = useMemo(() => rooms.reduce((sum, r) => sum + r.capacity, 0), [rooms]);
  const occupiedBeds = residents.length;
  const availableBeds = totalBeds - occupiedBeds;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  const stats = useMemo(() => ({
    total: rooms.length,
    occupied: rooms.filter(r => r.status === "OCCUPIED").length,
    available: rooms.filter(r => r.status === "AVAILABLE").length,
    maintenance: rooms.filter(r => r.status === "MAINTENANCE").length,
    reserved: rooms.filter(r => r.status === "RESERVED").length,
  }), [rooms]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [wingFilter, setWingFilter] = useState<string>("all");
  const [floorFilter, setFloorFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(new Set());
  const [viewingRoom, setViewingRoom] = useState<Room | null>(null);

  const wings = useMemo(() => {
    const s = new Set(rooms.map(r => r.wing).filter(Boolean));
    return Array.from(s).sort() as string[];
  }, [rooms]);

  const floors = useMemo(() => {
    const s = new Set(rooms.map(r => String(r.floor ?? 1)));
    return Array.from(s).sort((a, b) => Number(a) - Number(b));
  }, [rooms]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms.filter(r => {
      if (q && !r.roomNumber.toLowerCase().includes(q) && !r.wing.toLowerCase().includes(q) && !r.features.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (wingFilter !== "all" && r.wing !== wingFilter) return false;
      if (floorFilter !== "all" && String(r.floor ?? 1) !== floorFilter) return false;
      if (typeFilter !== "all" && r.roomType !== typeFilter) return false;
      return true;
    });
  }, [rooms, search, statusFilter, wingFilter, floorFilter, typeFilter]);

  const roomsByFloor = useMemo(() => {
    const map = new Map<string, Room[]>();
    filtered.forEach(r => {
      const f = String(r.floor ?? 1);
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(r);
    });
    return Array.from(map.entries()).sort(([a], [b]) => Number(a) - Number(b));
  }, [filtered]);

  const wingData = useMemo(() => {
    const map = new Map<string, { total: number; occupied: number }>();
    rooms.forEach(r => {
      const w = r.wing || "Unassigned";
      const curr = map.get(w) || { total: 0, occupied: 0 };
      curr.total += r.capacity;
      map.set(w, curr);
    });
    residents.forEach(r => {
      const matched = rooms.find(rm => rm.roomNumber === r.room);
      const w = matched?.wing || "Unassigned";
      const curr = map.get(w) || { total: 0, occupied: 0 };
      curr.occupied += 1;
      map.set(w, curr);
    });
    return Array.from(map.entries()).map(([name, data]) => ({
      name, Occupied: data.occupied, Available: data.total - data.occupied,
    }));
  }, [rooms, residents]);

  const floorData = useMemo(() => {
    const map = new Map<number, { total: number; occupied: number }>();
    rooms.forEach(r => {
      const f = r.floor || 1;
      const curr = map.get(f) || { total: 0, occupied: 0 };
      curr.total += r.capacity;
      map.set(f, curr);
    });
    residents.forEach(r => {
      const matched = rooms.find(rm => rm.roomNumber === r.room);
      const f = matched?.floor || 1;
      const curr = map.get(f) || { total: 0, occupied: 0 };
      curr.occupied += 1;
      map.set(f, curr);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a - b).map(([name, data]) => ({
      name: `Floor ${name}`, Occupied: data.occupied, Vacant: data.total - data.occupied,
    }));
  }, [rooms, residents]);

  const careData = useMemo(() => {
    const order = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];
    return order.map(level => ({
      name: humanize(level), value: residents.filter(r => r.careLevel === level).length,
    })).filter(d => d.value > 0);
  }, [residents]);

  const quickStatus = async (room: Room, newStatus: string) => {
    const confirmed = await Swal.fire({
      title: `Change Room ${room.roomNumber} to ${humanize(newStatus)}?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: newStatus === "MAINTENANCE" ? "#f59e0b" : newStatus === "AVAILABLE" ? "#22c55e" : "#3b82f6",
      confirmButtonText: "Yes, change",
      cancelButtonText: "Cancel",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await updateRecord("rooms", room.id, { status: newStatus });
      await refetch();
      Swal.fire({ title: "Updated", text: `Room ${room.roomNumber} is now ${humanize(newStatus)}.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Error", text: err instanceof Error ? err.message : "Update failed.", icon: "error" });
    }
  };

  const toggleFloor = (floor: string) => {
    setExpandedFloors(prev => {
      const next = new Set(prev);
      next.has(floor) ? next.delete(floor) : next.add(floor);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Facility Occupancy
          </h1>
          <p className="text-gray-600">Real-time occupancy management &mdash; beds, rooms, wings, and floors</p>
        </div>
        <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Total Rooms" value={String(stats.total)} icon={Building2} color="blue" />
        <StatBox label="Occupied" value={String(stats.occupied)} icon={Users} color="green" />
        <StatBox label="Available" value={String(stats.available)} icon={DoorOpen} color="blue" />
        <StatBox label="Maintenance" value={String(stats.maintenance)} icon={Wrench} color="amber" />
        <StatBox label="Reserved" value={String(stats.reserved)} icon={Clock} color="purple" />
        <StatBox label="Occupancy Rate" value={`${occupancyRate}%`} icon={Activity} color="purple" />
      </div>

      {/* Bed Summary */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
          <BedDouble className="w-4 h-4 text-yellow-500" /> Bed Capacity Summary
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-gray-600">Total Beds: <strong className="text-gray-900">{totalBeds}</strong></span>
          <span className="text-gray-600">Occupied: <strong className="text-green-600">{occupiedBeds}</strong></span>
          <span className="text-gray-600">Available: <strong className="text-blue-600">{availableBeds}</strong></span>
          <span className="text-gray-600">Utilization: <strong className="text-purple-600">{occupancyRate}%</strong></span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search room, wing, feature…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Statuses</option>
          <option value="OCCUPIED">Occupied</option>
          <option value="AVAILABLE">Available</option>
          <option value="MAINTENANCE">Maintenance</option>
          <option value="RESERVED">Reserved</option>
        </select>
        <select value={wingFilter} onChange={e => setWingFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Wings</option>
          {wings.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={floorFilter} onChange={e => setFloorFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Floors</option>
          {floors.map(f => <option key={f} value={f}>Floor {f}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Types</option>
          <option value="PRIVATE">Private</option>
          <option value="SEMI_PRIVATE">Semi-Private</option>
          <option value="WARD">Ward</option>
          <option value="SUITE">Suite</option>
        </select>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button onClick={() => setViewMode("grid")}
            className={`px-3 py-2.5 text-sm flex items-center gap-1.5 transition ${viewMode === "grid" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <LayoutGrid className="w-4 h-4" /> Grid
          </button>
          <button onClick={() => setViewMode("table")}
            className={`px-3 py-2.5 text-sm flex items-center gap-1.5 transition ${viewMode === "table" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <Table2 className="w-4 h-4" /> Table
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && !roomRows.length ? (
        <div className="bg-white rounded-lg border border-gray-200 p-16 text-center text-gray-500">Loading occupancy data...</div>
      ) : rooms.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-16 text-center text-gray-500">No rooms found.</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-16 text-center text-gray-500">No rooms match your filters.</div>
      ) : viewMode === "grid" ? (
        /* ── Grid View ── */
        <div className="space-y-4">
          {roomsByFloor.map(([floor, floorRooms]) => {
            const expanded = expandedFloors.has(floor);
            const floorStats = {
              total: floorRooms.length,
              occupied: floorRooms.filter(r => r.status === "OCCUPIED").length,
              available: floorRooms.filter(r => r.status === "AVAILABLE").length,
              maintenance: floorRooms.filter(r => r.status === "MAINTENANCE").length,
            };
            return (
              <div key={floor} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <button onClick={() => toggleFloor(floor)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition border-b border-gray-200">
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    <span className="font-bold text-gray-900"><Hash className="w-3.5 h-3.5 inline" /> Floor {floor}</span>
                    <span className="text-xs text-gray-500">({floorRooms.length} rooms)</span>
                  </div>
                  <div className="flex gap-3 text-xs font-medium">
                    <span className="text-green-600">{floorStats.occupied} occupied</span>
                    <span className="text-blue-600">{floorStats.available} free</span>
                    {floorStats.maintenance > 0 && <span className="text-amber-600">{floorStats.maintenance} maintenance</span>}
                  </div>
                </button>
                {expanded && (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {floorRooms.map(room => (
                      <RoomCard
                        key={room.id}
                        room={room}
                        occupants={residentMap.get(room.roomNumber) || []}
                        onView={() => setViewingRoom(room)}
                        onStatusChange={(s) => quickStatus(room, s)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Table View ── */
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Room</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Floor</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Wing</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Capacity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Occupants</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(room => {
                const occs = residentMap.get(room.roomNumber) || [];
                const st = STATUS_STYLES[room.status] || STATUS_STYLES.AVAILABLE;
                return (
                  <tr key={room.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-semibold text-gray-900">{room.roomNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{room.floor ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{room.wing || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ROOM_TYPE_COLORS[room.roomType] || "text-gray-600 bg-gray-100"}`}>
                        {humanize(room.roomType)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${st.bg} ${st.text}`}>
                        <st.icon className="w-3 h-3" /> {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{room.capacity}</td>
                    <td className="px-4 py-3">
                      {occs.length > 0 ? (
                        <div className="text-sm text-gray-900">
                          {occs.map(o => <span key={o.id} className="block truncate max-w-[160px]">{o.name}</span>)}
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setViewingRoom(room)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                        <select value={room.status} onChange={e => quickStatus(room, e.target.value)}
                          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none">
                          <option value="OCCUPIED">Occupied</option>
                          <option value="AVAILABLE">Available</option>
                          <option value="MAINTENANCE">Maintenance</option>
                          <option value="RESERVED">Reserved</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Occupancy by Wing" icon={BedDouble}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={wingData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="occFill2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip />
              <Area type="monotone" dataKey="Occupied" stroke="#3b82f6" strokeWidth={2} fill="url(#occFill2)" />
              <Area type="monotone" dataKey="Available" stroke="#10b981" strokeWidth={2} fill="none" strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Floor Distribution" icon={Building2}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={floorData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              <Legend />
              <Bar dataKey="Occupied" fill="#3b82f6" radius={[4, 4, 0, 0]} stackId="a" />
              <Bar dataKey="Vacant" fill="#e5e7eb" radius={[4, 4, 0, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Care Level Distribution" icon={Users}>
          {careData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={careData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {careData.map((_, i) => <Cell key={i} fill={CARE_COLORS[i % CARE_COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No resident data.</p>}
        </Card>

        <Card title="Room Status Breakdown" icon={Building2}>
          {rooms.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={[
                  { name: "Occupied", value: stats.occupied },
                  { name: "Available", value: stats.available },
                  { name: "Maintenance", value: stats.maintenance },
                  { name: "Reserved", value: stats.reserved },
                ].filter(d => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  <Cell fill="#22c55e" />
                  <Cell fill="#3b82f6" />
                  <Cell fill="#f59e0b" />
                  <Cell fill="#a855f7" />
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No room data.</p>}
        </Card>
      </div>

      {/* View Room Modal */}
      {viewingRoom && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-400 to-blue-500 text-white p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Room {viewingRoom.roomNumber}</h2>
              <button onClick={() => setViewingRoom(null)} className="p-2 hover:bg-blue-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailField icon={MapPin} label="Floor" value={String(viewingRoom.floor ?? "—")} />
                <DetailField icon={Building2} label="Wing" value={viewingRoom.wing || "—"} />
                <DetailField icon={BedDouble} label="Type" value={humanize(viewingRoom.roomType)} />
                <DetailField icon={Hash} label="Status" value={humanize(viewingRoom.status)} />
                <DetailField icon={Users} label="Capacity" value={`${viewingRoom.capacity} bed${viewingRoom.capacity > 1 ? "s" : ""}`} />
                <DetailField icon={CreditCard} label="Rate" value={viewingRoom.rateMonthly ? `₱${viewingRoom.rateMonthly.toLocaleString()}/mo` : "—"} />
              </div>

              {viewingRoom.features && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Features</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewingRoom.features.split(",").map((f, i) => (
                      <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">{f.trim()}</span>
                    ))}
                  </div>
                </div>
              )}

              {(residentMap.get(viewingRoom.roomNumber) || []).length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Current Occupants</p>
                  <div className="space-y-1.5">
                    {(residentMap.get(viewingRoom.roomNumber) || []).map(o => (
                      <div key={o.id} className="flex items-center justify-between p-2 bg-green-50 rounded border border-green-200">
                        <span className="text-sm font-medium text-gray-900">{o.name}</span>
                        <span className="text-xs text-gray-600">{humanize(o.careLevel)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {viewingRoom.notes && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                  <p className="text-xs font-semibold text-yellow-700 mb-1">Notes</p>
                  <p className="text-sm text-gray-900">{viewingRoom.notes}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <select value={viewingRoom.status} onChange={e => { quickStatus(viewingRoom, e.target.value); setViewingRoom(null); }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                  <option value="OCCUPIED">Mark Occupied</option>
                  <option value="AVAILABLE">Mark Available</option>
                  <option value="MAINTENANCE">Mark Maintenance</option>
                  <option value="RESERVED">Mark Reserved</option>
                </select>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
              <button onClick={() => setViewingRoom(null)} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
    red: "text-red-600 bg-red-50 border-red-200",
  };
  const c = COLORS[color] || COLORS.blue;
  return (
    <div className={`rounded-lg border p-4 ${c}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-gray-600">{label}</p>
        <Icon className={`w-4 h-4 ${c.split(" ")[0]}`} />
      </div>
      <p className={`text-2xl font-bold ${c.split(" ")[0]}`}>{value}</p>
    </div>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-yellow-500" />
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function RoomCard({ room, occupants, onView, onStatusChange }: {
  room: Room;
  occupants: Resident[];
  onView: () => void;
  onStatusChange: (status: string) => void;
}) {
  const st = STATUS_STYLES[room.status] || STATUS_STYLES.AVAILABLE;
  const typeColor = ROOM_TYPE_COLORS[room.roomType] || "text-gray-600 bg-gray-100";
  return (
    <div className={`bg-white rounded-lg border-l-4 ${st.border} border border-gray-200 overflow-hidden hover:shadow-md transition group`}>
      <div className="p-3">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="font-bold text-gray-900 text-base">{room.roomNumber}</h4>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.bg} ${st.text}`}>
            <st.icon className="w-3 h-3" /> {st.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${typeColor}`}>{humanize(room.roomType)}</span>
          <span>Floor {room.floor ?? "—"}</span>
          <span>{room.wing || "—"}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
          <span><Users className="w-3 h-3 inline mr-0.5" /> Capacity: {room.capacity}</span>
          <span>{occupants.length} occupant{occupants.length !== 1 ? "s" : ""}</span>
        </div>
        {occupants.length > 0 && (
          <div className="mb-2">
            {occupants.map(o => (
              <span key={o.id} className="block text-xs text-gray-700 truncate">{o.name}</span>
            ))}
          </div>
        )}
        {room.features && (
          <div className="flex flex-wrap gap-1 mb-2">
            {room.features.split(",").slice(0, 3).map((f, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">{f.trim()}</span>
            ))}
            {room.features.split(",").length > 3 && <span className="text-[10px] text-gray-400">+{room.features.split(",").length - 3}</span>}
          </div>
        )}
        <div className="flex gap-1.5 mt-2">
          <button onClick={onView} className="flex-1 px-2 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition flex items-center justify-center gap-1">
            <Eye className="w-3 h-3" /> View
          </button>
          <select value={room.status} onChange={e => onStatusChange(e.target.value)}
            className="flex-1 px-1.5 py-1.5 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
            <option value="OCCUPIED">Occupied</option>
            <option value="AVAILABLE">Available</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="RESERVED">Reserved</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function DetailField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-gray-50 p-3 rounded border border-gray-200">
      <p className="text-xs text-gray-600 font-semibold flex items-center gap-1 mb-0.5">
        <Icon className="w-3 h-3" /> {label}
      </p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
