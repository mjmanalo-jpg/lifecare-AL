import { NextResponse } from "next/server";

// Mock residents with sleep data
const residents = [
  {
    id: "1",
    name: "John Doe",
    room: "101",
    sleeping: false,
    sleepScore: 0.1,
    position: "sitting",
    lastUpdate: new Date().toISOString(),
    alerts: 0
  },
  {
    id: "2",
    name: "Jane Smith",
    room: "102",
    sleeping: true,
    sleepScore: 0.85,
    position: "lying",
    lastUpdate: new Date(Date.now() - 5000).toISOString(),
    alerts: 0
  },
  {
    id: "3",
    name: "Bob Wilson",
    room: "103",
    sleeping: false,
    sleepScore: 0.2,
    position: "sitting",
    lastUpdate: new Date().toISOString(),
    alerts: 1
  }
];

export async function GET(req) {
  try {
    return NextResponse.json({
      residents: residents,
      summary: {
        total: residents.length,
        sleeping: residents.filter(r => r.sleeping).length,
        awake: residents.filter(r => !r.sleeping).length,
        alerts: residents.reduce((sum, r) => sum + r.alerts, 0)
      }
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { residentId, sleeping, sleepScore, position } = body;

    const resident = residents.find(r => r.id === residentId);
    if (!resident) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Update resident data
    resident.sleeping = sleeping;
    resident.sleepScore = sleepScore;
    resident.position = position;
    resident.lastUpdate = new Date().toISOString();

    // Alert if unexpected sleep
    if (sleeping && resident.alerts === 0) {
      resident.alerts = 1;
    }

    return NextResponse.json(resident);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
