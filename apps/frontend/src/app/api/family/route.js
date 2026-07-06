import { NextResponse } from "next/server";

// Mock family portal data
const familyData = {
  resident: {
    id: "1",
    name: "John Doe",
    room: "101",
    age: 78,
    careLevel: "ASSISTED"
  },
  dailyReport: {
    date: new Date().toISOString(),
    mood: "Happy",
    mealsEaten: 95,
    activityLevel: "Moderate",
    sleepQuality: 8,
    medicationTaken: true,
    incidents: 0,
    notes: "Had great day! Enjoyed activities with friends.",
    caregiver: "Sarah Johnson"
  },
  alerts: [
    {
      id: "1",
      type: "EMERGENCY",
      severity: "HIGH",
      title: "Fall Detected",
      message: "Possible fall in room 101",
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      status: "RESOLVED",
      response: "Staff responded in 2 minutes. All OK."
    },
    {
      id: "2",
      type: "MEDICATION",
      severity: "MEDIUM",
      title: "Medication Reminder",
      message: "Blood pressure medication due at 2:00 PM",
      timestamp: new Date().toISOString(),
      status: "PENDING"
    }
  ],
  messages: [
    {
      id: "1",
      from: "Sarah Johnson (Caregiver)",
      text: "John had a wonderful day! Very social and cheerful.",
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      read: true
    },
    {
      id: "2",
      from: "Dr. Williams (Doctor)",
      text: "Blood pressure is stable. Continue current medication.",
      timestamp: new Date(Date.now() - 86400000).toISOString(),
      read: true
    }
  ],
  photos: [
    {
      id: "1",
      title: "Garden time",
      timestamp: new Date().toISOString(),
      caption: "John enjoying flowers in the garden"
    },
    {
      id: "2",
      title: "Lunch with friends",
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      caption: "Lunch with Margaret and Robert"
    },
    {
      id: "3",
      title: "Activity session",
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      caption: "Playing cards with other residents"
    }
  ],
  appointments: [
    {
      id: "1",
      type: "Doctor",
      doctor: "Dr. Williams",
      date: new Date(Date.now() + 86400000).toISOString(),
      time: "2:00 PM",
      reason: "Monthly checkup",
      confirmed: true
    },
    {
      id: "2",
      type: "Visitor",
      visitor: "Family visit",
      date: new Date(Date.now() + 172800000).toISOString(),
      time: "3:00 PM",
      confirmed: false
    }
  ],
  expenses: {
    month: "July 2026",
    total: 5000,
    breakdown: [
      { item: "Care Services", amount: 3500 },
      { item: "Medications", amount: 800 },
      { item: "Activities", amount: 400 },
      { item: "Meals", amount: 300 }
    ]
  },
  careGoals: [
    {
      id: "1",
      goal: "Increase mobility",
      progress: 75,
      startDate: new Date(Date.now() - 2592000000).toISOString(),
      notes: "Walking 30 min daily with assistance"
    },
    {
      id: "2",
      goal: "Improve social engagement",
      progress: 90,
      startDate: new Date(Date.now() - 1209600000).toISOString(),
      notes: "Attending activities 5x per week"
    }
  ]
};

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section");

    if (section === "alerts") {
      return NextResponse.json(familyData.alerts);
    }
    if (section === "messages") {
      return NextResponse.json(familyData.messages);
    }
    if (section === "photos") {
      return NextResponse.json(familyData.photos);
    }
    if (section === "appointments") {
      return NextResponse.json(familyData.appointments);
    }
    if (section === "expenses") {
      return NextResponse.json(familyData.expenses);
    }
    if (section === "goals") {
      return NextResponse.json(familyData.careGoals);
    }

    return NextResponse.json(familyData);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, message, appointmentId } = body;

    if (action === "sendMessage") {
      familyData.messages.unshift({
        id: Date.now().toString(),
        from: "Family Member",
        text: message,
        timestamp: new Date().toISOString(),
        read: false
      });
      return NextResponse.json({ success: true, message: "Message sent" });
    }

    if (action === "confirmAppointment") {
      const apt = familyData.appointments.find(a => a.id === appointmentId);
      if (apt) apt.confirmed = true;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
