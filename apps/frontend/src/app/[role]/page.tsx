import { redirect } from "next/navigation";

export default async function RoleRootPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  redirect(`/${role}/dashboard`);
}
