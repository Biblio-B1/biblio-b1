"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  reportCheckAction,
  resolveReportAction,
  retryCheckAction,
  saveAttemptAction,
  updateTestsAction,
  verifyCheckAction,
} from "@/lib/api/training";
import { usePageRefresh } from "@/components/PageRefresh";
import {
  checkMode,
  computeVerdict,
  defaultLanguageForSubject,
  diffLines,
  initialCode,
  LANGUAGE_LABELS,
  STARTER_TEMPLATES,
  type CheckTestData,
  type TestOutcome,
  type Verdict,
} from "@/lib/code-check";
import { LANGUAGES, type Language, type RunResult } from "@/lib/runners/types";
import { EngineError, RunnerLane, type EngineState } from "./runner-client";

const CodeEditor = dynamic(() => import("./CodeEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-56 items-center justify-center rounded-lg border border-line-strong bg-surface text-[14px] text-ink-3">
      Chargement de l&apos;éditeur…
    </div>
  ),
});

/** Signalement non traité (transmis aux administrateurs seulement). */
export type CodeExerciseReport = { id: string; message: string; authorName: string; createdAt: string };

export type CodeExerciseCheck = {
  status: string;
  language: Language | null;
  tests: CheckTestData[];
  verified: boolean;
  /** Admins seulement : signalements non traités de cet exercice. */
  reports?: CodeExerciseReport[];
};

const reportDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

const LOADING_TEXT: Record<Language, string> = {
  c: "Chargement du compilateur C (≈27 Mo, une seule fois)…",
  python: "Chargement de Python…",
  javascript: "Préparation de JavaScript…",
};

const RELOADING_TEXT: Record<Language, string> = {
  c: "Rechargement du compilateur C…",
  python: "Rechargement de Python…",
  javascript: "Préparation de JavaScript…",
};

const TIMEOUT_TEXT = "Délai dépassé (boucle infinie ?)";

const OUTCOME_TEXT: Record<TestOutcome["status"], string> = {
  ok: "réussi",
  wrong: "sortie différente",
  timeout: "délai dépassé",
  runtime: "erreur d'exécution",
  compile: "erreur de compilation",
  skipped: "non exécuté",
};

type Output = { kind: "run"; result: RunResult } | { kind: "verdict"; verdict: Verdict } | null;

type Kind = "ready" | "preparing" | "none";

/**
 * Section « Votre programme » de la page d'exercice. Pendant le pré-calcul, si le langage n'est
 * pas encore connu, l'étudiant peut choisir d'écrire du code en attendant (Exécuter seulement).
 */
export function CodeExercise({
  exerciseId,
  check,
  attempt,
  isAdmin,
  timeoutMs,
  subjectName,
}: {
  exerciseId: string;
  check: CodeExerciseCheck | null;
  attempt: { language: string; code: string } | null;
  isAdmin: boolean;
  timeoutMs: number;
  subjectName: string | null;
}) {
  const mode = checkMode(check);
  const uid = useId();
  const [practice, setPractice] = useState<Language | null>(null);
  const [choice, setChoice] = useState<Language>(() => defaultLanguageForSubject(subjectName));

  if (mode.language) {
    return (
      <CodeWorkspace
        key={mode.language}
        exerciseId={exerciseId}
        check={check}
        kind={mode.kind}
        language={mode.language}
        attempt={attempt}
        isAdmin={isAdmin}
        timeoutMs={timeoutMs}
      />
    );
  }

  if (mode.kind === "preparing" && practice) {
    return (
      <CodeWorkspace
        key={practice}
        exerciseId={exerciseId}
        check={check}
        kind="preparing"
        language={practice}
        attempt={attempt}
        isAdmin={isAdmin}
        timeoutMs={timeoutMs}
        practice={{ onLanguage: setPractice }}
      />
    );
  }

  return (
    <section aria-labelledby={`${uid}-t`} className="flex flex-col gap-3">
      <h2 id={`${uid}-t`} className="sr-only">
        Vérification automatique
      </h2>
      <p className="text-[14px] text-ink-3">
        {mode.kind === "preparing"
          ? "Vérification en préparation — revenez plus tard."
          : "Pas de vérification automatique pour cet exercice."}
      </p>
      {mode.kind === "preparing" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[14px] text-ink-2">
            Langage
            <LanguageSelect value={choice} onChange={setChoice} />
          </label>
          <button type="button" className="btn" onClick={() => setPractice(choice)}>
            Écrire du code en attendant
          </button>
        </div>
      )}
      {isAdmin && check && <AdminTools exerciseId={exerciseId} check={check} />}
    </section>
  );
}

function LanguageSelect({ value, onChange, id }: { value: Language; onChange: (l: Language) => void; id?: string }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Language)}
      className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[14px] text-ink"
    >
      {LANGUAGES.map((l) => (
        <option key={l} value={l}>
          {LANGUAGE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}

/**
 * Éditeur et exécution pour un langage (le parent le remonte si le langage change : `key`).
 * `practice` : code écrit en attendant le pré-calcul — Exécuter seulement, rien n'est enregistré.
 */
function CodeWorkspace({
  exerciseId,
  check,
  kind,
  language,
  attempt,
  isAdmin,
  timeoutMs,
  practice,
}: {
  exerciseId: string;
  check: CodeExerciseCheck | null;
  kind: Kind;
  language: Language;
  attempt: { language: string; code: string } | null;
  isAdmin: boolean;
  timeoutMs: number;
  practice?: { onLanguage: (l: Language) => void };
}) {
  const uid = useId();
  const router = usePageRefresh();

  const [code, setCode] = useState(() => initialCode(language, attempt));
  const visibleTest = check?.tests.find((t) => t.visible);
  const [stdin, setStdin] = useState(kind === "ready" ? (visibleTest?.input ?? "") : "");
  const [engine, setEngine] = useState<EngineState>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<Output>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const lane = useRef<RunnerLane | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const l = new RunnerLane(language, timeoutMs);
    lane.current = l;
    const off = l.onState(setEngine);
    void l.prepare(); // préchargement en arrière-plan
    return () => {
      alive.current = false;
      off();
      l.dispose(); // rejette la requête en cours (EngineError)
      lane.current = null;
    };
  }, [language, timeoutMs]);

  const loading = engine === "loading";
  const disabled = loading || busy !== null;

  async function run() {
    if (!lane.current) return;
    setBusy("Exécution…");
    setOutput(null);
    setEngineError(null);
    try {
      const result = await lane.current.run(code, stdin);
      if (alive.current) setOutput({ kind: "run", result });
    } catch (e) {
      if (alive.current) setEngineError(engineErrorText(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function verify() {
    if (!lane.current || !check || kind !== "ready") return;
    const l = lane.current;
    setOutput(null);
    setSaveError(null);
    setEngineError(null);
    const results: RunResult[] = [];
    try {
      for (let i = 0; i < check.tests.length; i++) {
        setBusy(`Vérification : test ${i + 1} sur ${check.tests.length}…`);
        const r = await l.run(code, check.tests[i].input);
        results.push(r);
        if ((!r.ok && r.phase === "compile") || r.timedOut) break; // inutile d'aller plus loin
      }
      if (!alive.current) return; // démonté : ni verdict ni enregistrement
      const verdict = computeVerdict(check.tests, results);
      setOutput({ kind: "verdict", verdict });
      setBusy("Enregistrement…"); // boutons désactivés jusqu'à la fin de l'enregistrement
      const saved = await saveAttemptAction(exerciseId, language, code, verdict.passed);
      if (!alive.current) return;
      if (saved.error) setSaveError(saved.error);
      else router.refresh(); // statut de progression mis à jour (En cours / Maîtrisé)
    } catch (e) {
      // Panne du moteur : pas de verdict, rien n'est enregistré.
      if (alive.current) setEngineError(engineErrorText(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  function reset() {
    if (code !== STARTER_TEMPLATES[language] && !window.confirm("Remplacer votre code par le gabarit de départ ?")) return;
    setCode(STARTER_TEMPLATES[language]);
  }

  return (
    <section aria-labelledby={`${uid}-t`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${uid}-t`} className="text-[1.1rem] font-semibold">
          Votre programme
        </h2>
        {practice ? (
          <>
            <label htmlFor={`${uid}-lang`} className="sr-only">
              Langage
            </label>
            <LanguageSelect id={`${uid}-lang`} value={language} onChange={practice.onLanguage} />
          </>
        ) : (
          <span className="rounded-full border border-line-strong bg-sunken px-2.5 py-0.5 font-mono text-[12.5px] text-ink-2">
            {LANGUAGE_LABELS[language]}
          </span>
        )}
        {kind === "ready" && check && !check.verified && (
          <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12.5px] text-ink-2">
            Tests générés par IA — non vérifiés
          </span>
        )}
      </div>

      {kind === "preparing" && (
        <p className="rounded-md bg-sunken px-3 py-2 text-[14px] text-ink-2">
          Vérification en préparation — revenez plus tard. Vous pouvez déjà écrire et exécuter votre programme
          {practice ? " (ce code n'est pas enregistré)" : ""}.
        </p>
      )}
      {kind === "none" && (
        <p className="rounded-md bg-sunken px-3 py-2 text-[14px] text-ink-2">
          Pas de vérification automatique pour cet exercice. Vous pouvez exécuter votre programme et le comparer à la correction.
        </p>
      )}

      <p id={`${uid}-hint`} className="text-[13.5px] text-ink-2">
        Écrivez un programme complet qui lit l&apos;entrée standard et affiche uniquement le résultat (pas de message comme
        « Entrez un nombre : »). <span className="text-ink-3">Clavier : Tab indente ; Échap puis Tab pour quitter l&apos;éditeur.</span>
      </p>

      <span id={`${uid}-ed`} className="sr-only">
        Éditeur de code {LANGUAGE_LABELS[language]}
      </span>
      <CodeEditor value={code} onChange={setCode} language={language} labelledBy={`${uid}-ed`} describedBy={`${uid}-hint`} />

      <label className="label">
        Entrée pour « Exécuter »
        <textarea
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
          rows={3}
          spellCheck={false}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[13.5px] font-normal text-ink"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={disabled} onClick={run}>
          Exécuter
        </button>
        {kind === "ready" && (
          <button type="button" className="btn btn-primary" disabled={disabled} onClick={verify}>
            Vérifier
          </button>
        )}
        <button type="button" className="btn btn-ghost text-ink-2" disabled={busy !== null} onClick={reset}>
          Revenir au gabarit
        </button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {engineError && (
          <p role="alert" className="text-[13.5px] text-danger">
            {engineError}
          </p>
        )}
        {(loading || busy || (engine === "error" && !engineError)) && (
          <p className="text-[13.5px] text-ink-2" role="status">
            {busy ??
              (loading
                ? (lane.current?.loadedOnce ? RELOADING_TEXT : LOADING_TEXT)[language]
                : "Le moteur d'exécution n'a pas pu être chargé. Réessayez.")}
          </p>
        )}
        {output?.kind === "run" && <RunOutput result={output.result} />}
        {output?.kind === "verdict" && <VerdictView verdict={output.verdict} />}
        {saveError && (
          <p role="alert" className="text-[13px] text-danger">
            {saveError}
          </p>
        )}
      </div>

      {kind === "ready" && check && <ReportButton exerciseId={exerciseId} />}
      {isAdmin && check && <AdminTools exerciseId={exerciseId} check={check} />}
    </section>
  );
}

function engineErrorText(e: unknown): string {
  const detail = e instanceof EngineError || e instanceof Error ? ` (${e.message})` : "";
  return `Le moteur d'exécution n'a pas pu fonctionner${detail}. Rechargez la page ou réessayez.`;
}

function Pre({ children, tone = "plain", label }: { children: React.ReactNode; tone?: "plain" | "danger"; label?: string }) {
  return (
    <pre
      aria-label={label}
      className={`max-h-72 overflow-auto rounded-md border px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
        tone === "danger" ? "border-danger/40 bg-danger-bg text-danger" : "border-line bg-sunken text-ink"
      }`}
    >
      {children}
    </pre>
  );
}

function RunOutput({ result }: { result: RunResult }) {
  if (result.timedOut && result.phase === "compile") {
    // Compilation trop longue (message fourni par le runner), pas une boucle infinie.
    return <p className="text-[14px] font-medium text-danger">{result.stderr}</p>;
  }
  if (result.timedOut) {
    return <p className="text-[14px] font-medium text-danger">{TIMEOUT_TEXT} — le programme a été arrêté.</p>;
  }
  if (!result.ok && result.phase === "compile") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-medium text-danger">Erreur de compilation</p>
        <Pre tone="danger">{result.stderr}</Pre>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13.5px] text-ink-2">
        Sortie{result.exitCode !== 0 && result.exitCode !== null ? ` (code de sortie ${result.exitCode})` : ""}
        {result.durationMs ? ` · ${result.durationMs} ms` : ""}
      </p>
      <Pre>{result.stdout || <span className="text-ink-3">(aucune sortie)</span>}</Pre>
      {result.stderr && <Pre tone="danger">{result.stderr}</Pre>}
    </div>
  );
}

function Diff({ expected, actual }: { expected: string; actual: string }) {
  const lines = diffLines(expected, actual);
  const cell = "px-2 py-0.5 align-top whitespace-pre-wrap break-all";
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse font-mono text-[13px]">
        <thead>
          <tr className="bg-sunken text-left font-sans text-[12.5px] text-ink-2">
            <th scope="col" className="w-8 px-2 py-1 font-medium">
              <span className="sr-only">Ligne</span>
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Attendu
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              Obtenu
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td className={cell} />
              <td className={`${cell} text-ink-3`}>(vide)</td>
              <td className={`${cell} text-ink-3`}>(vide)</td>
            </tr>
          )}
          {lines.map((l, i) => (
            <tr key={i} className={l.same ? "" : "bg-danger-bg"}>
              <td className={`${cell} text-right text-ink-3`}>
                {i + 1}
                {!l.same && <span className="sr-only"> (différente)</span>}
              </td>
              <td className={cell}>{l.expected ?? <span className="text-ink-3">(absente)</span>}</td>
              <td className={`${cell} ${l.same ? "" : "text-danger"}`}>{l.actual ?? <span className="text-ink-3">(absente)</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VerdictView({ verdict }: { verdict: Verdict }) {
  const okCount = verdict.outcomes.filter((o) => o.status === "ok").length;
  return (
    <div className="flex flex-col gap-3">
      {verdict.passed ? (
        <p className="text-[15px] font-semibold text-ok">Bravo, exercice réussi ! Statut : « Maîtrisé ».</p>
      ) : (
        <p className="text-[15px] font-semibold text-danger">
          {okCount} test{okCount > 1 ? "s" : ""} réussi{okCount > 1 ? "s" : ""} sur {verdict.outcomes.length}.
        </p>
      )}
      {verdict.compileError !== null && (
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-medium text-danger">Erreur de compilation</p>
          <Pre tone="danger">{verdict.compileError}</Pre>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {verdict.outcomes.map((o) => (
          <li key={o.index} className="flex flex-col gap-2">
            <p className="text-[14px]">
              <span aria-hidden="true">{o.status === "ok" ? "✅" : "❌"}</span>{" "}
              <span className="font-medium">
                Test {o.index + 1}
                {o.visible ? " (exemple)" : ""}
              </span>{" "}
              : {OUTCOME_TEXT[o.status]}
            </p>
            {o.visible && o.input !== undefined && o.status !== "compile" && o.status !== "skipped" && (
              <div className="flex flex-col gap-2 pl-6">
                <p className="text-[12.5px] text-ink-2">Entrée</p>
                <Pre>{o.input || <span className="text-ink-3">(vide)</span>}</Pre>
                {o.status === "timeout" ? (
                  <p className="text-[13.5px] text-danger">{TIMEOUT_TEXT}</p>
                ) : (
                  <Diff expected={o.expected ?? ""} actual={o.actual ?? ""} />
                )}
                {o.stderr && o.status !== "timeout" && <Pre tone="danger">{o.stderr}</Pre>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportButton({ exerciseId }: { exerciseId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await reportCheckAction(exerciseId, message);
      setResult(r);
      if (!r.error) {
        setMessage("");
        dialog.current?.close();
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-write
        className="btn btn-ghost self-start px-2 text-[13px] text-ink-2"
        onClick={() => {
          setResult(null);
          dialog.current?.showModal();
        }}
      >
        Signaler un test faux
      </button>
      {result?.message && (
        <p role="status" className="text-[13px] text-ok">
          {result.message}
        </p>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={`${uid}-rt`}
        className="m-auto w-[min(92vw,28rem)] rounded-lg border border-line-strong bg-surface p-5 text-ink backdrop:bg-black/40"
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h2 id={`${uid}-rt`} className="text-base font-semibold">
            Signaler un test faux
          </h2>
          <label className="label">
            Qu&apos;est-ce qui ne va pas ?
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              maxLength={2000}
              rows={4}
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] font-normal text-ink"
              placeholder="Ex. : la sortie attendue du test 1 devrait être 4, pas 5."
            />
          </label>
          {result?.error && (
            <p role="alert" className="text-[13px] text-danger">
              {result.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              Envoyer
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function AdminTools({ exerciseId, check }: { exerciseId: string; check: CodeExerciseCheck }) {
  const router = usePageRefresh();
  const uid = useId();
  const [json, setJson] = useState(() => JSON.stringify(check.tests, null, 2));
  const [editing, setEditing] = useState(false);
  // Langage des tests : à choisir quand le pré-calcul n'en a pas fixé (pending, no_code…).
  const [editLanguage, setEditLanguage] = useState<Language>(check.language ?? "c");
  // « Valider » n'a de sens que sur des tests produits par le pré-calcul (ready, non vide).
  const canVerify = check.status === "ready" && check.tests.length > 0 && !check.verified;
  const reports = check.reports ?? [];
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();

  function act(fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) {
    setResult(null);
    start(async () => {
      const r = await fn();
      setResult(r);
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });
  }

  function retry() {
    if (check.verified) {
      const ok = window.confirm(
        "Ces tests ont été validés par un administrateur. Relancer le pré-calcul retire la validation et remplacera les tests. Continuer ?",
      );
      if (!ok) return;
      act(() => retryCheckAction(exerciseId, true));
    } else {
      act(() => retryCheckAction(exerciseId));
    }
  }

  return (
    <details className="rounded-md border border-line-strong" open={reports.length > 0 || undefined}>
      <summary className="cursor-pointer px-3 py-2 text-[14px] font-medium">
        Outils administrateur (vérification)
        {reports.length > 0 && (
          <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-[12.5px] text-danger">
            {reports.length} signalement{reports.length > 1 ? "s" : ""}
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-3 p-3 pt-1">
        <p className="text-[13px] text-ink-2">
          Statut du pré-calcul : <span className="font-mono">{check.status}</span>
          {check.verified ? " · tests validés" : ""}
        </p>
        {reports.length > 0 && (
          <section aria-labelledby={`${uid}-sig`} className="flex flex-col gap-2">
            <h3 id={`${uid}-sig`} className="text-[13px] font-semibold">
              Signalements ouverts ({reports.length})
            </h3>
            <ul className="flex flex-col gap-2">
              {reports.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 rounded-md border border-line bg-surface p-2 text-[13px]">
                  <p className="text-ink-3">
                    {r.authorName} · {reportDate.format(new Date(r.createdAt))}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-ink">{r.message}</p>
                  <button
                    type="button"
                    className="btn btn-ghost self-start px-2 text-[13px]"
                    disabled={pending}
                    onClick={() => act(() => resolveReportAction(r.id))}
                  >
                    Marquer comme traité
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {canVerify && (
            <button type="button" className="btn" disabled={pending} onClick={() => act(() => verifyCheckAction(exerciseId))}>
              Valider les tests
            </button>
          )}
          <button type="button" className="btn" disabled={pending} aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
            Modifier les tests
          </button>
          <button type="button" className="btn" disabled={pending} onClick={retry}>
            Relancer le pré-calcul
          </button>
        </div>
        {editing && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => updateTestsAction(exerciseId, json, check.language ? null : editLanguage), () => setEditing(false));
            }}
          >
            {!check.language && (
              <label className="flex items-center gap-2 text-[14px] text-ink-2">
                Langage des tests
                <LanguageSelect value={editLanguage} onChange={setEditLanguage} />
              </label>
            )}
            <label className="label">
              Tests (JSON : {"[{\"input\": \"…\", \"expected\": \"…\", \"visible\": true}]"})
              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                rows={10}
                spellCheck={false}
                className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[13px] font-normal text-ink"
              />
            </label>
            <button type="submit" className="btn btn-primary self-start" disabled={pending}>
              Enregistrer les tests
            </button>
          </form>
        )}
        <div aria-live="polite">
          {result?.error && <p className="text-[13px] text-danger">{result.error}</p>}
          {result?.message && <p className="text-[13px] text-ok">{result.message}</p>}
        </div>
      </div>
    </details>
  );
}
