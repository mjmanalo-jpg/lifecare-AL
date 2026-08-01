# Facility portal: housekeeping maintenance analytics

**Session ID:** ses_05702c1c3ffePM565PlsB3woWd
**Created:** 7/28/2026, 9:49:56 PM
**Updated:** 7/28/2026, 11:25:34 PM

---

## User

now here in the facility portal, add dashboard analytics for housekeeping and maintenance analytics, all the completed tickets, type of tickets and such, same as housekeeping tickets should be seen in the facility admin portal dashboard 

---

## Assistant (Build · Big Pickle · 40.9s)

_Thinking:_

Let me understand the request: Add dashboard analytics for housekeeping and maintenance tickets to the facility admin portal dashboard. I need to see completed tickets, types of tickets, etc. Let me first explore the codebase to understand the current structure.

**Tool: task**

**Input:**
```json
{
  "description": "Explore facility admin portal",
  "prompt": "Research the facility admin portal dashboard and housekeeping/maintenance ticket system in this codebase. I need to understand:\n\n1. What does the facility admin dashboard currently show? Find the file at `apps/frontend/src/app/[role]/[tab]/page.tsx` or similar and trace how the facility_admin dashboard tab renders.\n2. What Prisma models exist for housekeeping and maintenance tickets? Check `apps/frontend/prisma/schema.prisma` for any models related to housekeeping, maintenance, tickets, work orders, etc.\n3. Are there existing housekeeping/maintenance components? Search for files with names containing \"housekeeping\", \"maintenance\", \"ticket\", \"workorder\" in `apps/frontend/src/components/`.\n4. What does the current facility admin dashboard component look like? Find the actual dashboard component used for the facility_admin role.\n5. Check `apps/frontend/src/constants/roleConfig.ts` for the facility_admin role config to understand tab routing.\n6. Check `apps/frontend/src/lib/models.ts` to see which models are registered.\n\nReturn all findings with exact file paths, line numbers, and relevant code snippets. Be very thorough.",
  "subagent_type": "explore"
}
```

**Output:**
```
<task id="ses_057026ab6ffeiUZvzcBNOPEHHy" state="completed">
<task_result>

</task_result>
</task>
```

---

## Assistant (Build · Big Pickle · 49.0s)

_Thinking:_

The task result was empty. Let me try reading the relevant files directly.

Let me read the key files directly to understand the current state.

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/*facility*"
}
```

**Output:**
```
No files found
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/*Facility*"
}
```

**Output:**
```
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityVitals.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityUnifiedView.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityRooms.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityResidents.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityReports.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityOccupancy.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityInventory.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityIncidents.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityDining.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityDashboard.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityBilling.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityAdminPortalContent.tsx
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/*dashboard*"
}
```

**Output:**
```
No files found
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/*Dashboard*"
}
```

**Output:**
```
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\SuperAdminDashboard.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityDashboard.tsx
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\NurseDashboard.tsx
```

---

## Assistant (Build · Big Pickle · 22.9s)

_Thinking:_

Let me read the FacilityDashboard.tsx and look for any housekeeping/maintenance models in the schema.

**Tool: read**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\components\\portal\\views\\FacilityDashboard.tsx"
}
```

**Output:**
```
<path>C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\FacilityDashboard.tsx</path>
<type>file</type>
<content>
1: "use client";
2: 
3: import { useMemo, useState, useEffect } from "react";
4: import {
5:   Users, AlertTriangle, Building2, UserPlus, RefreshCw, Sun, Sunset, Moon,
6:   Activity, BedDouble, ClipboardList, ChevronRight,
7:   type LucideIcon,
8: } from "lucide-react";
9: import {
10:   ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
11:   XAxis, YAxis, Tooltip, CartesianGrid, Legend,
12: } from "recharts";
13: import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
14: import { adaptResident, adaptIncident, adaptStaff, humanize } from "@/lib/adapters";
15: 
16: type Incident = ReturnType<typeof adaptIncident>;
17: type Staff = ReturnType<typeof adaptStaff>;
18: interface ResidentVM { id: string; name: string; room: string; careLevel: string; alertsCount: number }
19: 
20: const SEVERITY_BADGE: Record<string, string> = {
21:   critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
22:   medium: "bg-yellow-100 text-yellow-700", low: "bg-blue-100 text-blue-700",
23: };
24: const CARE_COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#ef4444"];
25: 
26: function shiftFor(hour: number) {
27:   if (hour >= 6 && hour < 14) return { label: "Day Shift", icon: Sun, greeting: "Good morning" };
28:   if (hour >= 14 && hour < 22) return { label: "Evening Shift", icon: Sunset, greeting: "Good afternoon" };
29:   return { label: "Night Shift", icon: Moon, greeting: "Good evening" };
30: }
31: 
32: function relTime(iso: string | null, nowTs: number): string {
33:   if (!iso) return "—";
34:   const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
35:   if (m < 1) return "just now";
36:   if (m < 60) return `${m}m ago`;
37:   const h = Math.round(m / 60);
38:   if (h < 24) return `${h}h ago`;
39:   return `${Math.round(h / 24)}d ago`;
40: }
41: 
42: export default function FacilityDashboard() {
43:   const { stats, refetch: refetchStats } = useStats();
44:   const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
45:     "residents", { query: "include=incidents&take=300", tables: ["Resident", "Incident"] }
46:   );
47:   const { data: incidentRows, refetch: refetchIncidents } = useLiveQuery<Record<string, unknown>>(
48:     "incidents", { query: "include=resident&take=300", tables: ["Incident"] }
49:   );
50:   const { data: staffRows } = useLiveQuery<Record<string, unknown>>(
51:     "staff", { query: "include=user&take=300", tables: ["Staff", "User"] }
52:   );
53:   const { data: admissionRows } = useLiveQuery<Record<string, unknown>>(
54:     "admissions", { query: "take=100", tables: ["Admission"] }
55:   );
56: 
57:   const [nowTs, setNowTs] = useState(0);
58:   useEffect(() => {
59:     const tick = () => setNowTs(Date.now());
60:     tick();
61:     const t = setInterval(tick, 60_000);
62:     return () => clearInterval(t);
63:   }, []);
64: 
65:   const residents = useMemo<ResidentVM[]>(
66:     () => residentRows.map((row) => {
67:       const r = adaptResident(row);
68:       return { id: r.id, name: r.name, room: r.room, careLevel: r.careLevel, alertsCount: r.alertsCount };
69:     }),
70:     [residentRows]
71:   );
72:   const incidents = useMemo<Incident[]>(() => incidentRows.map(adaptIncident), [incidentRows]);
73:   const staff = useMemo<Staff[]>(() => staffRows.map(adaptStaff), [staffRows]);
74: 
75:   const admissions = useMemo(() => {
76:     const rows = admissionRows as Array<Record<string, unknown>>;
77:     return {
78:       total: rows.length,
79:       pending: rows.filter((a) => a.status === "PENDING" || a.status === "REVIEWING").length,
80:       approved: rows.filter((a) => a.status === "APPROVED").length,
81:       completed: rows.filter((a) => a.status === "COMPLETED" || a.status === "PLACED").length,
82:     };
83:   }, [admissionRows]);
84: 
85:   const openIncidents = useMemo(() => incidents.filter((i) => !i.resolved), [incidents]);
86:   const criticalIncidents = useMemo(() => openIncidents.filter((i) => i.severity === "critical" || i.severity === "high"), [openIncidents]);
87:   const activeStaff = useMemo(() => staff.filter((s) => s.active === "Active"), [staff]);
88: 
89:   const deptData = useMemo(() => {
90:     const map = new Map<string, number>();
91:     staff.forEach((s) => { map.set(s.department, (map.get(s.department) || 0) + 1); });
92:     return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
93:   }, [staff]);
94: 
95:   const careData = useMemo(() => {
96:     const order = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];
97:     return order.map((level) => ({
98:       name: humanize(level),
99:       value: residents.filter((r) => r.careLevel === level).length,
100:     })).filter((d) => d.value > 0);
101:   }, [residents]);
102: 
103:   const recentAdmissions = useMemo(() => {
104:     const rows = admissionRows as Array<Record<string, unknown>>;
105:     return rows.sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime()).slice(0, 5);
106:   }, [admissionRows]);
107: 
108:   const shift = shiftFor(nowTs ? new Date(nowTs).getHours() : 9);
109:   const ShiftIcon = shift.icon;
110: 
111:   const refreshAll = () => { void refetchStats(); void refetchIncidents(); };
112: 
113:   return (
114:     <div className="space-y-6">
115:       <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
116:         <div>
117:           <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
118:             <ShiftIcon className="w-6 h-6 text-yellow-500 flex-shrink-0" />
119:             <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{shift.greeting} — Facility Dashboard</span>
120:           </h1>
121:           <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
122:             <span className="inline-flex items-center gap-1 text-green-600">
123:               <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
124:             </span>
125:             {shift.label} • {nowTs ? new Date(nowTs).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "—"}
126:           </p>
127:         </div>
128:         <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start">
129:           <RefreshCw className="w-4 h-4" /> Refresh
130:         </button>
131:       </div>
132: 
133:       <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
134:         <Stat label="Total Residents" value={String(stats?.residents ?? residents.length)} icon={Users} tone="blue" />
135:         <Stat label="Beds Occupancy" value={residents.length ? `${Math.round((residents.length / Math.max(residents.length + 5, 35)) * 100)}%` : "0%"} icon={BedDouble} tone="green" />
136:         <Stat label="Staff On Duty" value={String(activeStaff.length)} icon={Building2} tone="amber" />
137:         <Stat label="Open Incidents" value={String(openIncidents.length)} icon={AlertTriangle} tone="red" />
138:         <Stat label="Pending Admissions" value={String(admissions.pending)} icon={UserPlus} tone="purple" />
139:       </div>
140: 
141:       <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
142:         <Card title="Occupancy Trend" icon={Activity} className="lg:col-span-2">
143:           <ResponsiveContainer width="100%" height={240}>
144:             <AreaChart data={[
145:               { name: "Week 1", Residents: residents.length - 4 },
146:               { name: "Week 2", Residents: residents.length - 2 },
147:               { name: "Week 3", Residents: residents.length - 1 },
148:               { name: "Week 4", Residents: residents.length },
149:             ]} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
150:               <defs>
151:                 <linearGradient id="occFill" x1="0" y1="0" x2="0" y2="1">
152:                   <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
153:                   <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
154:                 </linearGradient>
155:               </defs>
156:               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
157:               <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
158:               <YAxis fontSize={12} tickLine={false} axisLine={false} width={28} />
159:               <Tooltip />
160:               <Area type="monotone" dataKey="Residents" stroke="#3b82f6" strokeWidth={2} fill="url(#occFill)" />
161:             </AreaChart>
162:           </ResponsiveContainer>
163:         </Card>
164: 
165:         <Card title="Care Level Distribution" icon={Users}>
166:           {careData.length > 0 ? (
167:             <ResponsiveContainer width="100%" height={240}>
168:               <PieChart>
169:                 <Pie data={careData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
170:                   {careData.map((_, i) => <Cell key={i} fill={CARE_COLORS[i % CARE_COLORS.length]} />)}
171:                 </Pie>
172:                 <Tooltip /><Legend />
173:               </PieChart>
174:             </ResponsiveContainer>
175:           ) : <Empty text="No resident data." />}
176:         </Card>
177:       </div>
178: 
179:       <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
180:         <Card title="Staff by Department" icon={Building2} className="lg:col-span-2">
181:           {deptData.length > 0 ? (
182:             <ResponsiveContainer width="100%" height={240}>
183:               <BarChart data={deptData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
184:                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
185:                 <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
186:                 <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
187:                 <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
188:                 <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
189:               </BarChart>
190:             </ResponsiveContainer>
191:           ) : <Empty text="No staff data." />}
192:         </Card>
193: 
194:         <Card title="Admissions Pipeline" icon={UserPlus}>
195:           <ResponsiveContainer width="100%" height={240}>
196:             <BarChart data={[
197:               { name: "Pending", count: admissions.pending },
198:               { name: "Approved", count: admissions.approved },
199:               { name: "Completed", count: admissions.completed },
200:             ]} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
201:               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
202:               <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
203:               <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
204:               <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
205:               <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
206:             </BarChart>
207:           </ResponsiveContainer>
208:         </Card>
209:       </div>
210: 
211:       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
212:         <Card title="Critical Incidents" icon={AlertTriangle} count={criticalIncidents.length}>
213:           {criticalIncidents.length > 0 ? (
214:             <div className="space-y-2">
215:               {criticalIncidents.slice(0, 6).map((i) => (
216:                 <div key={i.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-red-100 bg-red-50/60">
217:                   <div className="min-w-0">
218:                     <span className="font-semibold text-gray-900 text-sm">{i.type}</span>
219:                     <p className="text-xs text-gray-600 truncate">{i.resident} • Room {i.room} • {relTime(String(i.timestamp), nowTs)}</p>
220:                   </div>
221:                   <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${SEVERITY_BADGE[i.severity]}`}>{i.severity.toUpperCase()}</span>
222:                 </div>
223:               ))}
224:             </div>
225:           ) : <Empty text="No critical or high-severity incidents open." />}
226:         </Card>
227: 
228:         <Card title="Recent Admissions" icon={UserPlus} count={recentAdmissions.length}>
229:           {recentAdmissions.length > 0 ? (
230:             <div className="space-y-2">
231:               {recentAdmissions.map((a, idx) => {
232:                 const status = String(a.status ?? "UNKNOWN");
233:                 const name = a.residentName ? String(a.residentName) : `Admission #${a.id}`;
234:                 return (
235:                   <div key={idx} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-purple-50 border border-purple-100">
236:                     <div className="min-w-0">
237:                       <p className="font-medium text-gray-900 text-sm truncate">{name}</p>
238:                       <p className="text-xs text-gray-600">{status} • {relTime(a.createdAt ? String(a.createdAt) : null, nowTs)}</p>
239:                     </div>
240:                     <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-200 text-purple-800 flex-shrink-0">{status}</span>
241:                   </div>
242:                 );
243:               })}
244:             </div>
245:           ) : <Empty text="No recent admissions." />}
246:         </Card>
247:       </div>
248: 
249:       <div className="bg-white rounded-lg border border-gray-200 p-4">
250:         <div className="flex items-center justify-between mb-3">
251:           <h3 className="font-semibold text-gray-900 flex items-center gap-2">
252:             <ClipboardList className="w-4 h-4 text-yellow-500" /> Staff Availability
253:           </h3>
254:           <span className="text-sm font-bold text-gray-700">{activeStaff.length} / {staff.length} active</span>
255:         </div>
256:         <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
257:           <div className="h-full bg-gradient-to-r from-green-400 to-green-500 transition-all duration-500" style={{ width: `${staff.length ? Math.round((activeStaff.length / staff.length) * 100) : 0}%` }} />
258:         </div>
259:       </div>
260:     </div>
261:   );
262: }
263: 
264: const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
265:   blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
266:   amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
267:   red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
268:   purple: { wrap: "bg-purple-50 border-purple-200", icon: "text-purple-500", value: "text-purple-600" },
269:   green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
270:   rose: { wrap: "bg-rose-50 border-rose-200", icon: "text-rose-500", value: "text-rose-600" },
271: };
272: 
273: function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: LucideIcon; tone: keyof typeof TONES }) {
274:   const t = TONES[tone];
275:   return (
276:     <div className={`p-4 rounded-lg border ${t.wrap}`}>
277:       <div className="flex items-center justify-between">
278:         <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
279:         <Icon className={`w-4 h-4 ${t.icon}`} />
280:       </div>
281:       <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
282:     </div>
283:   );
284: }
285: 
286: function Card({ title, icon: Icon, count, className, children }: { title: string; icon: LucideIcon; count?: number; className?: string; children: React.ReactNode }) {
287:   return (
288:     <div className={`bg-white rounded-lg border border-gray-200 p-4 ${className ?? ""}`}>
289:       <div className="flex items-center justify-between mb-3">
290:         <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Icon className="w-4 h-4 text-yellow-500" /> {title}</h3>
291:         {typeof count === "number" && <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs font-bold">{count}</span>}
292:       </div>
293:       {children}
294:     </div>
295:   );
296: }
297: 
298: function Empty({ text }: { text: string }) {
299:   return <p className="text-sm text-gray-500 py-6 text-center flex items-center justify-center gap-1"><ChevronRight className="w-4 h-4 opacity-0" />{text}</p>;
300: }

(End of file - total 300 lines)
</content>

<system-reminder>
Instructions from: C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\AGENTS.md
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

</system-reminder>
```

**Tool: grep**

**Input:**
```json
{
  "pattern": "housekeeping|maintenance|ticket|work.?order|HousekeepingTicket|MaintenanceTicket",
  "include": "*.prisma"
}
```

**Output:**
```
Found 12 matches
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\prisma\schema.prisma:
  Line 1204:   // PMS housekeeping lifecycle (mobile staff tools): make ready → inspection →

  Line 1206:   housekeepingStatus UnitStatus @default(READY)

  Line 1225:   @@index([housekeepingStatus])

  Line 2804: // → billable ServiceCharge. Plus the maintenance & compliance loop (odometer,

  Line 2805: // fuel, insurance/registration alerts, preventive schedule, work orders).

  Line 2900:   maintenanceOrders VehicleMaintenance[]

  Line 3185: // front desk) → ticket with Routine/Urgent/Emergency priority → auto-assigned

  Line 3186: // team (housekeeping / maintenance / kitchen / IT) → work order in progress →

  Line 3189: // Plus the preventive facility maintenance calendar (HVAC / generator /

  Line 3276:   assignedTo    String?                // staff member name working the ticket

  Line 3301: // Preventive facility maintenance calendar. Completing a PREVENTIVE entry

  Line 3384:   DEEP_CLEAN   // deep clean & maintenance

```

**Tool: grep**

**Input:**
```json
{
  "pattern": "housekeeping|maintenance|ticket|work.?order",
  "include": "*.ts",
  "path": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\lib"
}
```

**Output:**
```
Found 5 matches
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\lib\demoData.ts:
  Line 419:   "vehicle-maintenance": vehicleMaintenance,

  Line 425:   "facility-maintenance": facilityMaintenance,


C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\lib\models.ts:
  Line 48:   "vehicle-maintenance": { delegate: prisma.vehicleMaintenance, table: "VehicleMaintenance", orderBy: { scheduledDate: "desc" } },

  Line 57:   "facility-maintenance": { delegate: prisma.facilityMaintenance, table: "FacilityMaintenance", orderBy: { scheduledDate: "asc" } },


C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\lib\scope.ts:
  Line 35:   // Phase 7 — hotel-style services: family/resident follow their own tickets & bookings.

```

---

## Assistant (Build · Big Pickle · 227.8s)

_Thinking:_

Let me look at the Prisma schema for the ticket-related models and the facility maintenance models.

**Tool: grep**

**Input:**
```json
{
  "include": "*.prisma",
  "pattern": "model (FacilityMaintenance|ServiceTicket|Housekeeping)"
}
```

**Output:**
```
Found 1 matches
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\prisma\schema.prisma:
  Line 3303: model FacilityMaintenance {

```

**Tool: grep**

**Input:**
```json
{
  "include": "*.ts",
  "pattern": "service.?ticket|ServiceTicket",
  "path": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src"
}
```

**Output:**
```
No files found
```

---

## Assistant (Build · Big Pickle · 312.4s)

_Thinking:_

Let me look at the Prisma schema around the ServiceTicket and FacilityMaintenance models, and also look for any existing housekeeping/maintenance components.

**Tool: read**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\prisma\\schema.prisma",
  "offset": 3180,
  "limit": 200
}
```

**Output:**
```
<path>C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\prisma\schema.prisma</path>
<type>file</type>
<content>
3180: 
3181: // ============================================================================
3182: // PHASE 7 (CONT.) — HOTEL-STYLE RESIDENT SERVICES & MAINTENANCE
3183: // ============================================================================
3184: // Resident service workflow: request (portal / AI companion / call bell /
3185: // front desk) → ticket with Routine/Urgent/Emergency priority → auto-assigned
3186: // team (housekeeping / maintenance / kitchen / IT) → work order in progress →
3187: // completed with photo proof → resident confirmation + 1-5★ rating → billable
3188: // charge posted to the invoice pipeline → service analytics.
3189: // Plus the preventive facility maintenance calendar (HVAC / generator /
3190: // elevator / fire & safety / pest control) and concierge "hotel on the
3191: // hospital" premium bookings.
3192: 
3193: enum ServiceRequestCategory {
3194:   AIRCON_HVAC   // temp adjust · filter · repair
3195:   HOUSEKEEPING  // room clean · linen change
3196:   ROOM_SERVICE  // meals · snacks · beverages
3197:   LAUNDRY       // laundry & pressing
3198:   REPAIRS       // plumbing · electrical · wifi/tv
3199: }
3200: 
3201: enum ServiceRequestPriority {
3202:   ROUTINE
3203:   URGENT
3204:   EMERGENCY
3205: }
3206: 
3207: enum ServiceRequestStatus {
3208:   OPEN
3209:   ASSIGNED
3210:   IN_PROGRESS
3211:   COMPLETED  // work done — awaiting resident confirmation & rating
3212:   CONFIRMED  // resident confirmed + rated
3213:   CANCELLED
3214: }
3215: 
3216: enum ServiceTeam {
3217:   HOUSEKEEPING_TEAM
3218:   MAINTENANCE_ENGINEER
3219:   KITCHEN
3220:   IT_SUPPORT
3221:   CONCIERGE
3222: }
3223: 
3224: enum FacilitySystem {
3225:   HVAC          // quarterly service
3226:   GENERATOR     // monthly test
3227:   ELEVATOR      // inspection
3228:   FIRE_SAFETY   // fire & safety systems
3229:   PEST_CONTROL
3230:   OTHER
3231: }
3232: 
3233: enum MaintenanceFrequency {
3234:   WEEKLY
3235:   MONTHLY
3236:   QUARTERLY
3237:   SEMI_ANNUAL
3238:   ANNUAL
3239: }
3240: 
3241: enum ConciergeCategory {
3242:   CONCIERGE_DESK
3243:   WAKE_UP_CALL
3244:   TURNDOWN
3245:   SALON_BARBER
3246:   CAFE_BISTRO
3247:   MOVIE_GAME_NIGHT
3248:   GARDEN_LOUNGE
3249:   GUEST_SUITE
3250:   SPA_MASSAGE
3251:   CHAPLAIN
3252: }
3253: 
3254: enum ConciergeBookingStatus {
3255:   REQUESTED
3256:   CONFIRMED
3257:   IN_PROGRESS
3258:   COMPLETED
3259:   CANCELLED
3260: }
3261: 
3262: model ServiceRequest {
3263:   id            String                 @id @default(uuid())
3264:   organizationId String?
3265:   communityId    String?
3266:   residentId    String
3267:   resident      Resident               @relation(fields: [residentId], references: [id], onDelete: Cascade)
3268:   roomNumber    String?
3269:   category      ServiceRequestCategory @default(HOUSEKEEPING)
3270:   subType       String?                // e.g. "Temp Adjust", "Linen Change", "Wi-Fi/TV"
3271:   details       String?                @db.Text
3272:   source        String                 @default("RESIDENT_PORTAL") // RESIDENT_PORTAL | AI_COMPANION | CALL_BELL | FRONT_DESK
3273:   priority      ServiceRequestPriority @default(ROUTINE)
3274:   status        ServiceRequestStatus   @default(OPEN)
3275:   assignedTeam  ServiceTeam?
3276:   assignedTo    String?                // staff member name working the ticket
3277:   photoProofUrl String?                // completion photo proof
3278:   startedAt     DateTime?
3279:   completedAt   DateTime?
3280:   confirmedAt   DateTime?
3281:   rating        Int?                   // resident satisfaction 1–5 ★
3282:   ratingComment String?
3283:   billable      Boolean                @default(false)
3284:   charge        Float?
3285:   billed        Boolean                @default(false) // ServiceCharge posted to invoice pipeline
3286:   notes         String?
3287:   createdAt     DateTime               @default(now())
3288:   updatedAt     DateTime               @updatedAt
3289: 
3290:   @@index([residentId])
3291:   @@index([status])
3292:   @@index([category])
3293:   @@index([priority])
3294:   @@index([assignedTeam])
3295:   @@index([createdAt])
3296: 
3297:   @@index([organizationId])
3298:   @@index([communityId])
3299: }
3300: 
3301: // Preventive facility maintenance calendar. Completing a PREVENTIVE entry
3302: // auto-schedules the next occurrence from `frequency`.
3303: model FacilityMaintenance {
3304:   id            String               @id @default(uuid())
3305:   organizationId String?
3306:   communityId    String?
3307:   title         String
3308:   system        FacilitySystem       @default(OTHER)
3309:   type          MaintenanceType      @default(PREVENTIVE)
3310:   status        MaintenanceStatus    @default(SCHEDULED)
3311:   frequency     MaintenanceFrequency @default(QUARTERLY)
3312:   location      String?              // wing / floor / room / plant area
3313:   description   String?              @db.Text
3314:   scheduledDate DateTime?
3315:   completedDate DateTime?
3316:   nextDueDate   DateTime?
3317:   assignedTo    String?
3318:   vendor        String?
3319:   cost          Float?
3320:   notes         String?
3321:   createdAt     DateTime             @default(now())
3322:   updatedAt     DateTime             @updatedAt
3323: 
3324:   @@index([system])
3325:   @@index([status])
3326:   @@index([scheduledDate])
3327:   @@index([nextDueDate])
3328: 
3329:   @@index([organizationId])
3330:   @@index([communityId])
3331: }
3332: 
3333: model ConciergeBooking {
3334:   id          String                 @id @default(uuid())
3335:   organizationId String?
3336:   communityId    String?
3337:   residentId  String
3338:   resident    Resident               @relation(fields: [residentId], references: [id], onDelete: Cascade)
3339:   category    ConciergeCategory      @default(CONCIERGE_DESK)
3340:   serviceName String                 // e.g. "Salon & Barber", "Guest Suite for Family Stay"
3341:   scheduledAt DateTime
3342:   status      ConciergeBookingStatus @default(REQUESTED)
3343:   staffName   String?
3344:   location    String?
3345:   price       Float?
3346:   billable    Boolean                @default(true)
3347:   billed      Boolean                @default(false)
3348:   rating      Int?                   // 1–5 ★ after completion
3349:   notes       String?
3350:   createdAt   DateTime               @default(now())
3351:   updatedAt   DateTime               @updatedAt
3352: 
3353:   @@index([residentId])
3354:   @@index([status])
3355:   @@index([category])
3356:   @@index([scheduledAt])
3357: 
3358:   @@index([organizationId])
3359:   @@index([communityId])
3360: }
3361: 
3362: // ============================================================================
3363: // PHASE 7 — HOSPITALITY & PROPERTY MANAGEMENT SYSTEM (PMS)
3364: // ============================================================================
3365: // Central hub of hospitality operations across four sub-domains + KPI analytics:
3366: //   1. Front Desk & Guest Management — arrival → check-in (ID & visitor pass) →
3367: //      inquiries/requests → ancillary payments (dining/salon) → check-out & receipt
3368: //   2. Apartment/Room Status Lifecycle (mobile staff tools) — make ready →
3369: //      inspection passed → occupied → turnover → move-out/transfer → deep clean ↺
3370: //   3. Resident & Family Engagement — preference profiles · event attendance ·
3371: //      dining reservations · automated announcements · community calendar
3372: //   4. Reporting & Analytics KPIs — occupancy rate · unit turnover time ·
3373: //      resident satisfaction · service SLA compliance · ancillary revenue
3374: // KPIs are computed live from these models + Room/ServiceRequest/ServiceCharge;
3375: // no aggregate table is stored so the dashboard is always real-time.
3376: 
3377: enum UnitStatus {
3378:   MAKE_READY   // being prepared for next resident
3379:   INSPECTION   // awaiting inspection sign-off

(Showing lines 3180-3379 of 4158. Use offset=3380 to continue.)
</content>
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/*ousekeep*"
}
```

**Output:**
```
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\HousekeepingPortalContent.tsx
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/*aintenance*"
}
```

**Output:**
```
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\MaintenancePortalContent.tsx
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/*Ticket*"
}
```

**Output:**
```
No files found
```

---

## Assistant (Build · Big Pickle · 145.1s)

_Thinking:_

Let me read the HousekeepingPortalContent and MaintenancePortalContent to understand what data they show. Also let me check what models are registered.

**Tool: read**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\components\\portal\\views\\HousekeepingPortalContent.tsx"
}
```

**Output:**
```
<path>C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\HousekeepingPortalContent.tsx</path>
<type>file</type>
<content>
1: "use client";
2: 
3: import ServiceRequestsBoard from "@/components/portal/views/services/ServiceRequestsBoard";
4: import UnitTurnoverBoard from "@/components/portal/views/pms/UnitTurnoverBoard";
5: 
6: /**
7:  * Housekeeping portal — the cleaning/linen crew's home. Resident requests are
8:  * already categorized (HOUSEKEEPING / LAUNDRY) and team-routed, so this portal
9:  * just scopes the shared boards to housekeeping work.
10:  *   - default: housekeeping, laundry & room-service request queue
11:  *   - turnover: room make-ready → occupied lifecycle
12:  */
13: export default function HousekeepingPortalContent({ tab }: { tab?: string }) {
14:   if (tab === "turnover") return <UnitTurnoverBoard />;
15:   return <ServiceRequestsBoard categories={["HOUSEKEEPING", "LAUNDRY", "ROOM_SERVICE"]} />;
16: }

(End of file - total 16 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\components\\portal\\views\\MaintenancePortalContent.tsx"
}
```

**Output:**
```
<path>C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\MaintenancePortalContent.tsx</path>
<type>file</type>
<content>
1: "use client";
2: 
3: import ServiceRequestsBoard from "@/components/portal/views/services/ServiceRequestsBoard";
4: import FacilityMaintenanceBoard from "@/components/portal/views/services/FacilityMaintenanceBoard";
5: 
6: /**
7:  * Maintenance portal — the repairs/engineering crew's home.
8:  *   - default: resident repair & HVAC ticket queue (REPAIRS / AIRCON_HVAC).
9:  *     This is also the apartment-level work-order view the PMS spec was missing.
10:  *   - maintenance: preventative facility-system schedules (HVAC, generator, …).
11:  */
12: export default function MaintenancePortalContent({ tab }: { tab?: string }) {
13:   if (tab === "maintenance") return <FacilityMaintenanceBoard />;
14:   return <ServiceRequestsBoard categories={["REPAIRS", "AIRCON_HVAC"]} />;
15: }

(End of file - total 15 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\lib\\models.ts"
}
```

**Output:**
```
<path>C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\lib\models.ts</path>
<type>file</type>
<content>
1: import { prisma } from "./prisma";
2: 
3: /**
4:  * Whitelist of data models exposed through /api/db/[model].
5:  * `key`      → URL segment used by the frontend (kebab-case).
6:  * `delegate` → the Prisma model accessor.
7:  * `table`    → the Postgres table name (PascalCase) for Supabase realtime.
8:  * `orderBy`  → default sort for list queries.
9:  */
10: export interface ModelDef {
11:   // Prisma delegates share no common public type; `any` is intentional here.
12:   // eslint-disable-next-line @typescript-eslint/no-explicit-any
13:   delegate: any;
14:   table: string;
15:   // eslint-disable-next-line @typescript-eslint/no-explicit-any
16:   orderBy?: Record<string, any>;
17: }
18: 
19: export const MODELS: Record<string, ModelDef> = {
20:   users: { delegate: prisma.user, table: "User", orderBy: { createdAt: "desc" } },
21:   residents: { delegate: prisma.resident, table: "Resident", orderBy: { createdAt: "desc" } },
22:   staff: { delegate: prisma.staff, table: "Staff", orderBy: { createdAt: "desc" } },
23:   vitals: { delegate: prisma.vitalsLog, table: "VitalsLog", orderBy: { recordedAt: "desc" } },
24:   incidents: { delegate: prisma.incident, table: "Incident", orderBy: { incidentDate: "desc" } },
25:   medications: { delegate: prisma.medication, table: "Medication", orderBy: { startDate: "desc" } },
26:   tasks: { delegate: prisma.task, table: "Task", orderBy: { dueDate: "asc" } },
27:   messages: { delegate: prisma.message, table: "Message", orderBy: { createdAt: "desc" } },
28:   "shift-reports": { delegate: prisma.shiftReport, table: "ShiftReport", orderBy: { date: "desc" } },
29:   notifications: { delegate: prisma.notification, table: "Notification", orderBy: { createdAt: "desc" } },
30:   visits: { delegate: prisma.visit, table: "Visit", orderBy: { checkInTime: "desc" } },
31:   invoices: { delegate: prisma.invoice, table: "Invoice", orderBy: { dueDate: "desc" } },
32:   "resident-notes": { delegate: prisma.residentNote, table: "ResidentNote", orderBy: { createdAt: "desc" } },
33:   "medical-notes": { delegate: prisma.medicalNote, table: "MedicalNote", orderBy: { createdAt: "desc" } },
34:   "call-bells": { delegate: prisma.callBell, table: "CallBell", orderBy: { createdAt: "desc" } },
35:   "time-tracking": { delegate: prisma.timeTracking, table: "TimeTracking", orderBy: { startTime: "desc" } },
36:   "knowledge-docs": { delegate: prisma.knowledgeDoc, table: "KnowledgeDoc", orderBy: { createdAt: "desc" } },
37:   "app-settings": { delegate: prisma.appSetting, table: "AppSetting", orderBy: { id: "asc" } },
38:   admissions: { delegate: prisma.admission, table: "Admission", orderBy: { createdAt: "desc" } },
39:   rooms: { delegate: prisma.room, table: "Room", orderBy: { roomNumber: "asc" } },
40:   inventory: { delegate: prisma.inventoryItem, table: "InventoryItem", orderBy: { itemName: "asc" } },
41:   "service-charges": { delegate: prisma.serviceCharge, table: "ServiceCharge", orderBy: { serviceDate: "desc" } },
42:   "insurance-validations": { delegate: prisma.insuranceValidation, table: "InsuranceValidation", orderBy: { createdAt: "desc" } },
43:   payments: { delegate: prisma.payment, table: "Payment", orderBy: { paymentDate: "desc" } },
44:   vehicles: { delegate: prisma.vehicle, table: "Vehicle", orderBy: { name: "asc" } },
45:   drivers: { delegate: prisma.driver, table: "Driver", orderBy: { name: "asc" } },
46:   "transport-requests": { delegate: prisma.transportRequest, table: "TransportRequest", orderBy: { requestedDate: "desc" } },
47:   trips: { delegate: prisma.trip, table: "Trip", orderBy: { scheduledAt: "desc" } },
48:   "vehicle-maintenance": { delegate: prisma.vehicleMaintenance, table: "VehicleMaintenance", orderBy: { scheduledDate: "desc" } },
49:   "fuel-logs": { delegate: prisma.fuelLog, table: "FuelLog", orderBy: { logDate: "desc" } },
50:   "blog-posts": { delegate: prisma.blogPost, table: "BlogPost", orderBy: { publishedAt: "desc" } },
51:   "site-content": { delegate: prisma.siteContent, table: "SiteContent", orderBy: { id: "asc" } },
52:   "custom-pages": { delegate: prisma.customPage, table: "CustomPage", orderBy: { sortOrder: "asc" } },
53:   "resident-goals": { delegate: prisma.residentGoal, table: "ResidentGoal", orderBy: { createdAt: "desc" } },
54:   "medication-logs": { delegate: prisma.medicationLog, table: "MedicationLog", orderBy: { takenAt: "desc" } },
55:   "daily-menus": { delegate: prisma.dailyMenu, table: "DailyMenu", orderBy: { menuDate: "desc" } },
56:   "service-requests": { delegate: prisma.serviceRequest, table: "ServiceRequest", orderBy: { createdAt: "desc" } },
57:   "facility-maintenance": { delegate: prisma.facilityMaintenance, table: "FacilityMaintenance", orderBy: { scheduledDate: "asc" } },
58:   "concierge-bookings": { delegate: prisma.conciergeBooking, table: "ConciergeBooking", orderBy: { scheduledAt: "desc" } },
59:   "front-desk-visits": { delegate: prisma.frontDeskVisit, table: "FrontDeskVisit", orderBy: { arrivalTime: "desc" } },
60:   "room-turnovers": { delegate: prisma.roomTurnover, table: "RoomTurnover", orderBy: { startedAt: "desc" } },
61:   "resident-preferences": { delegate: prisma.residentPreference, table: "ResidentPreference", orderBy: { category: "asc" } },
62:   "community-events": { delegate: prisma.communityEvent, table: "CommunityEvent", orderBy: { startTime: "asc" } },
63:   "event-attendances": { delegate: prisma.eventAttendance, table: "EventAttendance", orderBy: { createdAt: "desc" } },
64:   "dining-reservations": { delegate: prisma.diningReservation, table: "DiningReservation", orderBy: { reservedAt: "desc" } },
65:   announcements: { delegate: prisma.announcement, table: "Announcement", orderBy: { publishedAt: "desc" } },
66:   escalations: { delegate: prisma.escalation, table: "Escalation", orderBy: { createdAt: "desc" } },
67:   "dietitian-consults": { delegate: prisma.dietitianConsult, table: "DietitianConsult", orderBy: { consultDate: "desc" } },
68:   "food-compliance-logs": { delegate: prisma.foodComplianceLog, table: "FoodComplianceLog", orderBy: { auditDate: "desc" } },
69:   "camera-monitoring-logs": { delegate: prisma.cameraMonitoringLog, table: "CameraMonitoringLog", orderBy: { createdAt: "desc" } },
70:   "security-logs": { delegate: prisma.securityLog, table: "SecurityLog", orderBy: { occurredAt: "desc" } },
71:   "diet-orders": { delegate: prisma.dietOrder, table: "DietOrder", orderBy: { createdAt: "desc" } },
72: 
73:   // V2.1 — Multi-tenant hierarchy
74:   organizations: { delegate: prisma.organization, table: "Organization", orderBy: { name: "asc" } },
75:   communities: { delegate: prisma.community, table: "Community", orderBy: { name: "asc" } },
76:   buildings: { delegate: prisma.building, table: "Building", orderBy: { name: "asc" } },
77:   floors: { delegate: prisma.floor, table: "Floor", orderBy: { floorNumber: "asc" } },
78:   units: { delegate: prisma.unit, table: "Unit", orderBy: { name: "asc" } },
79: 
80:   // V2.1 — Assessment & acuity engine
81:   assessments: { delegate: prisma.assessment, table: "Assessment", orderBy: { createdAt: "desc" } },
82:   "acuity-scores": { delegate: prisma.acuityScore, table: "AcuityScore", orderBy: { scoredAt: "desc" } },
83: 
84:   // V2.1 — Service catalog & care packages
85:   "service-catalogs": { delegate: prisma.serviceCatalog, table: "ServiceCatalog", orderBy: { sortOrder: "asc" } },
86:   "care-packages": { delegate: prisma.carePackage, table: "CarePackage", orderBy: { name: "asc" } },
87:   "care-package-items": { delegate: prisma.carePackageItem, table: "CarePackageItem", orderBy: { sortOrder: "asc" } },
88: 
89:   // V2.1 — SOP & competency
90:   "community-sops": { delegate: prisma.communitySop, table: "CommunitySop", orderBy: { title: "asc" } },
91:   competencies: { delegate: prisma.competency, table: "Competency", orderBy: { name: "asc" } },
92:   "staff-competencies": { delegate: prisma.staffCompetency, table: "StaffCompetency", orderBy: { createdAt: "desc" } },
93: 
94:   // V2.1 — Quality scorecards & KPIs
95:   "resident-quality-scores": { delegate: prisma.residentQualityScore, table: "ResidentQualityScore", orderBy: { periodStart: "desc" } },
96:   "community-quality-dashboards": { delegate: prisma.communityQualityDashboard, table: "CommunityQualityDashboard", orderBy: { snapshotDate: "desc" } },
97:   "kpi-records": { delegate: prisma.kpiRecord, table: "KpiRecord", orderBy: { periodStart: "desc" } },
98: 
99:   // V2.1 — Audit log & observations
100:   "audit-logs": { delegate: prisma.auditLog, table: "AuditLog", orderBy: { createdAt: "desc" } },
101:   observations: { delegate: prisma.observation, table: "Observation", orderBy: { observedAt: "desc" } },
102: 
103:   // V2.1 — Staffing intelligence
104:   "staffing-plans": { delegate: prisma.staffingPlan, table: "StaffingPlan", orderBy: { planDate: "desc" } },
105: 
106:   // LCMS Module 1 — Vaccinations & Documents
107:   vaccinations: { delegate: prisma.vaccination, table: "Vaccination", orderBy: { dateGiven: "desc" } },
108:   "resident-documents": { delegate: prisma.residentDocument, table: "ResidentDocument", orderBy: { createdAt: "desc" } },
109: 
110:   // LCMS Module 3 — Care Plans
111:   "care-plans": { delegate: prisma.carePlan, table: "CarePlan", orderBy: { startDate: "desc" } },
112:   "care-plan-items": { delegate: prisma.carePlanItem, table: "CarePlanItem", orderBy: { sortOrder: "asc" } },
113:   "care-plan-reviews": { delegate: prisma.carePlanReview, table: "CarePlanReview", orderBy: { reviewDate: "desc" } },
114: 
115:   // LCMS Module 4 — Daily Documentation
116:   eliminations: { delegate: prisma.eliminationLog, table: "EliminationLog", orderBy: { time: "desc" } },
117:   "pain-assessments": { delegate: prisma.painAssessment, table: "PainAssessment", orderBy: { assessedAt: "desc" } },
118:   "wound-cares": { delegate: prisma.woundCare, table: "WoundCare", orderBy: { assessedAt: "desc" } },
119:   "sleep-logs": { delegate: prisma.sleepLog, table: "SleepLog", orderBy: { date: "desc" } },
120:   "mobility-logs": { delegate: prisma.mobilityLog, table: "MobilityLog", orderBy: { startTime: "desc" } },
121: 
122:   // LCMS Module 6 — Medication Administration & History
123:   "medication-administrations": { delegate: prisma.medicationAdministration, table: "MedicationAdministration", orderBy: { scheduledTime: "desc" } },
124:   "medication-change-logs": { delegate: prisma.medicationChangeLog, table: "MedicationChangeLog", orderBy: { changedAt: "desc" } },
125: 
126:   // LCMS Module 7 — Clinical Coordination
127:   "hospital-referrals": { delegate: prisma.hospitalReferral, table: "HospitalReferral", orderBy: { createdAt: "desc" } },
128:   "follow-ups": { delegate: prisma.followUp, table: "FollowUp", orderBy: { dueDate: "asc" } },
129: 
130:   // LCMS Module 8 — Timeline, Reports, Alerts
131:   "care-timeline": { delegate: prisma.careTimelineEntry, table: "CareTimelineEntry", orderBy: { entryDate: "desc" } },
132:   "generated-reports": { delegate: prisma.generatedReport, table: "GeneratedReport", orderBy: { createdAt: "desc" } },
133:   "inventory-alerts": { delegate: prisma.inventoryAlert, table: "InventoryAlert", orderBy: { createdAt: "desc" } },
134: 
135:   // LCMS Module 4 — Comprehensive Daily Rounds
136:   "daily-rounds": { delegate: prisma.dailyRound, table: "DailyRound", orderBy: { roundDate: "desc" } },
137:   "bowel-records": { delegate: prisma.bowelRecord, table: "BowelRecord", orderBy: { time: "desc" } },
138:   "urine-records": { delegate: prisma.urineRecord, table: "UrineRecord", orderBy: { time: "desc" } },
139:   "edema-records": { delegate: prisma.edemaRecord, table: "EdemaRecord", orderBy: { time: "desc" } },
140:   "concern-records": { delegate: prisma.concernRecord, table: "ConcernRecord", orderBy: { time: "desc" } },
141:   "pain-records": { delegate: prisma.painRecord, table: "PainRecord", orderBy: { time: "desc" } },
142:   "mood-records": { delegate: prisma.moodRecord, table: "MoodRecord", orderBy: { time: "desc" } },
143:   "round-sleep-records": { delegate: prisma.sleepRecord, table: "SleepRecord", orderBy: { createdAt: "desc" } },
144:   "mobility-records": { delegate: prisma.mobilityRecord, table: "MobilityRecord", orderBy: { time: "desc" } },
145:   "meal-records": { delegate: prisma.mealRecord, table: "MealRecord", orderBy: { time: "desc" } },
146:   "vital-signs": { delegate: prisma.vitalSigns, table: "VitalSigns", orderBy: { time: "desc" } },
147: };
148: 
149: export function getModel(key: string): ModelDef | undefined {
150:   return MODELS[key];
151: }
152: 
153: /**
154:  * True only when a real database connection string is present. Until the user
155:  * fills in DATABASE_URL (it ships as a `<PROJECT_REF>` placeholder), the API
156:  * routes serve demo data so the portals are fully populated instead of erroring.
157:  */
158: export function isDbConfigured(): boolean {
159:   let url = process.env.DATABASE_URL;
160:   if (!url) return false;
161:   url = url.trim();
162:   if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
163:     url = url.slice(1, -1).trim();
164:   }
165:   return (url.startsWith("postgresql://") || url.startsWith("postgres://")) && !url.includes("<");
166: }

(End of file - total 166 lines)
</content>
```

---

## Assistant (Build · Big Pickle · 75.4s)

_Thinking:_

Now let me look at the ServiceRequestsBoard and FacilityMaintenanceBoard to understand the data structures used.

Now let me look at the existing ServiceRequestsBoard and FacilityMaintenanceBoard components, and check the role config for facility_admin tabs.

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/services/ServiceRequestsBoard.tsx"
}
```

**Output:**
```
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\services\ServiceRequestsBoard.tsx
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "apps/frontend/src/components/portal/views/services/FacilityMaintenanceBoard.tsx"
}
```

**Output:**
```
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\services\FacilityMaintenanceBoard.tsx
```

**Tool: grep**

**Input:**
```json
{
  "pattern": "facility_admin",
  "include": "*roleConfig*"
}
```

**Output:**
```
Found 33 matches
C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\constants\roleConfig.ts:
  Line 184:   facility_admin: "FACILITY_ADMIN",

  Line 366:     basePath: "/facility_admin",

  Line 369:       { name: "Reporting & Care Intelligence", icon: Grid, route: "/facility_admin/dashboard" },

  Line 370:       { name: "Daily Rounds (10-Area Bedside)", icon: ClipboardCheck, route: "/facility_admin/dailyrounds" },

  Line 371:       { name: "Resident Profile & Care Record", icon: UserRound, route: "/facility_admin/residents" },

  Line 372:       { name: "Staff", icon: Users, route: "/facility_admin/staff" },

  Line 373:       { name: "Rooms", icon: DoorOpen, route: "/facility_admin/rooms" },

  Line 374:       { name: "Occupancy", icon: BedDouble, route: "/facility_admin/occupancy" },

  Line 375:       { name: "Incidents", icon: AlertTriangle, route: "/facility_admin/incidents" },

  Line 376:       { name: "Clinical Coordination", icon: Siren, route: "/facility_admin/escalations" },

  Line 377:       { name: "Medication Management & Inventory", icon: Package, route: "/facility_admin/inventory" },

  Line 378:       { name: "Shift Endorsement & Continuity", icon: FileText, route: "/facility_admin/reports" },

  Line 379:       { name: "Billing", icon: DollarSign, route: "/facility_admin/billing" },

  Line 380:       { name: "Dining & Compliance", icon: Utensils, route: "/facility_admin/dining" },

  Line 381:       { name: "Diet & Nutrition Orders", icon: Utensils, route: "/facility_admin/dietorders" },

  Line 382:       { name: "Kitchen — Cook List", icon: Utensils, route: "/facility_admin/kitchen" },

  Line 383:       { name: "Camera Activity Log", icon: Activity, route: "/facility_admin/cameralogs" },

  Line 384:       { name: "Resident Services", icon: Ticket, route: "/facility_admin/services" },

  Line 385:       { name: "Facility Maintenance", icon: Wrench, route: "/facility_admin/maintenance" },

  Line 386:       { name: "Concierge", icon: ConciergeBell, route: "/facility_admin/concierge" },

  Line 387:       { name: "Front Desk", icon: DoorOpen, route: "/facility_admin/frontdesk" },

  Line 388:       { name: "Unit Turnover", icon: Repeat, route: "/facility_admin/turnover" },

  Line 389:       { name: "Community & Events", icon: CalendarDays, route: "/facility_admin/community" },

  Line 391:       { name: "Assessment & Level of Care", icon: ClipboardList, route: "/facility_admin/rounds" },

  Line 392:       { name: "Care Planning", icon: Target, route: "/facility_admin/careplans" },

  Line 393:       { name: "Daily Care Documentation & Monitoring", icon: CheckCircle, route: "/facility_admin/tasks" },

  Line 394:       { name: "Vaccinations", icon: Syringe, route: "/facility_admin/vaccinations" },

  Line 395:       { name: "Resident Documents", icon: FolderOpen, route: "/facility_admin/documents" },

  Line 396:       { name: "Medication Administration Record", icon: Pill, route: "/facility_admin/mar" },

  Line 397:       { name: "Follow-up Tracker", icon: CalendarCheck, route: "/facility_admin/followups" },

  Line 398:       { name: "Audit Log", icon: Shield, route: "/facility_admin/auditlog" },

  Line 399:       { name: "Inventory Alerts", icon: Bell, route: "/facility_admin/inventory-alerts" },

  Line 400:       { name: "Clinical Reports", icon: BarChart3, route: "/facility_admin/clinicalreports" },

```

---

## Assistant (Build · Big Pickle · 108.5s)

_Thinking:_

Now let me read the ServiceRequestsBoard and FacilityMaintenanceBoard components to understand the data they use.

**Tool: read**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\components\\portal\\views\\services\\ServiceRequestsBoard.tsx"
}
```

**Output:**
```
<path>C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\services\ServiceRequestsBoard.tsx</path>
<type>file</type>
<content>
1: "use client";
2: 
3: import { useMemo, useState } from "react";
4: import {
5:   ConciergeBell, RefreshCw, Plus, X, Trash2, Search, Play, CheckCircle2,
6:   Ban, Loader2, Star, Ticket, Timer, CircleDollarSign, UserCheck, Camera,
7:   TrendingUp,
8: } from "lucide-react";
9: import {
10:   ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
11: } from "recharts";
12: import Swal from "sweetalert2";
13: import { useLiveQuery } from "@/lib/useLiveQuery";
14: import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
15: import {
16:   CATEGORY_META, PRIORITY_PILL, REQUEST_STATUS_PILL, TEAM_LABEL,
17:   SOURCE_LABEL, autoAssignTeam,
18: } from "./serviceMeta";
19: 
20: /**
21:  * Staff-facing hotel-style Resident Services desk (Phase 7 cont.) — live via
22:  * Supabase realtime + polling fallback. Full ticket workflow:
23:  * request (portal / AI voice / call bell / front desk) → priority ticket →
24:  * auto-assigned team → in progress → completed with photo proof → resident
25:  * confirmation & ★ rating → billable ServiceCharge posted → analytics.
26:  */
27: 
28: type Row = Record<string, unknown>;
29: 
30: const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
31: 
32: const adaptTicket = (r: Row) => {
33:   const resident = rel(r.resident);
34:   return {
35:     id: String(r.id ?? ""),
36:     residentId: String(r.residentId ?? ""),
37:     residentName: `${String(resident.firstName ?? "")} ${String(resident.lastName ?? "")}`.trim() || "—",
38:     roomNumber: String(r.roomNumber ?? resident.roomNumber ?? ""),
39:     category: String(r.category ?? "HOUSEKEEPING"),
40:     subType: String(r.subType ?? ""),
41:     details: String(r.details ?? ""),
42:     source: String(r.source ?? "RESIDENT_PORTAL"),
43:     priority: String(r.priority ?? "ROUTINE"),
44:     status: String(r.status ?? "OPEN"),
45:     assignedTeam: r.assignedTeam ? String(r.assignedTeam) : "",
46:     assignedTo: String(r.assignedTo ?? ""),
47:     photoProofUrl: String(r.photoProofUrl ?? ""),
48:     completedAt: r.completedAt ? String(r.completedAt) : "",
49:     rating: Number(r.rating ?? 0),
50:     ratingComment: String(r.ratingComment ?? ""),
51:     billable: Boolean(r.billable),
52:     charge: Number(r.charge ?? 0),
53:     billed: Boolean(r.billed),
54:     createdAt: String(r.createdAt ?? ""),
55:   };
56: };
57: type ServiceTicket = ReturnType<typeof adaptTicket>;
58: 
59: const adaptResident = (r: Row) => ({
60:   id: String(r.id ?? ""),
61:   name: `${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim(),
62:   roomNumber: String(r.roomNumber ?? ""),
63: });
64: type ResidentOpt = ReturnType<typeof adaptResident>;
65: 
66: const STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CONFIRMED", "CANCELLED"];
67: const PRIORITIES = ["ROUTINE", "URGENT", "EMERGENCY"];
68: const DAY_MS = 86400000;
69: 
70: const emptyForm = {
71:   residentId: "", category: "HOUSEKEEPING", subType: "Room Clean",
72:   priority: "ROUTINE", source: "FRONT_DESK", details: "",
73:   billable: false, charge: "",
74: };
75: 
76: const isLast30Days = (iso: string) => {
77:   if (!iso) return false;
78:   const t = new Date(iso).getTime();
79:   return !isNaN(t) && Date.now() - t <= 30 * DAY_MS;
80: };
81: 
82: export default function ServiceRequestsBoard({ categories }: { categories?: string[] } = {}) {
83:   const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
84:     "service-requests", { query: "include=resident&take=400", tables: ["ServiceRequest"] }
85:   );
86:   const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
87: 
88:   // When a role-scoped portal (Housekeeping / Maintenance) passes `categories`,
89:   // the whole board — tickets, stats, filters — is restricted to those categories.
90:   const tickets = useMemo<ServiceTicket[]>(
91:     () => rows.map(adaptTicket).filter((t) => !categories || categories.includes(t.category)),
92:     [rows, categories]
93:   );
94:   const residents = useMemo<ResidentOpt[]>(() => residentsQ.data.map(adaptResident), [residentsQ.data]);
95: 
96:   const [search, setSearch] = useState("");
97:   const [statusFilter, setStatusFilter] = useState("all");
98:   const [categoryFilter, setCategoryFilter] = useState("all");
99:   const [priorityFilter, setPriorityFilter] = useState("all");
100:   const [showCreate, setShowCreate] = useState(false);
101:   const [form, setForm] = useState(emptyForm);
102:   const [busyId, setBusyId] = useState<string | null>(null);
103:   const [page, setPage] = useState(1);
104:   const perPage = 12;
105: 
106:   const filtered = useMemo(() => {
107:     const q = search.trim().toLowerCase();
108:     return tickets.filter(t => {
109:       if (q && !t.residentName.toLowerCase().includes(q) && !t.roomNumber.toLowerCase().includes(q) && !t.details.toLowerCase().includes(q) && !t.subType.toLowerCase().includes(q)) return false;
110:       if (statusFilter !== "all" && t.status !== statusFilter) return false;
111:       if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
112:       if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
113:       return true;
114:     });
115:   }, [tickets, search, statusFilter, categoryFilter, priorityFilter]);
116: 
117:   const stats = useMemo(() => {
118:     const rated = tickets.filter(t => t.rating >= 1);
119:     const done30 = tickets.filter(t => ["COMPLETED", "CONFIRMED"].includes(t.status) && isLast30Days(t.completedAt));
120:     return {
121:       open: tickets.filter(t => ["OPEN", "ASSIGNED"].includes(t.status)).length,
122:       inProgress: tickets.filter(t => t.status === "IN_PROGRESS").length,
123:       emergency: tickets.filter(t => t.priority === "EMERGENCY" && !["COMPLETED", "CONFIRMED", "CANCELLED"].includes(t.status)).length,
124:       done30: done30.length,
125:       billed30: tickets.filter(t => t.billed && isLast30Days(t.completedAt)).reduce((s, t) => s + t.charge, 0),
126:       avgRating: rated.length ? rated.reduce((s, t) => s + t.rating, 0) / rated.length : 0,
127:     };
128:   }, [tickets]);
129: 
130:   const categoryChart = useMemo(() =>
131:     Object.keys(CATEGORY_META).map(c => ({
132:       name: CATEGORY_META[c].label,
133:       tickets: tickets.filter(t => t.category === c).length,
134:     })).filter(d => d.tickets > 0),
135:   [tickets]);
136: 
137:   const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
138:   const paginated = filtered.slice((page - 1) * perPage, page * perPage);
139: 
140:   /* ── Workflow actions ── */
141: 
142:   const handleCreate = async () => {
143:     if (!form.residentId || !form.details) {
144:       Swal.fire({ title: "Missing Fields", text: "Resident and request details are required.", icon: "warning" });
145:       return;
146:     }
147:     const team = autoAssignTeam(form.category, form.subType);
148:     const confirmed = await Swal.fire({
149:       title: "Create Service Ticket?",
150:       text: `Auto-assigns to ${TEAM_LABEL[team]}.`,
151:       icon: "question", showCancelButton: true,
152:       confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Create Ticket",
153:     });
154:     if (!confirmed.isConfirmed) return;
155:     try {
156:       const resident = residents.find(r => r.id === form.residentId);
157:       await createRecord("service-requests", {
158:         residentId: form.residentId,
159:         roomNumber: resident?.roomNumber || null,
160:         category: form.category,
161:         subType: form.subType || null,
162:         details: form.details,
163:         source: form.source,
164:         priority: form.priority,
165:         status: "ASSIGNED",
166:         assignedTeam: team,
167:         billable: form.billable,
168:         charge: form.billable && form.charge !== "" ? Number(form.charge) || 0 : null,
169:       });
170:       await refetch();
171:       setShowCreate(false);
172:       setForm(emptyForm);
173:       Swal.fire({ title: "Ticket Created", text: `Assigned to ${TEAM_LABEL[team]}.`, icon: "success", timer: 1600, showConfirmButton: false });
174:     } catch (err) {
175:       Swal.fire({ title: "Create Failed", text: err instanceof Error ? err.message : "Could not create ticket.", icon: "error" });
176:     }
177:   };
178: 
179:   const handleStart = async (t: ServiceTicket) => {
180:     const result = await Swal.fire({
181:       title: "Start Work Order?",
182:       html:
183:         `<p style="font-size:14px;margin-bottom:10px">${CATEGORY_META[t.category]?.label ?? t.category} — ${t.residentName} (Room ${t.roomNumber})</p>` +
184:         `<input id="swal-worker" class="swal2-input" placeholder="Staff member working the ticket" value="${t.assignedTo || ""}">`,
185:       icon: "question", showCancelButton: true,
186:       confirmButtonColor: "#f59e0b", cancelButtonColor: "#6b7280", confirmButtonText: "Start Work",
187:       preConfirm: () => (document.getElementById("swal-worker") as HTMLInputElement | null)?.value ?? "",
188:     });
189:     if (!result.isConfirmed) return;
190:     setBusyId(t.id);
191:     try {
192:       await updateRecord("service-requests", t.id, {
193:         status: "IN_PROGRESS",
194:         assignedTo: String(result.value || "") || null,
195:         startedAt: new Date().toISOString(),
196:       });
197:       await refetch();
198:     } catch (err) {
199:       Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not start work.", icon: "error" });
200:     } finally {
201:       setBusyId(null);
202:     }
203:   };
204: 
205:   const handleComplete = async (t: ServiceTicket) => {
206:     // Holds the uploaded photo as a downscaled JPEG data URL (or an existing URL).
207:     let photoData = t.photoProofUrl || "";
208:     // Read a device photo, downscale it (max 1000px, JPEG q0.7) so the payload stays small.
209:     const fileToDataUrl = (file: File) => new Promise<string>((resolve) => {
210:       const reader = new FileReader();
211:       reader.onload = () => {
212:         const img = new Image();
213:         img.onload = () => {
214:           const max = 1000;
215:           let w = img.width, h = img.height;
216:           if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
217:           const canvas = document.createElement("canvas");
218:           canvas.width = w; canvas.height = h;
219:           canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
220:           resolve(canvas.toDataURL("image/jpeg", 0.7));
221:         };
222:         img.src = String(reader.result);
223:       };
224:       reader.readAsDataURL(file);
225:     });
226:     const result = await Swal.fire({
227:       title: "Complete with Photo Proof",
228:       html:
229:         `<p style="font-size:14px;margin-bottom:10px">Attach a photo of the finished work and the final billing:</p>` +
230:         `<input id="swal-file" type="file" accept="image/*" capture="environment" class="swal2-file" style="margin:0 auto 8px">` +
231:         `<img id="swal-preview" src="${t.photoProofUrl || ""}" style="display:${t.photoProofUrl ? "block" : "none"};max-height:140px;margin:0 auto 8px;border-radius:8px;border:1px solid #e5e7eb" />` +
232:         `<input id="swal-photo" class="swal2-input" placeholder="…or paste a photo URL" value="${/^https?:/.test(t.photoProofUrl || "") ? t.photoProofUrl : ""}">` +
233:         `<input id="swal-charge" type="number" min="0" step="0.01" class="swal2-input" placeholder="Billable charge (₱, 0 = free)" value="${t.charge || ""}">`,
234:       showCancelButton: true,
235:       confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Complete Ticket",
236:       didOpen: () => {
237:         const fileEl = document.getElementById("swal-file") as HTMLInputElement | null;
238:         fileEl?.addEventListener("change", async () => {
239:           const f = fileEl.files?.[0];
240:           if (!f) return;
241:           photoData = await fileToDataUrl(f);
242:           const prev = document.getElementById("swal-preview") as HTMLImageElement | null;
243:           if (prev) { prev.src = photoData; prev.style.display = "block"; }
244:         });
245:       },
246:       preConfirm: () => {
247:         const url = (document.getElementById("swal-photo") as HTMLInputElement | null)?.value?.trim() || "";
248:         return {
249:           photo: photoData || url,
250:           charge: Number((document.getElementById("swal-charge") as HTMLInputElement | null)?.value ?? 0) || 0,
251:         };
252:       },
253:     });
254:     if (!result.isConfirmed) return;
255:     const { photo, charge } = (result.value as { photo: string; charge: number }) ?? { photo: "", charge: 0 };
256:     setBusyId(t.id);
257:     try {
258:       const billable = charge > 0;
259:       await updateRecord("service-requests", t.id, {
260:         status: "COMPLETED",
261:         completedAt: new Date().toISOString(),
262:         photoProofUrl: photo || null,
263:         billable,
264:         charge: billable ? charge : null,
265:         billed: billable,
266:       });
267:       // Billable services post straight into the invoice pipeline as a ServiceCharge.
268:       if (billable) {
269:         await createRecord("service-charges", {
270:           residentId: t.residentId,
271:           description: `${CATEGORY_META[t.category]?.label ?? t.category}${t.subType ? ` — ${t.subType}` : ""} (Ticket ${t.id.slice(0, 8)})`,
272:           amount: charge,
273:           serviceDate: new Date().toISOString(),
274:           category: "Hotel Services",
275:         });
276:       }
277:       await refetch();
278:       Swal.fire({
279:         title: "Ticket Completed",
280:         text: billable
281:           ? `₱${charge.toLocaleString()} posted to the resident's invoice pipeline. Resident notified to confirm & rate.`
282:           : "Resident notified to confirm & rate the service.",
283:         icon: "success", timer: 2200, showConfirmButton: false,
284:       });
285:     } catch (err) {
286:       Swal.fire({ title: "Complete Failed", text: err instanceof Error ? err.message : "Could not complete ticket.", icon: "error" });
287:     } finally {
288:       setBusyId(null);
289:     }
290:   };
291: 
292:   const handleCancel = async (t: ServiceTicket) => {
293:     const confirmed = await Swal.fire({
294:       title: "Cancel Ticket?", text: `Cancel this ${CATEGORY_META[t.category]?.label ?? t.category} request for ${t.residentName}?`,
295:       icon: "warning", showCancelButton: true,
296:       confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Cancel Ticket",
297:     });
298:     if (!confirmed.isConfirmed) return;
299:     setBusyId(t.id);
300:     try {
301:       await updateRecord("service-requests", t.id, { status: "CANCELLED" });
302:       await refetch();
303:     } catch (err) {
304:       Swal.fire({ title: "Cancel Failed", text: err instanceof Error ? err.message : "Could not cancel ticket.", icon: "error" });
305:     } finally {
306:       setBusyId(null);
307:     }
308:   };
309: 
310:   const handleDelete = async (t: ServiceTicket) => {
311:     const confirmed = await Swal.fire({
312:       title: "Delete Ticket?", text: "Remove this ticket permanently?", icon: "warning",
313:       showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
314:     });
315:     if (!confirmed.isConfirmed) return;
316:     try {
317:       await deleteRecord("service-requests", t.id);
318:       await refetch();
319:     } catch (err) {
320:       Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete ticket.", icon: "error" });
321:     }
322:   };
323: 
324:   const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
325:     const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
326:     setForm(f => {
327:       const next = { ...f, [field]: value };
328:       // Keep subType valid when the category changes.
329:       if (field === "category") next.subType = CATEGORY_META[String(value)]?.subTypes[0] ?? "";
330:       return next;
331:     });
332:   };
333: 
334:   return (
335:     <div className="space-y-6">
336:       {/* Header */}
337:       <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
338:         <div>
339:           <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
340:             Resident Services
341:           </h1>
342:           <p className="text-gray-600">Hotel-style ticket desk — aircon/HVAC · housekeeping · room service · laundry · repairs</p>
343:         </div>
344:         <div className="flex gap-2">
345:           <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
346:             <RefreshCw className="w-4 h-4" /> Refresh
347:           </button>
348:           {/* Tickets originate from residents or the Facility Admin front desk — crew
349:               portals (scoped via `categories`) work the queue but don't raise tickets. */}
350:           {!categories && (
351:             <button onClick={() => { setForm(emptyForm); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
352:               <Plus className="w-4 h-4" /> New Ticket (Front Desk)
353:             </button>
354:           )}
355:         </div>
356:       </div>
357: 
358:       {/* Stat Boxes */}
359:       <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
360:         <StatBox label="Open Tickets" value={String(stats.open)} icon={Ticket} color="blue" />
361:         <StatBox label="In Progress" value={String(stats.inProgress)} icon={Timer} color="amber" />
362:         <StatBox label="Active Emergencies" value={String(stats.emergency)} icon={ConciergeBell} color="red" />
363:         <StatBox label="Completed (30d)" value={String(stats.done30)} icon={CheckCircle2} color="green" />
364:         <StatBox label="Billed (30d)" value={`₱${Math.round(stats.billed30).toLocaleString()}`} icon={CircleDollarSign} color="amber" />
365:         <StatBox label="Avg Satisfaction" value={stats.avgRating ? `${stats.avgRating.toFixed(1)} ★` : "—"} icon={Star} color="purple" />
366:       </div>
367: 
368:       {/* Filters */}
369:       <div className="space-y-3">
370:         <div className="flex gap-2 flex-wrap">
371:           {["all", ...STATUSES].map(s => (
372:             <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
373:               className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
374:                 statusFilter === s
375:                   ? "bg-yellow-400 text-black border-yellow-400"
376:                   : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
377:               }`}>
378:               {s === "all" ? "All" : s.replace(/_/g, " ")}
379:             </button>
380:           ))}
381:         </div>
382:         <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
383:           <div className="relative flex-1 min-w-[180px]">
384:             <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
385:             <input type="text" placeholder="Search resident, room, or details…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
386:               className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
387:           </div>
388:           <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
389:             className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
390:             <option value="all">All Categories</option>
391:             {Object.entries(CATEGORY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
392:           </select>
393:           <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}
394:             className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
395:             <option value="all">All Priorities</option>
396:             {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
397:           </select>
398:         </div>
399:       </div>
400: 
401:       {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}
402: 
403:       {/* Ticket table */}
404:       {loading && tickets.length === 0 ? (
405:         <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading service tickets...</div>
406:       ) : filtered.length === 0 ? (
407:         <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No service tickets match your filters.</div>
408:       ) : (
409:         <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
410:           <table className="w-full text-sm">
411:             <thead className="bg-gray-50 border-b border-gray-200">
412:               <tr>
413:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Category</th>
414:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident · Room</th>
415:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Details</th>
416:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Source</th>
417:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Priority</th>
418:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Team</th>
419:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
420:                 <th className="text-right px-4 py-3 font-semibold text-gray-700">Charge</th>
421:                 <th className="text-center px-4 py-3 font-semibold text-gray-700">Rating</th>
422:                 <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
423:               </tr>
424:             </thead>
425:             <tbody className="divide-y divide-gray-100">
426:               {paginated.map(t => {
427:                 const meta = CATEGORY_META[t.category] ?? CATEGORY_META.HOUSEKEEPING;
428:                 const CatIcon = meta.icon;
429:                 const busy = busyId === t.id;
430:                 return (
431:                   <tr key={t.id} className="hover:bg-gray-50 transition">
432:                     <td className="px-4 py-3">
433:                       <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.cls}`}>
434:                         <CatIcon className="w-3 h-3" /> {meta.label}
435:                       </span>
436:                       {t.subType && <p className="text-[11px] text-gray-500 mt-0.5">{t.subType}</p>}
437:                     </td>
438:                     <td className="px-4 py-3">
439:                       <p className="font-medium text-gray-900">{t.residentName}</p>
440:                       <p className="text-xs text-gray-500">Room {t.roomNumber || "—"}</p>
441:                     </td>
442:                     <td className="px-4 py-3 text-gray-600 text-xs max-w-[220px]">
443:                       <p className="truncate" title={t.details}>{t.details || "—"}</p>
444:                       {t.photoProofUrl && (
445:                         <a href={t.photoProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 mt-0.5">
446:                           <Camera className="w-3 h-3" /> Photo proof
447:                         </a>
448:                       )}
449:                     </td>
450:                     <td className="px-4 py-3 text-gray-600 text-xs">{SOURCE_LABEL[t.source] ?? t.source}</td>
451:                     <td className="px-4 py-3">
452:                       <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${PRIORITY_PILL[t.priority] ?? PRIORITY_PILL.ROUTINE}`}>{t.priority}</span>
453:                     </td>
454:                     <td className="px-4 py-3 text-gray-600 text-xs">
455:                       {t.assignedTeam ? TEAM_LABEL[t.assignedTeam] ?? t.assignedTeam : "—"}
456:                       {t.assignedTo && <p className="text-[11px] text-gray-400">{t.assignedTo}</p>}
457:                     </td>
458:                     <td className="px-4 py-3">
459:                       <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${REQUEST_STATUS_PILL[t.status] ?? "bg-gray-100 text-gray-700"}`}>
460:                         {t.status.replace(/_/g, " ")}
461:                       </span>
462:                     </td>
463:                     <td className="px-4 py-3 text-right text-gray-900 font-medium">
464:                       {t.charge ? `₱${t.charge.toLocaleString()}` : "—"}
465:                       {t.billed && <p className="text-[10px] text-green-600 font-semibold">POSTED</p>}
466:                     </td>
467:                     <td className="px-4 py-3 text-center">
468:                       {t.rating >= 1 ? (
469:                         <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold text-xs" title={t.ratingComment}>
470:                           {t.rating} <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
471:                         </span>
472:                       ) : t.status === "COMPLETED" ? (
473:                         <span className="text-[10px] text-gray-400">awaiting</span>
474:                       ) : "—"}
475:                     </td>
476:                     <td className="px-4 py-3">
477:                       <div className="flex items-center justify-center gap-1 flex-wrap">
478:                         {busy ? (
479:                           <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
480:                         ) : (
481:                           <>
482:                             {["OPEN", "ASSIGNED"].includes(t.status) && (
483:                               <button onClick={() => handleStart(t)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Start Work"><Play className="w-4 h-4" /></button>
484:                             )}
485:                             {t.status === "IN_PROGRESS" && (
486:                               <button onClick={() => handleComplete(t)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete with Photo Proof"><CheckCircle2 className="w-4 h-4" /></button>
487:                             )}
488:                             {t.status === "COMPLETED" && (
489:                               <span className="p-1.5 text-emerald-600" title="Awaiting resident confirmation"><UserCheck className="w-4 h-4" /></span>
490:                             )}
491:                             {!["COMPLETED", "CONFIRMED", "CANCELLED"].includes(t.status) && (
492:                               <button onClick={() => handleCancel(t)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Ban className="w-4 h-4" /></button>
493:                             )}
494:                             <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
495:                           </>
496:                         )}
497:                       </div>
498:                     </td>
499:                   </tr>
500:                 );
501:               })}
502:             </tbody>
503:           </table>
504:         </div>
505:       )}
506: 
507:       {/* Pagination */}
508:       {filtered.length > perPage && (
509:         <div className="flex items-center justify-between gap-4 flex-wrap">
510:           <div className="text-sm text-gray-600">{filtered.length} tickets total</div>
511:           <div className="flex items-center gap-2">
512:             <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
513:               className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
514:             <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
515:             <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
516:               className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
517:           </div>
518:         </div>
519:       )}
520: 
521:       {/* Service Analytics */}
522:       {categoryChart.length > 0 && (
523:         <div className="bg-white rounded-lg border border-gray-200 p-4">
524:           <div className="flex items-center gap-1.5 mb-2">
525:             <TrendingUp className="w-4 h-4 text-yellow-500" />
526:             <h3 className="font-semibold text-gray-900 text-sm">Service Analytics — Tickets per Category</h3>
527:           </div>
528:           <div className="h-[220px]">
529:             <ResponsiveContainer width="100%" height="100%">
530:               <BarChart data={categoryChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
531:                 <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
532:                 <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
533:                 <YAxis type="category" dataKey="name" fontSize={10} tickLine={false} axisLine={false} width={130} />
534:                 <Tooltip />
535:                 <Bar dataKey="tickets" name="Tickets" fill="#f59e0b" radius={[0, 3, 3, 0]} />
536:               </BarChart>
537:             </ResponsiveContainer>
538:           </div>
539:         </div>
540:       )}
541: 
542:       {/* Create Modal */}
543:       {showCreate && (
544:         <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
545:           <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
546:             <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
547:               <h2 className="text-xl font-bold">New Service Ticket</h2>
548:               <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
549:             </div>
550:             <div className="p-6 space-y-4">
551:               <div className="grid grid-cols-2 gap-4">
552:                 <div className="col-span-2">
553:                   <label className="block text-sm font-semibold text-gray-700 mb-1">Resident</label>
554:                   <select value={form.residentId} onChange={set("residentId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
555:                     <option value="">Select resident…</option>
556:                     {residents.map(r => <option key={r.id} value={r.id}>{r.name} — Room {r.roomNumber}</option>)}
557:                   </select>
558:                 </div>
559:                 <div>
560:                   <label className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
561:                   <select value={form.category} onChange={set("category")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
562:                     {Object.entries(CATEGORY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
563:                   </select>
564:                 </div>
565:                 <div>
566:                   <label className="block text-sm font-semibold text-gray-700 mb-1">Sub-type</label>
567:                   <select value={form.subType} onChange={set("subType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
568:                     {(CATEGORY_META[form.category]?.subTypes ?? []).map(s => <option key={s} value={s}>{s}</option>)}
569:                   </select>
570:                 </div>
571:                 <div>
572:                   <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
573:                   <select value={form.priority} onChange={set("priority")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
574:                     {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
575:                   </select>
576:                 </div>
577:                 <div>
578:                   <label className="block text-sm font-semibold text-gray-700 mb-1">Source</label>
579:                   <select value={form.source} onChange={set("source")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
580:                     <option value="FRONT_DESK">Front Desk</option>
581:                     <option value="CALL_BELL">Call Bell</option>
582:                     <option value="AI_COMPANION">AI Companion Voice</option>
583:                     <option value="RESIDENT_PORTAL">Resident Portal</option>
584:                   </select>
585:                 </div>
586:                 <div className="col-span-2">
587:                   <label className="block text-sm font-semibold text-gray-700 mb-1">Request Details</label>
588:                   <textarea value={form.details} onChange={set("details")} rows={3} placeholder="e.g. Aircon not cooling; please check the filter." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
589:                 </div>
590:                 <div className="col-span-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">
591:                   Auto-assign: <strong>{TEAM_LABEL[autoAssignTeam(form.category, form.subType)]}</strong>
592:                 </div>
593:               </div>
594:             </div>
595:             <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
596:               <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
597:               <button onClick={handleCreate} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Create Ticket</button>
598:             </div>
599:           </div>
600:         </div>
601:       )}
602:     </div>
603:   );
604: }
605: 
606: /* ── Sub-components ── */
607: 
608: function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
609:   const COLORS: Record<string, string> = {
610:     blue: "text-blue-600 bg-blue-50 border-blue-200",
611:     green: "text-green-600 bg-green-50 border-green-200",
612:     red: "text-red-600 bg-red-50 border-red-200",
613:     purple: "text-purple-600 bg-purple-50 border-purple-200",
614:     amber: "text-amber-600 bg-amber-50 border-amber-200",
615:   };
616:   const c = COLORS[color] || COLORS.blue;
617:   return (
618:     <div className={`rounded-lg border p-4 ${c}`}>
619:       <div className="flex items-center justify-between mb-0.5">
620:         <p className="text-xs font-semibold text-gray-600">{label}</p>
621:         <Icon className={`w-4 h-4 ${c.split(" ")[0]}`} />
622:       </div>
623:       <p className={`text-2xl sm:text-3xl font-bold ${c.split(" ")[0]}`}>{value}</p>
624:     </div>
625:   );
626: }

(End of file - total 626 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\components\\portal\\views\\services\\FacilityMaintenanceBoard.tsx"
}
```

**Output:**
```
<path>C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\services\FacilityMaintenanceBoard.tsx</path>
<type>file</type>
<content>
1: "use client";
2: 
3: import { useMemo, useState } from "react";
4: import {
5:   RefreshCw, Plus, X, Edit, Trash2, Search, CalendarClock, Play,
6:   CheckCircle2, Ban, AlertTriangle, Loader2, CircleDollarSign, Building2,
7:   ClipboardCheck, ChevronLeft, ChevronRight, Eye,
8: } from "lucide-react";
9: import Swal from "sweetalert2";
10: import { useLiveQuery } from "@/lib/useLiveQuery";
11: import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
12: import { SYSTEM_META, FREQUENCY_DAYS, FREQUENCY_LABEL } from "./serviceMeta";
13: 
14: /**
15:  * Preventive Facility Maintenance calendar (Phase 7 cont.) — live via
16:  * Supabase realtime + polling fallback. Covers the recurring plant loop:
17:  * HVAC quarterly service · generator monthly test · elevator inspection ·
18:  * fire & safety systems · pest control. Completing a PREVENTIVE entry
19:  * auto-schedules the next occurrence from its frequency.
20:  */
21: 
22: type Row = Record<string, unknown>;
23: 
24: const adaptEntry = (r: Row) => ({
25:   id: String(r.id ?? ""),
26:   title: String(r.title ?? "Maintenance"),
27:   system: String(r.system ?? "OTHER"),
28:   type: String(r.type ?? "PREVENTIVE"),
29:   status: String(r.status ?? "SCHEDULED"),
30:   frequency: String(r.frequency ?? "QUARTERLY"),
31:   location: String(r.location ?? ""),
32:   description: String(r.description ?? ""),
33:   scheduledDate: r.scheduledDate ? String(r.scheduledDate) : "",
34:   completedDate: r.completedDate ? String(r.completedDate) : "",
35:   nextDueDate: r.nextDueDate ? String(r.nextDueDate) : "",
36:   assignedTo: String(r.assignedTo ?? ""),
37:   vendor: String(r.vendor ?? ""),
38:   cost: Number(r.cost ?? 0),
39:   notes: String(r.notes ?? ""),
40: });
41: type MaintEntry = ReturnType<typeof adaptEntry>;
42: 
43: const STATUSES = ["SCHEDULED", "OPEN", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED", "CANCELLED"];
44: const TYPES = ["PREVENTIVE", "REPAIR", "INSPECTION"];
45: const DAY_MS = 86400000;
46: 
47: const STATUS_STYLES: Record<string, string> = {
48:   SCHEDULED: "bg-gray-100 text-gray-700",
49:   OPEN: "bg-blue-100 text-blue-700",
50:   IN_PROGRESS: "bg-amber-100 text-amber-700",
51:   AWAITING_PARTS: "bg-purple-100 text-purple-700",
52:   COMPLETED: "bg-green-100 text-green-700",
53:   CANCELLED: "bg-red-100 text-red-700",
54: };
55: 
56: const emptyForm = {
57:   title: "", system: "HVAC", type: "PREVENTIVE", status: "SCHEDULED",
58:   frequency: "QUARTERLY", location: "", description: "", scheduledDate: "",
59:   assignedTo: "", vendor: "", cost: "", notes: "",
60: };
61: 
62: export default function FacilityMaintenanceBoard() {
63:   const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
64:     "facility-maintenance", { query: "take=400", tables: ["FacilityMaintenance"] }
65:   );
66:   const entries = useMemo<MaintEntry[]>(() => rows.map(adaptEntry), [rows]);
67: 
68:   const [search, setSearch] = useState("");
69:   const [statusFilter, setStatusFilter] = useState("all");
70:   const [systemFilter, setSystemFilter] = useState("all");
71:   const [showCreate, setShowCreate] = useState(false);
72:   const [editing, setEditing] = useState<MaintEntry | null>(null);
73:   const [viewing, setViewing] = useState<MaintEntry | null>(null);
74:   const [createForm, setCreateForm] = useState(emptyForm);
75:   const [editForm, setEditForm] = useState(emptyForm);
76:   const [busyId, setBusyId] = useState<string | null>(null);
77:   const [page, setPage] = useState(1);
78:   const perPage = 12;
79: 
80:   const filtered = useMemo(() => {
81:     const q = search.trim().toLowerCase();
82:     return entries.filter(e => {
83:       if (q && !e.title.toLowerCase().includes(q) && !e.vendor.toLowerCase().includes(q) && !e.location.toLowerCase().includes(q)) return false;
84:       if (statusFilter !== "all" && e.status !== statusFilter) return false;
85:       if (systemFilter !== "all" && e.system !== systemFilter) return false;
86:       return true;
87:     });
88:   }, [entries, search, statusFilter, systemFilter]);
89: 
90:   const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
91:   const paginated = filtered.slice((page - 1) * perPage, page * perPage);
92: 
93:   const dueSoon = useMemo(() =>
94:     entries.filter(e => {
95:       if (["COMPLETED", "CANCELLED"].includes(e.status) || !e.scheduledDate) return false;
96:       // eslint-disable-next-line react-hooks/purity
97:       return new Date(e.scheduledDate).getTime() <= Date.now() + 7 * DAY_MS;
98:     }).sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()),
99:   [entries]);
100: 
101:   const stats = useMemo(() => ({
102:     scheduled: entries.filter(e => e.status === "SCHEDULED").length,
103:     inProgress: entries.filter(e => ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"].includes(e.status)).length,
104:     dueSoon: dueSoon.length,
105:     completed: entries.filter(e => e.status === "COMPLETED").length,
106:     cost: entries.filter(e => e.status === "COMPLETED").reduce((s, e) => s + e.cost, 0),
107:   }), [entries, dueSoon]);
108: 
109:   const buildPayload = (form: typeof emptyForm) => ({
110:     title: form.title,
111:     system: form.system,
112:     type: form.type,
113:     status: form.status,
114:     frequency: form.frequency,
115:     location: form.location || null,
116:     description: form.description || null,
117:     scheduledDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : null,
118:     nextDueDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : null,
119:     assignedTo: form.assignedTo || null,
120:     vendor: form.vendor || null,
121:     cost: form.cost !== "" ? Number(form.cost) || 0 : null,
122:     notes: form.notes || null,
123:   });
124: 
125:   const handleCreate = async () => {
126:     if (!createForm.title) {
127:       Swal.fire({ title: "Missing Fields", text: "A title is required.", icon: "warning" });
128:       return;
129:     }
130:     try {
131:       await createRecord("facility-maintenance", buildPayload(createForm));
132:       await refetch();
133:       setShowCreate(false);
134:       setCreateForm(emptyForm);
135:       Swal.fire({ title: "Scheduled", text: `"${createForm.title}" added to the maintenance calendar.`, icon: "success", timer: 1500, showConfirmButton: false });
136:     } catch (err) {
137:       Swal.fire({ title: "Create Failed", text: err instanceof Error ? err.message : "Could not schedule maintenance.", icon: "error" });
138:     }
139:   };
140: 
141:   const startEditing = (e: MaintEntry) => {
142:     setEditing(e);
143:     setEditForm({
144:       title: e.title, system: e.system, type: e.type, status: e.status,
145:       frequency: e.frequency, location: e.location, description: e.description,
146:       scheduledDate: e.scheduledDate ? e.scheduledDate.split("T")[0] : "",
147:       assignedTo: e.assignedTo, vendor: e.vendor,
148:       cost: e.cost ? String(e.cost) : "", notes: e.notes,
149:     });
150:   };
151: 
152:   const handleSaveEdit = async () => {
153:     if (!editing) return;
154:     try {
155:       await updateRecord("facility-maintenance", editing.id, buildPayload(editForm));
156:       await refetch();
157:       setEditing(null);
158:       Swal.fire({ title: "Saved", text: "Maintenance entry updated.", icon: "success", timer: 1500, showConfirmButton: false });
159:     } catch (err) {
160:       Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not update entry.", icon: "error" });
161:     }
162:   };
163: 
164:   const handleStart = async (e: MaintEntry) => {
165:     setBusyId(e.id);
166:     try {
167:       await updateRecord("facility-maintenance", e.id, { status: "IN_PROGRESS" });
168:       await refetch();
169:     } catch (err) {
170:       Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not start work.", icon: "error" });
171:     } finally {
172:       setBusyId(null);
173:     }
174:   };
175: 
176:   const handleComplete = async (e: MaintEntry) => {
177:     const result = await Swal.fire({
178:       title: "Complete Maintenance",
179:       html:
180:         `<p style="font-size:14px;margin-bottom:10px">"${e.title}" — final cost:</p>` +
181:         `<input id="swal-cost" type="number" min="0" step="0.01" class="swal2-input" placeholder="Cost (₱)" value="${e.cost || ""}">`,
182:       icon: "question", showCancelButton: true,
183:       confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280",
184:       confirmButtonText: e.type === "PREVENTIVE" ? "Complete & Schedule Next" : "Complete",
185:       preConfirm: () => Number((document.getElementById("swal-cost") as HTMLInputElement | null)?.value ?? 0) || 0,
186:     });
187:     if (!result.isConfirmed) return;
188:     const cost = Number(result.value ?? 0);
189:     setBusyId(e.id);
190:     try {
191:       const now = new Date();
192:       const intervalDays = FREQUENCY_DAYS[e.frequency] ?? 91;
193:       const nextDue = new Date(now.getTime() + intervalDays * DAY_MS);
194:       await updateRecord("facility-maintenance", e.id, {
195:         status: "COMPLETED",
196:         completedDate: now.toISOString(),
197:         cost,
198:         nextDueDate: e.type === "PREVENTIVE" ? nextDue.toISOString() : null,
199:       });
200:       // Recurring preventive entries roll forward automatically on the calendar.
201:       if (e.type === "PREVENTIVE") {
202:         await createRecord("facility-maintenance", {
203:           title: e.title,
204:           system: e.system,
205:           type: e.type,
206:           status: "SCHEDULED",
207:           frequency: e.frequency,
208:           location: e.location || null,
209:           description: e.description || null,
210:           scheduledDate: nextDue.toISOString(),
211:           nextDueDate: nextDue.toISOString(),
212:           assignedTo: e.assignedTo || null,
213:           vendor: e.vendor || null,
214:         });
215:       }
216:       await refetch();
217:       Swal.fire({
218:         title: "Completed",
219:         text: e.type === "PREVENTIVE"
220:           ? `Next ${FREQUENCY_LABEL[e.frequency]?.toLowerCase() ?? ""} occurrence scheduled for ${nextDue.toLocaleDateString()}.`
221:           : "Maintenance entry closed.",
222:         icon: "success", timer: 2200, showConfirmButton: false,
223:       });
224:     } catch (err) {
225:       Swal.fire({ title: "Complete Failed", text: err instanceof Error ? err.message : "Could not complete entry.", icon: "error" });
226:     } finally {
227:       setBusyId(null);
228:     }
229:   };
230: 
231:   const handleCancel = async (e: MaintEntry) => {
232:     const confirmed = await Swal.fire({
233:       title: "Cancel Entry?", text: `Cancel "${e.title}"?`, icon: "warning",
234:       showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Cancel Entry",
235:     });
236:     if (!confirmed.isConfirmed) return;
237:     setBusyId(e.id);
238:     try {
239:       await updateRecord("facility-maintenance", e.id, { status: "CANCELLED" });
240:       await refetch();
241:     } catch (err) {
242:       Swal.fire({ title: "Cancel Failed", text: err instanceof Error ? err.message : "Could not cancel entry.", icon: "error" });
243:     } finally {
244:       setBusyId(null);
245:     }
246:   };
247: 
248:   const handleDelete = async (e: MaintEntry) => {
249:     const confirmed = await Swal.fire({
250:       title: "Delete Entry?", text: `Remove "${e.title}"?`, icon: "warning",
251:       showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
252:     });
253:     if (!confirmed.isConfirmed) return;
254:     try {
255:       await deleteRecord("facility-maintenance", e.id);
256:       await refetch();
257:     } catch (err) {
258:       Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete entry.", icon: "error" });
259:     }
260:   };
261: 
262:   return (
263:     <div className="space-y-6">
264:       {/* Header */}
265:       <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
266:         <div>
267:           <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
268:             Facility Maintenance
269:           </h1>
270:           <p className="text-gray-600">Preventive calendar — HVAC quarterly · generator monthly · elevator · fire &amp; safety · pest control</p>
271:         </div>
272:         <div className="flex gap-2">
273:           <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
274:             <RefreshCw className="w-4 h-4" /> Refresh
275:           </button>
276:           <button onClick={() => { setCreateForm(emptyForm); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
277:             <Plus className="w-4 h-4" /> Schedule Maintenance
278:           </button>
279:         </div>
280:       </div>
281: 
282:       {/* Stat Boxes */}
283:       <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
284:         <StatBox label="Scheduled" value={String(stats.scheduled)} icon={CalendarClock} color="blue" />
285:         <StatBox label="In Progress" value={String(stats.inProgress)} icon={Play} color="amber" />
286:         <StatBox label="Due in 7 Days" value={String(stats.dueSoon)} icon={AlertTriangle} color="red" />
287:         <StatBox label="Completed" value={String(stats.completed)} icon={CheckCircle2} color="green" />
288:         <StatBox label="Total Spend" value={`₱${Math.round(stats.cost).toLocaleString()}`} icon={CircleDollarSign} color="purple" />
289:       </div>
290: 
291:       {/* Due-soon panel */}
292:       {dueSoon.length > 0 && (
293:         <div className="bg-white rounded-lg border border-red-200 ring-1 ring-red-100 p-4">
294:           <div className="flex items-center gap-1.5 mb-3">
295:             <AlertTriangle className="w-4 h-4 text-red-500" />
296:             <h3 className="font-semibold text-gray-900 text-sm">Due Within 7 Days</h3>
297:             <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{dueSoon.length}</span>
298:           </div>
299:           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
300:             {dueSoon.slice(0, 6).map(e => {
301:               const sys = SYSTEM_META[e.system] ?? SYSTEM_META.OTHER;
302:               return (
303:                 <div key={e.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
304:                   <Building2 className="w-5 h-5 text-red-500 flex-shrink-0" />
305:                   <div className="flex-1 min-w-0">
306:                     <p className="text-sm font-semibold text-gray-900 truncate">{e.title}</p>
307:                     <p className="text-xs text-gray-500 truncate">
308:                       <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold mr-1 ${sys.cls}`}>{sys.label}</span>
309:                       Due {e.scheduledDate ? new Date(e.scheduledDate).toLocaleDateString() : "—"}
310:                     </p>
311:                   </div>
312:                   {["SCHEDULED", "OPEN"].includes(e.status) && (
313:                     <button onClick={() => handleStart(e)} className="px-3 py-1.5 text-xs font-semibold bg-yellow-400 hover:bg-yellow-500 text-black rounded-lg transition whitespace-nowrap">
314:                       Start
315:                     </button>
316:                   )}
317:                 </div>
318:               );
319:             })}
320:           </div>
321:         </div>
322:       )}
323: 
324:       {/* Filters */}
325:       <div className="space-y-3">
326:         <div className="flex gap-2 flex-wrap">
327:           {["all", ...STATUSES].map(s => (
328:             <button key={s} onClick={() => setStatusFilter(s)}
329:               className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
330:                 statusFilter === s
331:                   ? "bg-yellow-400 text-black border-yellow-400"
332:                   : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
333:               }`}>
334:               {s === "all" ? "All" : s.replace(/_/g, " ")}
335:             </button>
336:           ))}
337:         </div>
338:         <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
339:           <div className="relative flex-1 min-w-[180px]">
340:             <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
341:             <input type="text" placeholder="Search title, vendor, or location…" value={search} onChange={e => setSearch(e.target.value)}
342:               className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
343:           </div>
344:           <select value={systemFilter} onChange={e => setSystemFilter(e.target.value)}
345:             className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
346:             <option value="all">All Systems</option>
347:             {Object.entries(SYSTEM_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
348:           </select>
349:         </div>
350:       </div>
351: 
352:       {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}
353: 
354:       {/* Table */}
355:       {loading && entries.length === 0 ? (
356:         <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading maintenance calendar...</div>
357:       ) : filtered.length === 0 ? (
358:         <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No maintenance entries match your filters.</div>
359:       ) : (
360:         <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
361:           <table className="w-full text-sm">
362:             <thead className="bg-gray-50 border-b border-gray-200">
363:               <tr>
364:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">System</th>
365:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Title</th>
366:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Frequency</th>
367:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Scheduled</th>
368:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Next Due</th>
369:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Vendor / Assigned</th>
370:                 <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
371:                 <th className="text-right px-4 py-3 font-semibold text-gray-700">Cost</th>
372:                 <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
373:               </tr>
374:             </thead>
375:             <tbody className="divide-y divide-gray-100">
376:               {paginated.map(e => {
377:                 const sys = SYSTEM_META[e.system] ?? SYSTEM_META.OTHER;
378:                 const busy = busyId === e.id;
379:                 return (
380:                   <tr key={e.id} className="hover:bg-gray-50 transition">
381:                     <td className="px-4 py-3">
382:                       <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${sys.cls}`}>{sys.label}</span>
383:                     </td>
384:                     <td className="px-4 py-3 max-w-[240px]">
385:                       <p className="font-medium text-gray-900 truncate" title={e.title}>{e.title}</p>
386:                       {e.location && <p className="text-xs text-gray-500 truncate">{e.location}</p>}
387:                     </td>
388:                     <td className="px-4 py-3 text-gray-600 text-xs">
389:                       <span className="inline-flex items-center gap-1"><ClipboardCheck className="w-3 h-3" /> {FREQUENCY_LABEL[e.frequency] ?? e.frequency}</span>
390:                     </td>
391:                     <td className="px-4 py-3 text-gray-500 text-xs">{e.scheduledDate ? new Date(e.scheduledDate).toLocaleDateString() : "—"}</td>
392:                     <td className="px-4 py-3 text-gray-500 text-xs">{e.nextDueDate ? new Date(e.nextDueDate).toLocaleDateString() : "—"}</td>
393:                     <td className="px-4 py-3 text-gray-600 text-xs">{e.vendor || e.assignedTo || "—"}</td>
394:                     <td className="px-4 py-3">
395:                       <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[e.status] ?? "bg-gray-100 text-gray-700"}`}>
396:                         {e.status.replace(/_/g, " ")}
397:                       </span>
398:                     </td>
399:                     <td className="px-4 py-3 text-right text-gray-900 font-medium">{e.cost ? `₱${e.cost.toLocaleString()}` : "—"}</td>
400:                     <td className="px-4 py-3">
401:                       <div className="flex items-center justify-center gap-1 flex-wrap">
402:                         {busy ? (
403:                           <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
404:                         ) : (
405:                           <>
406:                             <button onClick={() => setViewing(e)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View Details"><Eye className="w-4 h-4" /></button>
407:                             {["SCHEDULED", "OPEN", "AWAITING_PARTS"].includes(e.status) && (
408:                               <button onClick={() => handleStart(e)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Start Work"><Play className="w-4 h-4" /></button>
409:                             )}
410:                             {["IN_PROGRESS", "AWAITING_PARTS"].includes(e.status) && (
411:                               <button onClick={() => handleComplete(e)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete"><CheckCircle2 className="w-4 h-4" /></button>
412:                             )}
413:                             {!["COMPLETED", "CANCELLED"].includes(e.status) && (
414:                               <button onClick={() => handleCancel(e)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Ban className="w-4 h-4" /></button>
415:                             )}
416:                             <button onClick={() => startEditing(e)} className="p-1.5 rounded hover:bg-yellow-100 text-yellow-600 transition" title="Edit"><Edit className="w-4 h-4" /></button>
417:                             <button onClick={() => handleDelete(e)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
418:                           </>
419:                         )}
420:                       </div>
421:                     </td>
422:                   </tr>
423:                 );
424:               })}
425:             </tbody>
426:           </table>
427:         </div>
428:       )}
429: 
430:       {/* Pagination */}
431:       {totalPages > 1 && (
432:         <div className="flex items-center justify-between">
433:           <p className="text-xs text-gray-500">{filtered.length} entries total</p>
434:           <div className="flex items-center gap-2">
435:             <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronLeft className="w-4 h-4" /></button>
436:             <span className="text-sm font-medium text-gray-700">Page {page} of {totalPages}</span>
437:             <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronRight className="w-4 h-4" /></button>
438:           </div>
439:         </div>
440:       )}
441: 
442:       {/* Create / Edit / View Modals */}
443:       {showCreate && (
444:         <MaintenanceFormModal title="Schedule Maintenance" form={createForm} onChange={setCreateForm} onSave={handleCreate}
445:           onCancel={() => setShowCreate(false)} saveLabel="Schedule" />
446:       )}
447:       {editing && (
448:         <MaintenanceFormModal title="Edit Maintenance Entry" form={editForm} onChange={setEditForm} onSave={handleSaveEdit}
449:           onCancel={() => setEditing(null)} saveLabel="Save Changes" />
450:       )}
451:       {viewing && (
452:         <MaintenanceViewModal entry={viewing} onClose={() => setViewing(null)} />
453:       )}
454:     </div>
455:   );
456: }
457: 
458: /* ── Sub-components ── */
459: 
460: function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
461:   const COLORS: Record<string, string> = {
462:     blue: "text-blue-600 bg-blue-50 border-blue-200",
463:     green: "text-green-600 bg-green-50 border-green-200",
464:     red: "text-red-600 bg-red-50 border-red-200",
465:     purple: "text-purple-600 bg-purple-50 border-purple-200",
466:     amber: "text-amber-600 bg-amber-50 border-amber-200",
467:   };
468:   const c = COLORS[color] || COLORS.blue;
469:   return (
470:     <div className={`rounded-lg border p-4 ${c}`}>
471:       <div className="flex items-center justify-between mb-0.5">
472:         <p className="text-xs font-semibold text-gray-600">{label}</p>
473:         <Icon className={`w-4 h-4 ${c.split(" ")[0]}`} />
474:       </div>
475:       <p className={`text-2xl sm:text-3xl font-bold ${c.split(" ")[0]}`}>{value}</p>
476:     </div>
477:   );
478: }
479: 
480: function MaintenanceFormModal({ title, form, onChange, onSave, onCancel, saveLabel }: {
481:   title: string;
482:   form: typeof emptyForm;
483:   onChange: (f: typeof emptyForm) => void;
484:   onSave: () => void;
485:   onCancel: () => void;
486:   saveLabel: string;
487: }) {
488:   const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
489:     onChange({ ...form, [field]: e.target.value });
490: 
491:   return (
492:     <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
493:       <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
494:         <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
495:           <h2 className="text-xl font-bold">{title}</h2>
496:           <button onClick={onCancel} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
497:         </div>
498:         <div className="p-6 space-y-4">
499:           <div className="grid grid-cols-2 gap-4">
500:             <div className="col-span-2">
501:               <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
502:               <input type="text" value={form.title} onChange={set("title")} placeholder="e.g. HVAC Quarterly Service — East Wing" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
503:             </div>
504:             <div>
505:               <label className="block text-sm font-semibold text-gray-700 mb-1">System</label>
506:               <select value={form.system} onChange={set("system")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
507:                 {Object.entries(SYSTEM_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
508:               </select>
509:             </div>
510:             <div>
511:               <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
512:               <select value={form.type} onChange={set("type")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
513:                 {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
514:               </select>
515:             </div>
516:             <div>
517:               <label className="block text-sm font-semibold text-gray-700 mb-1">Frequency</label>
518:               <select value={form.frequency} onChange={set("frequency")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
519:                 {Object.entries(FREQUENCY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
520:               </select>
521:             </div>
522:             <div>
523:               <label className="block text-sm font-semibold text-gray-700 mb-1">Scheduled Date</label>
524:               <input type="date" value={form.scheduledDate} onChange={set("scheduledDate")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
525:             </div>
526:             <div>
527:               <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
528:               <input type="text" value={form.location} onChange={set("location")} placeholder="Wing / floor / plant area" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
529:             </div>
530:             <div>
531:               <label className="block text-sm font-semibold text-gray-700 mb-1">Vendor</label>
532:               <input type="text" value={form.vendor} onChange={set("vendor")} placeholder="External vendor (optional)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
533:             </div>
534:             <div>
535:               <label className="block text-sm font-semibold text-gray-700 mb-1">Assigned To</label>
536:               <input type="text" value={form.assignedTo} onChange={set("assignedTo")} placeholder="Engineer / team" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
537:             </div>
538:             <div>
539:               <label className="block text-sm font-semibold text-gray-700 mb-1">Estimated Cost (₱)</label>
540:               <input type="number" min="0" step="0.01" value={form.cost} onChange={set("cost")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
541:             </div>
542:             <div className="col-span-2">
543:               <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
544:               <textarea value={form.description} onChange={set("description")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
545:             </div>
546:             <div className="col-span-2">
547:               <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
548:               <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
549:             </div>
550:           </div>
551:         </div>
552:         <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
553:           <button onClick={onCancel} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
554:           <button onClick={onSave} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">{saveLabel}</button>
555:         </div>
556:       </div>
557:     </div>
558:   );
559: }
560: 
561: function MaintenanceViewModal({ entry, onClose }: { entry: MaintEntry; onClose: () => void }) {
562:   const sys = SYSTEM_META[entry.system] ?? SYSTEM_META.OTHER;
563:   const typeMeta = { PREVENTIVE: { label: "Preventive", cls: "bg-blue-100 text-blue-700" }, REPAIR: { label: "Repair", cls: "bg-red-100 text-red-700" }, INSPECTION: { label: "Inspection", cls: "bg-purple-100 text-purple-700" } }[entry.type] ?? { label: entry.type, cls: "bg-gray-100 text-gray-700" };
564: 
565:   return (
566:     <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
567:       <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
568:         <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
569:           <h2 className="text-xl font-bold">{entry.title}</h2>
570:           <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
571:         </div>
572:         <div className="p-6 space-y-5">
573:           <div className="flex flex-wrap gap-2">
574:             <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${sys.cls}`}>{sys.label}</span>
575:             <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${typeMeta.cls}`}>{typeMeta.label}</span>
576:             <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[entry.status] ?? "bg-gray-100 text-gray-700"}`}>{entry.status.replace(/_/g, " ")}</span>
577:           </div>
578:           <div className="grid grid-cols-2 gap-4">
579:             {[
580:               ["Frequency", FREQUENCY_LABEL[entry.frequency] ?? entry.frequency],
581:               ["Location", entry.location || "—"],
582:               ["Scheduled", entry.scheduledDate ? new Date(entry.scheduledDate).toLocaleDateString() : "—"],
583:               ["Next Due", entry.nextDueDate ? new Date(entry.nextDueDate).toLocaleDateString() : "—"],
584:               ["Completed", entry.completedDate ? new Date(entry.completedDate).toLocaleDateString() : "—"],
585:               ["Assigned To", entry.assignedTo || "—"],
586:               ["Vendor", entry.vendor || "—"],
587:               ["Cost", entry.cost ? `₱${entry.cost.toLocaleString()}` : "—"],
588:             ].map(([label, value]) => (
589:               <div key={label} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
590:                 <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
591:                 <p className="text-sm font-medium text-gray-900 mt-0.5">{value}</p>
592:               </div>
593:             ))}
594:           </div>
595:           {entry.description && (
596:             <div>
597:               <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</p>
598:               <p className="text-sm text-gray-700 whitespace-pre-wrap">{entry.description}</p>
599:             </div>
600:           )}
601:           {entry.notes && (
602:             <div>
603:               <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
604:               <p className="text-sm text-gray-700 whitespace-pre-wrap">{entry.notes}</p>
605:             </div>
606:           )}
607:         </div>
608:         <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
609:           <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Close</button>
610:         </div>
611:       </div>
612:     </div>
613:   );
614: }

(End of file - total 614 lines)
</content>
```

---

## Assistant (Build · Big Pickle · 3608.5s)

---

## User

continue working

---

## Assistant (Build · Big Pickle · 472.8s)

_Thinking:_

Let me now understand the full picture. I need to add housekeeping and maintenance analytics to the Facility Dashboard. The dashboard currently shows resident/incident/staff/admissions data. I need to:

1. Add Service Requests (tickets) analytics - these are the housekeeping and maintenance tickets. The ServiceRequestsBoard already queries "service-requests" with categories for filtering.
2. Add Facility Maintenance analytics - the preventive maintenance entries.

For the Facility Dashboard, I should show:
- Housekeeping ticket stats (total, completed, in progress, by category, etc.)
- Maintenance ticket stats (same)
- Both broken down by type/status

The ServiceRequest model has a `category` field with values like `HOUSEKEEPING`, `LAUNDRY`, `ROOM_SERVICE`, `REPAIRS`, `AIRCON_HVAC`. The assignedTeam field also categorizes them.

For the dashboard, I should fetch both `service-requests` and `facility-maintenance` data and show analytics.

Let me look at the ServiceRequestsBoard more carefully. It already fetches tickets and computes stats. The dashboard should show similar stat boxes and charts but focused on:
- Housekeeping tickets (HOUSEKEEPING, LAUNDRY categories)
- Maintenance tickets (REPAIRS, AIRCON_HVAC categories)
- Facility maintenance (preventive, completed, etc.)

I need to modify FacilityDashboard.tsx to add:
1. Query for service-requests (with include=resident)
2. Query for facility-maintenance
3. Compute housekeeping and maintenance analytics
4. Display stat boxes and charts for both

Let me also check the serviceMeta file for the category labels.

**Tool: read**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\components\\portal\\views\\services\\serviceMeta.ts"
}
```

**Output:**
```
<path>C:\Users\ResolutAI\Documents\assisted-living\apps\frontend\src\components\portal\views\services\serviceMeta.ts</path>
<type>file</type>
<content>
1: import {
2:   AirVent, Sparkles, UtensilsCrossed, Shirt, Wrench, Bell, AlarmClock,
3:   BedDouble, Scissors, Coffee, Clapperboard, TreePine, DoorOpen, HeartHandshake,
4:   Church, type LucideIcon,
5: } from "lucide-react";
6: 
7: /**
8:  * Shared Phase 7 metadata — service-request categories, hotel-style workflow
9:  * states, auto-assign team routing, and the concierge "hotel on the hospital"
10:  * premium catalog. Used by the staff boards and the resident-facing view so
11:  * labels/colors/routing stay in lockstep with the Prisma enums.
12:  */
13: 
14: export const CATEGORY_META: Record<string, { label: string; sub: string; icon: LucideIcon; cls: string; subTypes: string[] }> = {
15:   AIRCON_HVAC: { label: "Aircon / HVAC", sub: "Temp adjust · filter · repair", icon: AirVent, cls: "text-sky-600 bg-sky-50 border-sky-200", subTypes: ["Temp Adjust", "Filter", "Repair"] },
16:   HOUSEKEEPING: { label: "Housekeeping", sub: "Room clean · linen change", icon: Sparkles, cls: "text-emerald-600 bg-emerald-50 border-emerald-200", subTypes: ["Room Clean", "Linen Change"] },
17:   ROOM_SERVICE: { label: "Room Service", sub: "Meals · snacks · beverages", icon: UtensilsCrossed, cls: "text-orange-600 bg-orange-50 border-orange-200", subTypes: ["Meals", "Snacks", "Beverages"] },
18:   LAUNDRY: { label: "Laundry & Pressing", sub: "Wash · dry · press", icon: Shirt, cls: "text-violet-600 bg-violet-50 border-violet-200", subTypes: ["Laundry & Pressing"] },
19:   REPAIRS: { label: "Repairs", sub: "Plumbing · electrical · Wi-Fi/TV", icon: Wrench, cls: "text-red-600 bg-red-50 border-red-200", subTypes: ["Plumbing", "Electrical", "Wi-Fi/TV"] },
20: };
21: 
22: export const PRIORITY_PILL: Record<string, string> = {
23:   ROUTINE: "bg-blue-50 text-blue-700 border border-blue-200",
24:   URGENT: "bg-orange-50 text-orange-700 border border-orange-200",
25:   EMERGENCY: "bg-red-100 text-red-700 border border-red-300 animate-pulse",
26: };
27: 
28: export const REQUEST_STATUS_PILL: Record<string, string> = {
29:   OPEN: "bg-gray-100 text-gray-700",
30:   ASSIGNED: "bg-blue-100 text-blue-700",
31:   IN_PROGRESS: "bg-amber-100 text-amber-700",
32:   COMPLETED: "bg-green-100 text-green-700",
33:   CONFIRMED: "bg-emerald-100 text-emerald-800",
34:   CANCELLED: "bg-red-100 text-red-700",
35: };
36: 
37: export const TEAM_LABEL: Record<string, string> = {
38:   HOUSEKEEPING_TEAM: "Housekeeping",
39:   MAINTENANCE_ENGINEER: "Maintenance",
40:   KITCHEN: "Kitchen",
41:   IT_SUPPORT: "IT Support",
42:   CONCIERGE: "Concierge",
43: };
44: 
45: /**
46:  * Ticket auto-assign routing → the crew portal that works it.
47:  *   Maintenance  ← all Repairs (incl. Wi-Fi/TV) + Aircon/HVAC
48:  *   Housekeeping ← Housekeeping + Laundry + Room Service
49:  */
50: export function autoAssignTeam(category: string, _subType?: string): string {
51:   const map: Record<string, string> = {
52:     AIRCON_HVAC: "MAINTENANCE_ENGINEER",
53:     REPAIRS: "MAINTENANCE_ENGINEER",
54:     HOUSEKEEPING: "HOUSEKEEPING_TEAM",
55:     LAUNDRY: "HOUSEKEEPING_TEAM",
56:     ROOM_SERVICE: "HOUSEKEEPING_TEAM",
57:   };
58:   return map[category] ?? "MAINTENANCE_ENGINEER";
59: }
60: 
61: export const SOURCE_LABEL: Record<string, string> = {
62:   RESIDENT_PORTAL: "Resident Portal",
63:   AI_COMPANION: "AI Companion Voice",
64:   CALL_BELL: "Call Bell",
65:   FRONT_DESK: "Front Desk",
66: };
67: 
68: export const CONCIERGE_CATALOG: Record<string, { label: string; desc: string; icon: LucideIcon; cls: string; defaultPrice: number; billable: boolean }> = {
69:   CONCIERGE_DESK: { label: "Concierge Desk", desc: "Errands, bookings & special arrangements", icon: Bell, cls: "text-yellow-600 bg-yellow-50 border-yellow-200", defaultPrice: 0, billable: false },
70:   WAKE_UP_CALL: { label: "Wake-Up & Reminder Calls", desc: "Morning calls with medication reminders", icon: AlarmClock, cls: "text-sky-600 bg-sky-50 border-sky-200", defaultPrice: 0, billable: false },
71:   TURNDOWN: { label: "Turndown Service", desc: "Evening bed prep & room refresh", icon: BedDouble, cls: "text-indigo-600 bg-indigo-50 border-indigo-200", defaultPrice: 0, billable: false },
72:   SALON_BARBER: { label: "Salon & Barber", desc: "Haircuts, styling & grooming", icon: Scissors, cls: "text-pink-600 bg-pink-50 border-pink-200", defaultPrice: 25, billable: true },
73:   CAFE_BISTRO: { label: "Café / Bistro & Snack Cart", desc: "Barista drinks & roving snack cart", icon: Coffee, cls: "text-amber-700 bg-amber-50 border-amber-200", defaultPrice: 8, billable: true },
74:   MOVIE_GAME_NIGHT: { label: "Movie & Game Nights", desc: "Cinema evenings & group games", icon: Clapperboard, cls: "text-purple-600 bg-purple-50 border-purple-200", defaultPrice: 0, billable: false },
75:   GARDEN_LOUNGE: { label: "Garden Lounge Reservation", desc: "Private garden lounge time slot", icon: TreePine, cls: "text-green-600 bg-green-50 border-green-200", defaultPrice: 0, billable: false },
76:   GUEST_SUITE: { label: "Guest Suite for Family Stay", desc: "Overnight suite for visiting family", icon: DoorOpen, cls: "text-teal-600 bg-teal-50 border-teal-200", defaultPrice: 120, billable: true },
77:   SPA_MASSAGE: { label: "Massage & Spa Therapy", desc: "Gentle mobility & relaxation therapy", icon: HeartHandshake, cls: "text-rose-600 bg-rose-50 border-rose-200", defaultPrice: 45, billable: true },
78:   CHAPLAIN: { label: "Chaplain / Spiritual Care Visit", desc: "Pastoral & spiritual care visits", icon: Church, cls: "text-slate-600 bg-slate-50 border-slate-200", defaultPrice: 0, billable: false },
79: };
80: 
81: export const BOOKING_STATUS_PILL: Record<string, string> = {
82:   REQUESTED: "bg-amber-100 text-amber-700",
83:   CONFIRMED: "bg-blue-100 text-blue-700",
84:   IN_PROGRESS: "bg-indigo-100 text-indigo-700",
85:   COMPLETED: "bg-green-100 text-green-700",
86:   CANCELLED: "bg-gray-100 text-gray-600",
87: };
88: 
89: export const SYSTEM_META: Record<string, { label: string; cls: string }> = {
90:   HVAC: { label: "HVAC", cls: "bg-sky-100 text-sky-700" },
91:   GENERATOR: { label: "Generator", cls: "bg-amber-100 text-amber-700" },
92:   ELEVATOR: { label: "Elevator", cls: "bg-indigo-100 text-indigo-700" },
93:   FIRE_SAFETY: { label: "Fire & Safety", cls: "bg-red-100 text-red-700" },
94:   PEST_CONTROL: { label: "Pest Control", cls: "bg-green-100 text-green-700" },
95:   OTHER: { label: "Other", cls: "bg-gray-100 text-gray-700" },
96: };
97: 
98: export const FREQUENCY_DAYS: Record<string, number> = {
99:   WEEKLY: 7,
100:   MONTHLY: 30,
101:   QUARTERLY: 91,
102:   SEMI_ANNUAL: 182,
103:   ANNUAL: 365,
104: };
105: 
106: export const FREQUENCY_LABEL: Record<string, string> = {
107:   WEEKLY: "Weekly",
108:   MONTHLY: "Monthly",
109:   QUARTERLY: "Quarterly",
110:   SEMI_ANNUAL: "Semi-annual",
111:   ANNUAL: "Annual",
112: };

(End of file - total 112 lines)
</content>
```

---

## Assistant (Build · Big Pickle · 43.2s)

_Thinking:_

Now I have a clear picture. Let me plan what I need to do:

1. Modify `FacilityDashboard.tsx` to add:
   - Fetch `service-requests` data (with include=resident)
   - Fetch `facility-maintenance` data
   - Compute housekeeping analytics (tickets with categories HOUSEKEEPING, LAUNDRY, ROOM_SERVICE)
   - Compute maintenance analytics (tickets with categories REPAIRS, AIRCON_HVAC, plus facility-maintenance entries)
   - Display stat boxes, charts, and recent activity

Let me also check what the `useStats` returns and what other imports are used.

The current dashboard already has several useLiveQuery calls. I need to add:

```tsx
const { data: serviceRows } = useLiveQuery<Record<string, unknown>>(
  "service-requests", { query: "include=resident&take=500", tables: ["ServiceRequest"] }
);
const { data: maintRows } = useLiveQuery<Record<string, unknown>>(
  "facility-maintenance", { query: "take=400", tables: ["FacilityMaintenance"] }
);
```

Then compute analytics:

For housekeeping: tickets with category in (HOUSEKEEPING, LAUNDRY, ROOM_SERVICE)
For maintenance tickets: tickets with category in (REPAIRS, AIRCON_HVAC)
For facility maintenance: all entries from facility-maintenance

I need to adapt the service-request rows similarly to how ServiceRequestsBoard does it.

Let me write the implementation. I'll add:
1. Two new useLiveQuery calls for service-requests and facility-maintenance
2. Computed analytics for housekeeping and maintenance
3. Stat blocks for both
4. A chart showing ticket distribution
5. Recent activity sections

Let me now write the code. I need to be careful to match the existing style.

Here's my plan for the dashboard additions:
- After the "Staff Availability" section at the bottom, or interleaved after "Critical Incidents" section, I'll add analytics sections.

Actually, let me think about layout. The current dashboard has:
1. Header with shift greeting
2. Row of 5 stat boxes (residents, beds, staff, incidents, admissions)
3. Two charts (occupancy trend, care distribution)
4. Two charts (staff by dept, admissions pipeline)
5. Two list panels (critical incidents, recent admissions)
6. Staff availability bar

I should add:
After the critical incidents / recent admissions row, add a new section for "Housekeeping & Maintenance Analytics" with:
- Stat boxes for housekeeping and maintenance
- A chart for ticket types
- Recent completed tickets

Let me now implement this.

The key data I need:

From service-requests:
- Adapt each ticket: category, status, priority, assignedTeam, completedAt, createdAt, residentName, roomNumber
- Housekeeping tickets: categories HOUSEKEEPING, LAUNDRY, ROOM_SERVICE
- Maintenance tickets: categories REPAIRS, AIRCON_HVAC

From facility-maintenance:
- Adapt each entry: system, status, type, scheduledDate, completedDate, cost, title
- Overall stats

Let me write the data adaptation functions within the component.

I'll structure the additions like this:

```tsx
// New data fetches
const { data: serviceRows } = useLiveQuery<Record<string, unknown>>(
  "service-requests", { query: "include=resident&take=500", tables: ["ServiceRequest"] }
);
const { data: maintRows } = useLiveQuery<Record<string, unknown>>(
  "facility-maintenance", { query: "take=400", tables: ["FacilityMaintenance"] }
);

// Adapt functions
const adaptTicket = ...
const adaptMaint = ...

// Computed analytics
const housekeepingTickets = ...
const maintenanceTickets = ...
const facilityMaintEntries = ...

// Stats
const hkStats = ...
const mtStats = ...
const fmStats = ...
```

Now let me write the actual code. I need to be careful - the adaptTicket function in ServiceRequestsBoard expects the resident to be included. Let me look at how the query works. In ServiceRequestsBoard it uses `query: "include=resident&take=400"`. The `useLiveQuery` hook returns rows that include the relation data. The `rel` function in ServiceRequestsBoard accesses `r.resident` and extracts fields from it.

So the approach is:
```tsx
const rel = (v: unknown): Record<string, unknown> => 
  (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

const adaptTicket = (r: Record<string, unknown>) => {
  const resident = rel(r.resident);
  return {
    id: String(r.id ?? ""),
    residentName: `${String(resident.firstName ?? "")} ${String(resident.lastName ?? "")}`.trim() || "—",
    roomNumber: String(r.roomNumber ?? resident.roomNumber ?? ""),
    category: String(r.category ?? "HOUSEKEEPING"),
    subType: String(r.subType ?? ""),
    status: String(r.status ?? "OPEN"),
    priority: String(r.priority ?? "ROUTINE"),
    assignedTeam: r.assignedTeam ? String(r.assignedTeam) : "",
    completedAt: r.completedAt ? String(r.completedAt) : "",
    createdAt: String(r.createdAt ?? ""),
    charge: Number(r.charge ?? 0),
    rating: Number(r.rating ?? 0),
    details: String(r.details ?? ""),
  };
};
```

Let me now construct the full edit. I need to modify FacilityDashboard.tsx.

I'll add imports for the new icons and the service meta.

Let me check what's currently imported:
```tsx
import { useMemo, useState, useEffect } from "react";
import {
  Users, AlertTriangle, Building2, UserPlus, RefreshCw, Sun, Sunset, Moon,
  Activity, BedDouble, ClipboardList, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
import { adaptResident, adaptIncident, adaptStaff, humanize } from "@/lib/adapters";
```

I need to add icons like Sparkles, Wrench, Ticket, CheckCircle2, Timer, etc. from lucide-react.

Let me also check what the FacilityDashboard currently renders when the tickets data is empty - it should just show "No data" gracefully.

Now let me write the full edit. I'll add the new queries and analytics sections to the dashboard.

The approach: Add two new sections after the Staff Availability section:
1. "Housekeeping Analytics" - stat boxes, chart, recent tickets
2. "Maintenance Analytics" - stat boxes, chart, recent entries

Actually, looking at the layout more carefully, I think a combined "Service & Maintenance Overview" section would be cleaner. Let me plan:

1. New row of mini stat boxes specific to housekeeping & maintenance
2. A chart showing ticket distribution by category for housekeeping vs maintenance
3. Two side-by-side panels showing recent activity

Let me write it now. I'll add the sections at the end of the component, after the Staff Availability section.

Actually, let me re-read the user request more carefully:

"add dashboard analytics for housekeeping and maintenance analytics, all the completed tickets, type of tickets and such, same as housekeeping tickets should be seen in the facility admin portal dashboard"

So they want to see:
- Housekeeping analytics (tickets)
- Maintenance analytics (tickets)
- Completed tickets
- Types of tickets
- Same as what the housekeeping tickets view shows but on the dashboard

So I should mirror the stat boxes from ServiceRequestsBoard but filtered by team, plus show a chart of ticket types and recent tickets.

Let me also import the CATEGORY_META for labels.

Alright, let me write the full updated component. I'll be adding:

1. New imports
2. New useLiveQuery hooks
3. New data adapters
4. New computed analytics
5. New sections in the JSX
6. The StatBox and mini chart components (reusing existing Card component)

Let me write this carefully now.

Now I have the full picture. I need to add housekeeping and maintenance ticket analytics to the FacilityDashboard. The data comes from two models already registered: `service-requests` (tickets with categories like HOUSEKEEPING, LAUNDRY, REPAIRS, AIRCON_HVAC) and `facility-maintenance` (preventive schedules).

**Tool: edit**

**Input:**
```json
{
  "filePath": "C:\\Users\\ResolutAI\\Documents\\assisted-living\\apps\\frontend\\src\\components\\portal\\views\\FacilityDashboard.tsx",
  "oldString": "\"use client\";\n\nimport { useMemo, useState, useEffect } from \"react\";\nimport {\n  Users, AlertTriangle, Building2, UserPlus, RefreshCw, Sun, Sunset, Moon,\n  Activity, BedDouble, ClipboardList, ChevronRight,\n  type LucideIcon,\n} from \"lucide-react\";\nimport {\n  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,\n  XAxis, YAxis, Tooltip, CartesianGrid, Legend,\n} from \"recharts\";\nimport { useLiveQuery, useStats } from \"@/lib/useLiveQuery\";\nimport { adaptResident, adaptIncident, adaptStaff, humanize } from \"@/lib/adapters\";",
  "newString": "\"use client\";\n\nimport { useMemo, useState, useEffect } from \"react\";\nimport {\n  Users, AlertTriangle, Building2, UserPlus, RefreshCw, Sun, Sunset, Moon,\n  Activity, BedDouble, ClipboardList, ChevronRight, Sparkles, Wrench, Ticket,\n  CheckCircle2, Timer, AlertCircle, Star, CalendarClock,\n  type LucideIcon,\n} from \"lucide-react\";\nimport {\n  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,\n  XAxis, YAxis, Tooltip, CartesianGrid, Legend,\n} from \"recharts\";\nimport { useLiveQuery, useStats } from \"@/lib/useLiveQuery\";\nimport { adaptResident, adaptIncident, adaptStaff, humanize } from \"@/lib/adapters\";\nimport { CATEGORY_META } from \"@/components/portal/views/services/serviceMeta\";"
}
```

**Output:**
```
Edit applied successfully.
```

---

## Assistant (Build · Big Pickle · 623.4s)

---

## User

continue

---

## Assistant (Build · Big Pickle)

---

