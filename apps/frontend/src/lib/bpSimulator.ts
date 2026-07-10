/**
 * Realistic Blood Pressure Simulator
 * Generates clinically accurate BP readings based on:
 * - Age and baseline health
 * - Medical history (hypertension, heart disease)
 * - Medications (antihypertensives)
 * - Activity state and emotional stress
 * - Circadian rhythm (diurnal variation)
 * - Natural physiological variation
 */

interface ResidentBPProfile {
  residentId: string;
  age: number;
  medicalHistory: string;
  medications: string[];
  baselineSystolic: number;
  baselineDiastolic: number;
  medicalRisk: "low" | "moderate" | "high";
}

interface BPReading {
  systolic: number;
  diastolic: number;
  heartRate: number;
  timestamp: Date;
  category: "normal" | "elevated" | "stage1" | "stage2" | "critical";
  trend: "stable" | "increasing" | "decreasing";
}

class BPSimulator {
  private bpHistory: Map<string, BPReading[]> = new Map();
  private readonly MAX_HISTORY = 288; // 24 hours at 5-min intervals

  /**
   * Create BP profile for a resident
   */
  createProfile(resident: any): ResidentBPProfile {
    const age = this.calculateAge(resident.dateOfBirth);
    const medicalHistory = resident.medicalHistory || "";

    // Determine baseline BP from age and medical history
    const { systolic, diastolic, risk } = this.determineBaseline(
      age,
      medicalHistory
    );

    // Extract medication antihypertensive effects
    const medications = (resident.medications || []).map((m: any) => m.name);

    return {
      residentId: resident.id,
      age,
      medicalHistory,
      medications,
      baselineSystolic: systolic,
      baselineDiastolic: diastolic,
      medicalRisk: risk,
    };
  }

  /**
   * Generate realistic BP reading for a resident
   */
  generateBPReading(
    profile: ResidentBPProfile,
    emotionalState: "calm" | "anxious" | "stressed" = "calm",
    timeOfDay: number = new Date().getHours()
  ): BPReading {
    let systolic = profile.baselineSystolic;
    let diastolic = profile.baselineDiastolic;

    // 1. Age adjustment (older = higher baseline)
    const ageAdjustment = Math.max(0, (profile.age - 40) * 0.3);
    systolic += ageAdjustment;
    diastolic += ageAdjustment * 0.4;

    // 2. Medical history adjustment
    if (profile.medicalHistory.toLowerCase().includes("hypertension")) {
      systolic += 15;
      diastolic += 10;
    }
    if (profile.medicalHistory.toLowerCase().includes("diabetes")) {
      systolic += 8;
      diastolic += 5;
    }
    if (profile.medicalHistory.toLowerCase().includes("heart failure")) {
      systolic += 20;
      diastolic += 12;
    }

    // 3. Medication effects (antihypertensives reduce BP)
    let medReduction = 0;
    for (const med of profile.medications) {
      if (med.includes("Lisinopril") || med.includes("Enalapril")) {
        medReduction += 12; // ACE inhibitor
      } else if (med.includes("Metoprolol") || med.includes("Atenolol")) {
        medReduction += 10; // Beta blocker
      } else if (med.includes("Amlodipine") || med.includes("Nifedipine")) {
        medReduction += 8; // Calcium channel blocker
      } else if (med.includes("Hydrochlorothiazide")) {
        medReduction += 10; // Diuretic
      }
    }
    systolic -= medReduction;
    diastolic -= medReduction * 0.6;

    // 4. Emotional state (stress increases BP acutely)
    const emotionFactors = {
      calm: 0,
      anxious: 8,
      stressed: 15,
    };
    const emotionBoost = emotionFactors[emotionalState] || 0;
    systolic += emotionBoost;
    diastolic += emotionBoost * 0.6;

    // 5. Circadian rhythm (morning surge, dip at night)
    // BP naturally ~10-20% higher in morning, ~10-15% lower at night
    let circadianFactor = 0;
    if (timeOfDay >= 6 && timeOfDay < 8) {
      circadianFactor = 12; // Morning surge (6-8am)
    } else if (timeOfDay >= 8 && timeOfDay < 18) {
      circadianFactor = 5; // Daytime elevation
    } else if (timeOfDay >= 22 || timeOfDay < 6) {
      circadianFactor = -10; // Nighttime dip
    } else {
      circadianFactor = 0; // Evening normalized
    }
    systolic += circadianFactor;
    diastolic += circadianFactor * 0.4;

    // 6. Natural physiological variation (white noise)
    // ±5-8 mmHg natural minute-to-minute variation
    const sysVariation = (Math.random() - 0.5) * 16;
    const diaVariation = (Math.random() - 0.5) * 10;
    systolic += sysVariation;
    diastolic += diaVariation;

    // 7. Heart rate (varies 60-100 resting, up with stress/emotion)
    let heartRate = 70 + (emotionBoost * 0.6 + ageAdjustment * 0.3);
    heartRate += (Math.random() - 0.5) * 15;
    heartRate = Math.max(50, Math.min(120, Math.round(heartRate)));

    // Ensure realistic ranges
    systolic = Math.max(85, Math.min(220, Math.round(systolic)));
    diastolic = Math.max(55, Math.min(140, Math.round(diastolic)));
    diastolic = Math.min(diastolic, systolic - 10); // Ensure SYS > DIA

    // Determine BP category
    const category = this.categorizeBP(systolic, diastolic);

    // Determine trend from history
    const history = this.bpHistory.get(profile.residentId) || [];
    let trend: "stable" | "increasing" | "decreasing" = "stable";

    if (history.length >= 3) {
      const recent = history.slice(-3);
      const avgSysRecent = recent.reduce((s, r) => s + r.systolic, 0) / 3;
      const sysChange = systolic - avgSysRecent;

      if (sysChange > 5) trend = "increasing";
      else if (sysChange < -5) trend = "decreasing";
    }

    const reading: BPReading = {
      systolic,
      diastolic,
      heartRate,
      timestamp: new Date(),
      category,
      trend,
    };

    // Store in history
    if (!this.bpHistory.has(profile.residentId)) {
      this.bpHistory.set(profile.residentId, []);
    }
    const h = this.bpHistory.get(profile.residentId)!;
    h.push(reading);
    if (h.length > this.MAX_HISTORY) h.shift();

    return reading;
  }

  /**
   * Categorize BP according to ACC/AHA guidelines
   */
  private categorizeBP(
    systolic: number,
    diastolic: number
  ): "normal" | "elevated" | "stage1" | "stage2" | "critical" {
    if (systolic >= 180 || diastolic >= 120) return "critical";
    if (systolic >= 140 || diastolic >= 90) return "stage2";
    if (systolic >= 130 || diastolic >= 80) return "stage1";
    if (systolic >= 120 || diastolic > 80) return "elevated";
    return "normal";
  }

  /**
   * Determine baseline BP from age and medical profile
   */
  private determineBaseline(
    age: number,
    medicalHistory: string
  ): {
    systolic: number;
    diastolic: number;
    risk: "low" | "moderate" | "high";
  } {
    // Age-based baseline (ACC/AHA normal is <120/<80)
    const ageFactors: Record<number, { sys: number; dia: number }> = {
      50: { sys: 120, dia: 80 },
      60: { sys: 125, dia: 82 },
      70: { sys: 130, dia: 85 },
      80: { sys: 135, dia: 87 },
    };

    let ageKey = 50;
    for (const key of Object.keys(ageFactors)) {
      if (age >= parseInt(key)) ageKey = parseInt(key);
    }

    let sys = ageFactors[ageKey].sys;
    let dia = ageFactors[ageKey].dia;
    let risk: "low" | "moderate" | "high" = "low";

    // Medical history adjustments
    const history = medicalHistory.toLowerCase();

    if (history.includes("hypertension")) {
      sys += 15;
      dia += 10;
      risk = "high";
    } else if (history.includes("diabetes") || history.includes("obesity")) {
      sys += 8;
      dia += 5;
      risk = "moderate";
    } else if (
      history.includes("heart failure") ||
      history.includes("atrial fibrillation")
    ) {
      sys += 20;
      dia += 12;
      risk = "high";
    }

    return { systolic: sys, diastolic: dia, risk };
  }

  /**
   * Calculate age from DOB
   */
  private calculateAge(dateOfBirth: string | Date): number {
    const dob = typeof dateOfBirth === "string" ? new Date(dateOfBirth) : dateOfBirth;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < dob.getDate())
    ) {
      age--;
    }

    return Math.max(50, Math.min(105, age)); // Clamp reasonable range
  }

  /**
   * Get BP alert severity
   */
  getAlertSeverity(reading: BPReading): "none" | "warning" | "critical" {
    if (reading.category === "critical") return "critical";
    if (reading.category === "stage2") return "warning";
    if (reading.trend === "increasing" && reading.category === "stage1") {
      return "warning";
    }
    return "none";
  }

  /**
   * Get BP reading history for a resident
   */
  getHistory(residentId: string): BPReading[] {
    return this.bpHistory.get(residentId) || [];
  }

  /**
   * Clear history (for testing)
   */
  clearHistory(): void {
    this.bpHistory.clear();
  }
}

export const bpSimulator = new BPSimulator();
export type { ResidentBPProfile, BPReading };
