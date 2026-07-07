"use client";

import StatCard from "@/components/portal/widgets/StatCard";
import ChartContainer from "@/components/portal/widgets/ChartContainer";
import VitalsPanel, { VitalReading } from "@/components/portal/widgets/VitalsPanel";
import AlertBanner from "@/components/portal/widgets/AlertBanner";
import { Heart, Smile, Activity, DollarSign } from "lucide-react";
import { useState } from "react";

interface FamilyPortalContentProps {
  tab: string;
}

export default function FamilyPortalContent({ tab }: FamilyPortalContentProps) {
  const [vitals] = useState<VitalReading[]>([
    {
      type: "HEART_RATE",
      value: 75,
      unit: "bpm",
      normal: true,
      lastUpdated: new Date(),
    },
    {
      type: "TEMPERATURE",
      value: 36.8,
      unit: "°C",
      normal: true,
      lastUpdated: new Date(),
    },
    {
      type: "BLOOD_PRESSURE",
      value: 118,
      unit: "mmHg",
      normal: true,
      lastUpdated: new Date(),
    },
    {
      type: "OXYGEN",
      value: 97,
      unit: "%",
      normal: true,
      lastUpdated: new Date(),
    },
  ]);

  const mockVitalsData = [
    { name: "Mon", value: 74 },
    { name: "Tue", value: 76 },
    { name: "Wed", value: 75 },
    { name: "Thu", value: 77 },
    { name: "Fri", value: 75 },
    { name: "Sat", value: 73 },
  ];

  if (tab === "report") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Daily Report</h2>
        <div className="bg-white rounded-lg p-6 border border-gray-200 space-y-4">
          <h3 className="font-semibold text-gray-900">Today's Summary</h3>
          <p className="text-gray-700">
            Arthur had a great day! He enjoyed breakfast and participated in morning activities. His vitals are stable and he's resting comfortably.
          </p>
          <div className="pt-4 border-t border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-2">Activity Highlights</h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li>✓ Breakfast: Full meal consumed</li>
              <li>✓ Garden walk: 20 minutes</li>
              <li>✓ Medication: Completed at scheduled times</li>
              <li>✓ Social time: Card game with other residents</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (tab === "timeline") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Health Timeline</h2>
        <ChartContainer
          title="Heart Rate (Weekly Average)"
          type="line"
          data={mockVitalsData}
          dataKey="value"
          xAxisKey="name"
          colors={["#ef4444"]}
        />
      </div>
    );
  }

  if (tab === "alerts") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Alerts</h2>
        <AlertBanner
          type="success"
          title="Vitals Stable"
          message="All vital signs are within normal ranges"
          timestamp={new Date()}
        />
      </div>
    );
  }

  if (tab === "expenses") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Billing</h2>
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-4 border-b border-gray-200">
              <span className="text-gray-700">Care Services (June 2026)</span>
              <span className="font-semibold">$4,500.00</span>
            </div>
            <div className="flex justify-between items-center pb-4 border-b border-gray-200">
              <span className="text-gray-700">Medications</span>
              <span className="font-semibold">$320.00</span>
            </div>
            <div className="flex justify-between items-center pt-4 text-lg font-bold">
              <span>Total Due</span>
              <span className="text-blue-600">$4,820.00</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: Family Dashboard tab
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Family Dashboard</h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Overall Health"
          value="Excellent"
          icon={Heart}
          backgroundColor="bg-green-50"
          textColor="text-green-900"
          iconColor="text-green-500"
        />
        <StatCard
          title="Mood"
          value="Happy"
          icon={Smile}
          backgroundColor="bg-yellow-50"
          textColor="text-yellow-900"
          iconColor="text-yellow-500"
        />
        <StatCard
          title="Activity Level"
          value="Active"
          icon={Activity}
          backgroundColor="bg-blue-50"
          textColor="text-blue-900"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Next Bill Due"
          value="June 30"
          icon={DollarSign}
          backgroundColor="bg-purple-50"
          textColor="text-purple-900"
          iconColor="text-purple-500"
        />
      </div>

      {/* Vitals Panel */}
      <VitalsPanel vitals={vitals} resident="Arthur Pendelton" />

      {/* Latest Alert */}
      <AlertBanner
        type="success"
        title="Great News!"
        message="All vitals are in excellent range today"
        timestamp={new Date()}
      />

      {/* Latest Report Preview */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3">Today's Highlights</h3>
        <p className="text-gray-700 text-sm">
          Arthur had a wonderful day! He enjoyed his meals and participated in our garden walk. All medications were taken on schedule and his spirits are high.
        </p>
      </div>
    </div>
  );
}
