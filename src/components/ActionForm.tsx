"use client";

import { useActionState } from "react";

export type FormState = { error?: string; message?: string; link?: string } | null;

export function ActionForm({
  action,
  submitLabel,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {children}
      {state?.error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state?.message && <p className="text-sm text-green-700">{state.message}</p>}
      {state?.link && <CopyLink link={state.link} />}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Patientez…" : submitLabel}
      </button>
    </form>
  );
}

function CopyLink({ link }: { link: string }) {
  return (
    <div className="flex gap-2">
      <input readOnly value={link} className="flex-1 rounded border px-2 py-1 text-sm" />
      <button
        type="button"
        className="rounded border px-3 py-1 text-sm"
        onClick={() => navigator.clipboard?.writeText(link)}
      >
        Copier le lien
      </button>
    </div>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  min,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string | number;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        min={min}
        className="rounded border px-3 py-2 text-base"
      />
    </label>
  );
}
