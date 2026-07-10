/**
 * GET /api/vitals-bp
 *
 * Returns realistic BP readings for residents based on:
 * - Age and medical history
 * - Current medications with antihypertensive effects
 * - Circadian rhythm (time of day)
 * - Emotional state (from vision analysis)
 *
 * Uses the bpSimulator which implements ACC/AHA guidelines
 * and physiologically accurate BP modeling.
 */

import { validateSession } from "@/lib/auth";
import { bpSimulator, type ResidentBPProfile, type BPReading } from "@/lib/bpSimulator";
import { NextRequest, NextResponse } from "next/server";
import { useLiveQuery } from "@/lib/useLiveQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// In-memory cache for resident BP profiles (real app would use DB)
const bpProfiles = new Map<string, ResidentBPProfile>();

export async function GET(request: NextRequest) {
  const role = await validateSession();
  if (!role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const residentId = searchParams.get("residentId");
    const emotionalState = searchParams.get("emotionalState") as
      | "calm"
      | "anxious"
      | "stressed" || "calm";

    // Demo mode: return realistic simulated BP
    if (process.env.DATABASE_URL === "postgresql://placeholder") {
      const mockResidents = [
        {
          id: "r1",
          firstName: "Arthur",
          lastName: "Pendelton",
          dateOfBirth: new Date(1946, 6, 15).toISOString(),
          medicalHistory: "Hypertension, Type 2 Diabetes",
          medications: [
            { name: "Lisinopril", dosage: "10mg" },
            { name: "Metformin", dosage: "500mg" },
          ],
        },
        {
          id: "r2",
          firstName: "Eleanor",
          lastName: "Fitzroy",
          dateOfBirth: new Date(1941, 2, 20).toISOString(),
          medicalHistory: "Alzheimer's, Arthritis",
          medications: [],
        },
        {
          id: "r3",
          firstName: "Robert",
          lastName: "Chen",
          dateOfBirth: new Date(1952, 8, 10).toISOString(),
          medicalHistory: "High Cholesterol",
          medications: [{ name: "Atorvastatin", dosage: "20mg" }],
        },
        {
          id: "r4",
          firstName: "Margaret",
          lastName: "Wilson",
          dateOfBirth: new Date(1944, 4, 5).toISOString(),
          medicalHistory: "Atrial Fibrillation, Heart Failure",
          medications: [{ name: "Warfarin", dosage: "5mg" }],
        },
        {
          id: "r5",
          firstName: "James",
          lastName: "Murphy",
          dateOfBirth: new Date(1948, 11, 18).toISOString(),
          medicalHistory: "Post-Surgery Recovery",
          medications: [{ name: "Acetaminophen", dosage: "500mg" }],
        },
      ];

      if (residentId) {
        // Single resident BP
        const resident = mockResidents.find((r) => r.id === residentId);
        if (!resident) {
          return NextResponse.json(
            { error: "Resident not found" },
            { status: 404 }
          );
        }

        // Get or create BP profile
        let profile = bpProfiles.get(residentId);
        if (!profile) {
          profile = bpSimulator.createProfile(resident);
          bpProfiles.set(residentId, profile);
        }

        // Generate current reading
        const reading = bpSimulator.generateBPReading(
          profile,
          emotionalState,
          new Date().getHours()
        );

        // Get alert severity
        const severity = bpSimulator.getAlertSeverity(reading);

        // Get history
        const history = bpSimulator.getHistory(residentId).slice(-12); // Last hour

        return NextResponse.json(
          {
            residentId,
            current: reading,
            history,
            profile,
            alertSeverity: severity,
          },
          { status: 200 }
        );
      } else {
        // All residents BP
        const allReadings = mockResidents.map((resident) => {
          let profile = bpProfiles.get(resident.id);
          if (!profile) {
            profile = bpSimulator.createProfile(resident);
            bpProfiles.set(resident.id, profile);
          }

          const reading = bpSimulator.generateBPReading(
            profile,
            emotionalState,
            new Date().getHours()
          );

          return {
            residentId: resident.id,
            firstName: resident.firstName,
            lastName: resident.lastName,
            current: reading,
            severity: bpSimulator.getAlertSeverity(reading),
          };
        });

        return NextResponse.json({ readings: allReadings }, { status: 200 });
      }
    }

    // Production mode: query Supabase
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  } catch (error) {
    console.error("[vitals-bp] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate BP readings" },
      { status: 500 }
    );
  }
}
