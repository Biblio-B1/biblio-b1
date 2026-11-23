// Icônes trait 1.8px, 18px (aucune dépendance).
type P = { className?: string; size?: number };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconHome = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" /></svg>
);
export const IconBooks = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M5 4h3v16H5zM10 4h3v16h-3zM15.2 5.2l2.9-.8 3.4 15-2.9.8z" /></svg>
);
export const IconUpload = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
);
export const IconCamera = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 8a1 1 0 0 1 1-1h3l1.5-2h5L16 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const IconPen = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z" /></svg>
);
export const IconSearch = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
);
export const IconMenu = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const IconClose = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconDownload = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 19h16" /></svg>
);
export const IconSettings = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
);
export const IconMail = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" /><path d="m4 7 8 6 8-6" /></svg>
);
export const IconUsers = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><circle cx="9" cy="8" r="3.5" /><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.6.8 2.7 2.6 3 5.2" /></svg>
);
export const IconChevron = ({ className, size, dir = "right" }: P & { dir?: "left" | "right" }) => (
  <svg {...base(size)} className={className}><path d={dir === "right" ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} /></svg>
);
export const IconExpand = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
);
export const IconCheckList = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="m4 7 2 2 3-3.5M4 17l2 2 3-3.5M13 7.5h7M13 17.5h7" /></svg>
);
export const IconCalendar = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></svg>
);
export const IconHomework = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg>
);
