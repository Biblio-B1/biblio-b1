// Squelettes de chargement : la forme de la page apparaît tout de suite (blocs gris qui pulsent),
// à la place du texte « Chargement… ». Lu « Chargement… » par les lecteurs d'écran.

/** Bloc gris animé. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-sunken motion-reduce:animate-none ${className}`} />;
}

function Status({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">Chargement…</span>
      {children}
    </div>
  );
}

/** Lignes de liste (devoirs, contrôles, annuaire, signalements…). */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="h-9 w-1 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className={`h-4 ${i % 2 ? "w-1/2" : "w-2/3"}`} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-8 w-20 shrink-0 sm:block" />
        </div>
      ))}
    </Status>
  );
}

/** Formulaire (ajout d'un devoir, d'un contrôle, dépôt, fiche). */
export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <Status className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <Skeleton className="h-5 w-48" />
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-36" />
    </Status>
  );
}

/** Grille de cartes (matières, entraînement, documents). */
export function CardsSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <Status className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </Status>
  );
}

/** Emploi du temps : bandeau des jours puis cours. */
export function CalendarSkeleton() {
  return (
    <Status className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </Status>
  );
}

/** Page d'un document ou d'un exercice : titre, actions, contenu. */
export function DocSkeleton() {
  return (
    <Status className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <Skeleton className="h-8 w-1 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <Skeleton className="h-9 w-9 sm:w-32" />
      </div>
      <Skeleton className="h-[55vh] w-full rounded-lg" />
    </Status>
  );
}

/** Accueil : titre, boutons, deux colonnes (devoirs, contrôles), emploi du temps. */
export function DashboardSkeleton() {
  return (
    <Status className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((c) => (
          <div key={c} className="flex flex-col gap-3">
            <Skeleton className="h-5 w-44" />
            {[0, 1, 2].map((r) => (
              <Skeleton key={r} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ))}
      </div>
      <CalendarSkeleton />
    </Status>
  );
}

/** Quelques lignes de texte (petite section). */
export function LinesSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <Status className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 ? "w-1/2" : "w-full"}`} />
      ))}
    </Status>
  );
}

/** Page entière (vérification de la connexion) : titre et liste. */
export function PageSkeleton() {
  return (
    <Status className="flex flex-col gap-6">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-4 w-2/3" />
      <ListSkeleton rows={5} />
    </Status>
  );
}
