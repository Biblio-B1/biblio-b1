// Tutoriel de première connexion : étapes dans l'ordre. `target` : lien du menu à mettre en avant
// (chemin de la page, sans le préfixe du site) ou sélecteur CSS ; `href` : page à ouvrir.

export type TutorialStep = {
  title: string;
  body: string[];
  /** Chemin d'un lien du menu (« /upload ») ou sélecteur CSS (commence par « [ »). */
  target?: string;
  /** Bouton « Ouvrir … » vers la page concernée. */
  href?: { path: string; label: string };
  emoji: string;
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    emoji: "👋",
    title: "Bienvenue sur Biblio B1",
    body: [
      "Biblio B1 est la bibliothèque de la classe : les cours, exercices, devoirs et contrôles de toute la promo, au même endroit.",
      "Le site vit grâce à ce que chacun y met. Ce tutoriel vous montre en 2 minutes comment participer, puis où tout trouver.",
    ],
  },
  {
    emoji: "📤",
    title: "1. Ajoutez les cours et exercices des profs",
    body: [
      "Dès qu'un prof donne un cours, un TD, un sujet ou une correction (PDF, photo du tableau, Word, PowerPoint…), déposez-le ici.",
      "Le site reconnaît la matière et le type de document tout seul ; vérifiez simplement avant d'envoyer. Vous pouvez aussi écrire une fiche.",
    ],
    target: "/upload",
    href: { path: "/upload", label: "Déposer des fichiers" },
  },
  {
    emoji: "📝",
    title: "2. Signalez les devoirs et projets finaux",
    body: [
      "Un devoir à rendre ? Ajoutez-le dans Devoirs, sur le bon cours (l'emploi du temps s'affiche pour le choisir), avec les fichiers utiles.",
      "Cochez « Projet final » pour un projet : il sera rappelé à toute la classe 3, 2 et 1 semaine(s) avant, puis la veille.",
    ],
    target: "/devoirs",
    href: { path: "/devoirs", label: "Ouvrir les devoirs" },
  },
  {
    emoji: "📣",
    title: "3. Annoncez les évaluations",
    body: [
      "Un contrôle, un DS, une interro ? Ajoutez-le dans Contrôles. Ceux de l'emploi du temps Boostcamp y sont déjà.",
      "Toute la classe est prévenue sur le canal Telegram, avec des rappels avant la date. Si quelqu'un l'a déjà mis en ligne, le site vous le signale.",
    ],
    target: "/controles",
    href: { path: "/controles", label: "Ouvrir les contrôles" },
  },
  {
    emoji: "📚",
    title: "Où trouver les cours",
    body: [
      "La Bibliothèque rassemble tous les documents, rangés par matière (aussi dans le menu, sous « Matières ») puis par catégorie.",
      "Pour retrouver un document précis, utilisez la recherche en haut de la page (raccourci Ctrl+K) : elle cherche aussi dans le texte des PDF.",
    ],
    target: "/library",
    href: { path: "/library", label: "Ouvrir la bibliothèque" },
  },
  {
    emoji: "🏋️",
    title: "Entraînement",
    body: [
      "Tous les exercices des cours, avec leur correction quand elle existe : pour le code, vous pouvez écrire et tester votre réponse directement sur le site.",
      "Marquez chaque exercice « à faire », « en cours » ou « maîtrisé » pour suivre votre progression par matière.",
    ],
    target: "/training",
    href: { path: "/training", label: "Ouvrir l'entraînement" },
  },
  {
    emoji: "🗓️",
    title: "Votre emploi du temps",
    body: [
      "Liez votre emploi du temps Boostcamp dans les Paramètres : vos cours s'affichent avec les devoirs à rendre et les contrôles.",
      "Cochez « Fait » sur un devoir quand vous l'avez terminé : c'est personnel, les autres ne le voient pas.",
    ],
    target: "/timetable",
    href: { path: "/settings", label: "Lier mon emploi du temps" },
  },
  {
    emoji: "✉️",
    title: "Annuaire",
    body: [
      "Les adresses e-mail des profs (et des élèves qui acceptent d'apparaître) : écrivez-leur en un clic avec Outlook, connecté à votre compte @edu.ece.fr (bouton dans l'annuaire et les Paramètres).",
    ],
    target: "/annuaire",
    href: { path: "/annuaire", label: "Ouvrir l'annuaire" },
  },
  {
    emoji: "🏠",
    title: "L'accueil, votre tableau de bord",
    body: [
      "Chaque jour : les devoirs de la semaine à cocher, les prochains contrôles, votre emploi du temps et les derniers documents ajoutés.",
      "Vous pourrez revoir ce tutoriel à tout moment depuis les Paramètres. Bonne révision !",
    ],
    target: "/",
  },
];

/** Sélecteur du lien du menu (barre latérale) pour un chemin de page. */
export function targetSelector(target: string): string {
  if (target.startsWith("[")) return target;
  // Liens du menu principal (pas le logo, qui mène aussi à l'accueil).
  if (target === "/") return 'aside nav a[href="/"], aside nav a[href$="/biblio-b1"], aside nav a[href$="/biblio-b1/"]';
  return `aside nav a[href$="${target}"], aside nav a[href$="${target}/"]`;
}
