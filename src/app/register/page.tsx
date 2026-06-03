import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getUser } from "@/lib/auth";

export default async function RegisterPage() {
  if (await getUser()) {
    redirect("/today");
  }

  return (
    <div className="safe-x flex flex-1 items-center justify-center py-10">
      <AuthForm mode="register" />
    </div>
  );
}
