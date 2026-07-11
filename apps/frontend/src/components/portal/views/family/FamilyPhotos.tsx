"use client";

import { Camera } from "lucide-react";

/** Photos — shared moments from care staff. No DB model yet; placeholder module. */
export default function FamilyPhotos() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Camera className="w-6 h-6 text-pink-500" /> Photos
      </h2>
      <div className="bg-white rounded-lg p-8 border border-gray-200 text-center">
        <Camera className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-600 text-sm">Shared photos from care staff will appear here.</p>
        <p className="text-gray-400 text-xs mt-1">Ask the care team to share moments from activities and events.</p>
      </div>
    </div>
  );
}
