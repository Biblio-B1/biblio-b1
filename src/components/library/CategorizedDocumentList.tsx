"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import {
  IconBookOpen,
  IconCheckCircle,
  IconCheckList,
  IconChevron,
  IconClose,
  IconFileText,
  IconHomework,
  IconImage,
  IconList,
  IconPen,
  IconSearch,
} from "@/components/layout/Icons";
import { Spine } from "@/components/layout/Spine";
import { useSignedUrl } from "@/lib/api/files";
import type { Document, Subject } from "@/lib/api/types";
import {
  DOC_CATEGORY_MAP,
  documentContextBadge,
  formatFileKind,
  groupDocumentsByCategory,
  matchesDocumentQuery,
  type DocCategoryId,
  type DocumentCategoryGroup,
} from "@/lib/doc-categories";
import { formatDate } from "@/lib/labels";
import { docHref } from "@/lib/routes";

function CategoryIcon({ id, className }: { id: DocCategoryId; className?: string }) {
  switch (id) {
    case "course":
      return <IconBookOpen size={16} className={className} />;
    case "exercises":
      return <IconCheckList size={16} className={className} />;
    case "corrections":
      return <IconCheckCircle size={16} className={className} />;
    case "exams":
      return <IconFileText size={16} className={className} />;
    case "projects":
      return <IconHomework size={16} className={className} />;
    case "notes":
      return <IconPen size={16} className={className} />;
    case "photos":
      return <IconImage size={16} className={className} />;
    case "syllabus":
      return <IconList size={16} className={className} />;
  }
}

export function CategoryFilter({
  groups,
  totalCount,
  active,
  base,
  q,
  extra = {},
}: {
  groups: { category: { id: DocCategoryId; shortLabel: string }; docs: unknown[] }[];
  totalCount: number;
  active?: DocCategoryId;
  base: string;
  q?: string;
  extra?: Record<string, string>;
}) {
  const href = (cat?: DocCategoryId) => {
    const p = new URLSearchParams(extra);
    if (cat) p.set("cat", cat);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  const pillClass = (isActive: boolean) =>
    `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13.5px] transition-colors ${
      isActive ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"
    }`;

  return (
    <nav aria-label="Filtrer par catégorie" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      <Link href={href(undefined)} aria-current={!active ? "page" : undefined} className={pillClass(!active)}>
        <span>Tout</span>
        <span className={`text-[12px] tabular-nums ${!active ? "text-bg/80" : "text-ink-3"}`}>{totalCount}</span>
      </Link>
      {groups.map((g) => {
        const isActive = active === g.category.id;
        return (
          <Link
            key={g.category.id}
            href={href(g.category.id)}
            aria-current={isActive ? "page" : undefined}
            className={pillClass(isActive)}
          >
            <span>{g.category.shortLabel}</span>
            <span className={`text-[12px] tabular-nums ${isActive ? "text-bg/80" : "text-ink-3"}`}>
              {g.docs.length}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function PhotoCard({
  doc,
  subject,
  showSubject,
}: {
  doc: Document;
  subject?: Subject;
  showSubject: boolean;
}) {
  const isImage = doc.mime.startsWith("image/");
  const src = useSignedUrl(isImage ? doc.filePath : null);
  return (
    <Link
      href={docHref(doc.id)}
      className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-line-strong"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-sunken">
        {isImage ? (
          src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={doc.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <span className="block h-full w-full animate-pulse bg-sunken" />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-3">
            <IconImage size={24} />
          </div>
        )}
      </div>
      <div className="flex items-start gap-2 px-2.5 py-2">
        <Spine color={subject?.color ?? null} className="mt-0.5 h-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-ink">{doc.title}</p>
          <p className="truncate text-[12px] text-ink-3">
            {showSubject && subject ? `${subject.name} · ` : ""}
            {formatDate(doc.createdAt)}
          </p>
        </div>
      </div>
    </Link>
  );
}

function DocRow({
  doc,
  subject,
  showSubject,
  hideSubGroup,
}: {
  doc: Document;
  subject?: Subject;
  showSubject: boolean;
  hideSubGroup?: string;
}) {
  const badge = documentContextBadge(doc, { hideSubGroup });
  const parts = [formatFileKind(doc.filePath, doc.mime)];
  if (badge) parts.push(badge);
  if (showSubject) parts.push(subject ? subject.name : "sans matière");

  return (
    <li>
      <Link
        href={docHref(doc.id)}
        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-sunken sm:px-4"
      >
        <Spine color={subject?.color ?? null} className="h-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{doc.title}</span>
          <span className="block truncate text-[13px] text-ink-3">
            {parts.join(" · ")}
            {!doc.subjectConfirmed && subject ? " (à confirmer)" : ""}
          </span>
        </span>
        <time
          className="hidden shrink-0 text-[13px] text-ink-3 tabular-nums sm:block"
          dateTime={doc.createdAt.toISOString()}
        >
          {formatDate(doc.createdAt)}
        </time>
      </Link>
    </li>
  );
}

function CategorySection({
  group,
  subjectsById,
  showSubject,
  isOpen,
  onToggle,
}: {
  group: DocumentCategoryGroup<Document>;
  subjectsById: Map<string, Subject>;
  showSubject: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  const { category, docs, subGroups } = group;

  return (
    <section aria-labelledby={`${panelId}-heading`} className="flex flex-col gap-2">
      <button
        id={`${panelId}-heading`}
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-sunken/70"
      >
        <CategoryIcon id={category.id} className="shrink-0 text-ink-2" />
        <span className="text-[15px] font-semibold text-ink">{category.label}</span>
        <span className="text-[13px] text-ink-3 tabular-nums">{docs.length}</span>
        <span className="ml-auto text-ink-3">
          <IconChevron size={16} dir={isOpen ? "down" : "right"} />
        </span>
      </button>

      {isOpen && (
        <div id={panelId}>
          {category.id === "photos" ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {docs.map((d) => (
                <li key={d.id}>
                  <PhotoCard
                    doc={d}
                    subject={d.subjectId ? subjectsById.get(d.subjectId) : undefined}
                    showSubject={showSubject}
                  />
                </li>
              ))}
            </ul>
          ) : subGroups ? (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              {subGroups.map((sg, idx) => (
                <div key={sg.label} className={idx > 0 ? "border-t border-line" : ""}>
                  <div className="flex items-center justify-between bg-sunken/70 px-3 py-1.5 text-[12.5px] font-medium text-ink-2 sm:px-4">
                    <span>{sg.label}</span>
                    <span className="text-ink-3 tabular-nums">{sg.docs.length}</span>
                  </div>
                  <ul className="divide-y divide-line">
                    {sg.docs.map((d) => (
                      <DocRow
                        key={d.id}
                        doc={d}
                        subject={d.subjectId ? subjectsById.get(d.subjectId) : undefined}
                        showSubject={showSubject}
                        hideSubGroup={sg.label}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {docs.map((d) => (
                <DocRow
                  key={d.id}
                  doc={d}
                  subject={d.subjectId ? subjectsById.get(d.subjectId) : undefined}
                  showSubject={showSubject}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function CategorizedDocumentList({
  docs,
  subjects,
  showSubject = false,
  activeCategory,
  baseHref,
  extraParams = {},
  initialQuery = "",
  empty,
}: {
  docs: Document[];
  subjects: Subject[];
  showSubject?: boolean;
  activeCategory?: DocCategoryId;
  baseHref: string;
  extraParams?: Record<string, string>;
  initialQuery?: string;
  empty?: React.ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const subjectsById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const trimmedQuery = query.trim();

  const queryFilteredDocs = useMemo(
    () => (trimmedQuery ? docs.filter((d) => matchesDocumentQuery(d, trimmedQuery)) : docs),
    [docs, trimmedQuery],
  );

  const allGroups = useMemo(() => groupDocumentsByCategory(queryFilteredDocs), [queryFilteredDocs]);
  const totalGroupsCount = useMemo(() => groupDocumentsByCategory(docs).length, [docs]);

  const visibleGroups = useMemo(
    () => (activeCategory ? allGroups.filter((g) => g.category.id === activeCategory) : allGroups),
    [allGroups, activeCategory],
  );

  const [openIds, setOpenIds] = useState<Set<DocCategoryId>>(() => {
    const initialGroups = groupDocumentsByCategory(docs);
    if (docs.length <= 30) {
      return new Set(initialGroups.map((g) => g.category.id));
    }
    return new Set(initialGroups[0] ? [initialGroups[0].category.id] : []);
  });

  if (docs.length === 0) {
    return <div className="rounded-lg border border-dashed border-line-strong p-6 text-ink-2">{empty}</div>;
  }

  const resetHref = (() => {
    const p = new URLSearchParams(extraParams);
    if (trimmedQuery) p.set("q", trimmedQuery);
    const s = p.toString();
    return s ? `${baseHref}?${s}` : baseHref;
  })();

  const forceOpen = Boolean(activeCategory || trimmedQuery);
  const allVisibleOpen = visibleGroups.every((g) => openIds.has(g.category.id));

  const toggleGroup = (id: DocCategoryId) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allVisibleOpen) {
      setOpenIds(new Set());
    } else {
      setOpenIds(new Set(visibleGroups.map((g) => g.category.id)));
    }
  };

  const showSearch = docs.length >= 6 || Boolean(trimmedQuery);
  const showPills = totalGroupsCount >= 2 || Boolean(activeCategory);

  return (
    <div className="flex flex-col gap-4">
      {showSearch && (
        <div className="relative">
          <IconSearch
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer par titre, chapitre, tag…"
            aria-label="Filtrer par titre, chapitre, tag"
            className="input h-9 pr-9 pl-9 text-[14px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Effacer le filtre"
              className="btn btn-ghost btn-icon absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2 text-ink-3"
            >
              <IconClose size={14} />
            </button>
          )}
        </div>
      )}

      {showPills && (
        <CategoryFilter
          groups={allGroups}
          totalCount={queryFilteredDocs.length}
          active={activeCategory}
          base={baseHref}
          q={trimmedQuery || undefined}
          extra={extraParams}
        />
      )}

      {!forceOpen && visibleGroups.length >= 2 && (
        <div className="flex items-center justify-between text-[13px] text-ink-3">
          <span className="tabular-nums">
            {visibleGroups.length} catégories · {queryFilteredDocs.length} documents
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            {allVisibleOpen ? "Tout replier" : "Tout déplier"}
          </button>
        </div>
      )}

      {visibleGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-ink-2">
          {activeCategory ? (
            <>
              Aucun document dans « {DOC_CATEGORY_MAP[activeCategory].label} »
              {trimmedQuery ? ` pour « ${trimmedQuery} »` : ""}.{" "}
              <Link href={resetHref} className="text-ink underline underline-offset-2">
                Afficher toutes les catégories
              </Link>
              .
            </>
          ) : (
            <>
              Aucun document ne correspond à « {trimmedQuery} ».{" "}
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-ink underline underline-offset-2"
              >
                Effacer le filtre
              </button>
              .
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {visibleGroups.map((group) => (
            <CategorySection
              key={group.category.id}
              group={group}
              subjectsById={subjectsById}
              showSubject={showSubject}
              isOpen={forceOpen || openIds.has(group.category.id)}
              onToggle={() => {
                if (!forceOpen) toggleGroup(group.category.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
