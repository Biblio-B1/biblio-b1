import Link from "next/link";

export const metadata = { title: "Page introuvable" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6">
      <p className="text-[13px] font-medium text-ink-3">Erreur 404</p>
      <h1 className="page-title">Page introuvable</h1>
      <p className="text-ink-2">Cette page n&apos;existe pas, ou le document a été supprimé.</p>
      <Link href="/" className="btn btn-primary">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
