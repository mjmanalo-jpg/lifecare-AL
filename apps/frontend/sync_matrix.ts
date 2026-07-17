import { PrismaClient } from "@prisma/client";
import { ROLES } from "./src/constants/roleConfig";

const prisma = new PrismaClient();

async function main() {
  const setting = await prisma.appSetting.findUnique({
    where: { id: "portal_matrix" },
  });
  if (!setting) {
    console.error("No portal_matrix found in database!");
    return;
  }
  const matrix = JSON.parse(setting.value);
  
  // For each role in ROLES, ensure that all sidebarLinks are set to true in the matrix
  for (const role of Object.keys(ROLES)) {
    if (!matrix[role]) {
      matrix[role] = {};
    }
    const roleDetails = ROLES[role as keyof typeof ROLES];
    for (const link of roleDetails.sidebarLinks) {
      matrix[role][link.name] = true;
    }
  }

  // Update the matrix back to the database
  await prisma.appSetting.update({
    where: { id: "portal_matrix" },
    data: { value: JSON.stringify(matrix) },
  });
  console.log("Portal matrix successfully synchronized with roleConfig!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
