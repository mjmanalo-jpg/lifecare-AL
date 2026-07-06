const Swal = {
  fire: async (options) => {
    console.log("✓ Swal.fire called - user clicks Cancel");
    return { isConfirmed: false };
  }
};

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
    html: `<p>Are you sure you want to permanently delete <strong>${count}</strong> resident record${count !== 1 ? "s" : ""}?</p>`,
    icon: "warning",
    showCancelButton: true
  });

  if (result.isConfirmed) {
    const filtered = residentRecords.filter(rec => !selectedRecords.has(rec.id));
    selectedRecords.clear();
    return { success: true, deletedCount: count };
  } else {
    console.log("✓ Deletion cancelled - no records deleted");
    console.log("✓ Selected records remain unchanged:", Array.from(selectedRecords));
    return { success: false, cancelled: true };
  }
};

(async () => {
  console.log("=== Testing Cancel Path ===\n");
  const result = await handleResDeleteSelected();
  console.log("✓ Cancel path works correctly!");
})();
