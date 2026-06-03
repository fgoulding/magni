import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function Home() {
  if (!(await getUser())) {
    redirect("/login");
  }

  redirect("/today");
}
