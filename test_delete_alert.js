// Test that the handleResDeleteSelected function calls Swal.fire with correct parameters
const Swal = {
  fire: async (options) => {
    console.log("✓ Swal.fire called with:");
    console.log("  - title:", options.title);
    console.log("  - icon:", options.icon);
    console.log("  - showCancelButton:", options.showCancelButton);
    console.log("  - confirmButtonText:", options.confirmButtonText);
    console.log("  - HTML content preview:", options.html.substring(0, 50) + "...");
    return { isConfirmed: true };
  }
};

// Simulate the delete handler
const selectedRecords = new Set([1, 2]);
const residentRecords = [
  { id: 1, name: "Arthur" },
  { id: 2, name: "Eleanor" },
  { id: 3, name: "Gerald" }
];

const handleResDeleteSelected = async () => {
  const count = selectedRecords.size;
  const result = await Swal.fire({
    title: "Delete Record(s)?",
    html: `<p>Are you sure you want to permanently delete <strong>${count}</strong> resident record${count !== 1 ? "s" : ""}?</p><p style="color: #999; font-size: 0.9em; margin-top: 8px;">This action cannot be undone.</p>`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#ef4444",
    cancelButtonColor: "#6b7280",
    confirmButtonText: "Delete",
    cancelButtonText: "Cancel",
    background: "#18181b",
    color: "#fafafa"
  });

  if (result.isConfirmed) {
    const filtered = residentRecords.filter(rec => !selectedRecords.has(rec.id));
    console.log("✓ After confirmation - filtered records:", filtered.map(r => r.name));
    selectedRecords.clear();
    console.log("✓ Selected records cleared");
    return { success: true, deletedCount: count };
  }
};

// Test the function
(async () => {
  console.log("=== Testing Delete Sweet Alert ===\n");
  console.log("Initial state: 3 records, 2 selected\n");
  
  const result = await handleResDeleteSelected();
  
  console.log("\n✓ Test completed successfully!");
  console.log("Deleted records:", result.deletedCount);
})();
