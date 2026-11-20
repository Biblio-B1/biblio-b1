"use client";

import { useActionState, useEffect, useState } from "react";

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
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-2.5 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state?.message && <p role="status" className="text-sm text-ok">{state.message}</p>}
      {state?.link && <CopyLink link={state.link} />}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary h-10"
      >
        {pending ? "Patientez…" : submitLabel}
      </button>
    </form>
  );
}

function CopyLink({ link }: { link: string }) {
  // Modifiable : l'administrateur peut corriger l'adresse (ex. localhost -> IP) avant de copier.
  const [value, setValue] = useState(link);
  useEffect(() => setValue(link), [link]);
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Lien d'invitation"
        className="input h-9 min-w-0 flex-1 font-mono text-[13px]"
      />
      <button
        type="button"
        className="btn shrink-0"
        onClick={() => navigator.clipboard?.writeText(value)}
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
    <label className="label">
      {label}
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        min={min}
        className="input"
      />
    </label>
  );
}
