import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { logoutAction } from "./(auth)/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Biblio B1</h1>
      <p>Bonjour {user.name}.</p>
      <nav className="flex items-center gap-4 text-sm">
        {user.role === "admin" && (
          <Link href="/admin/invites" className="underline">
            Invitations
          </Link>
        )}
        <form action={logoutAction}>
          <button className="underline">Se déconnecter</button>
        </form>
      </nav>
    </main>
  );
}
