import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="m15 18-6-6 6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </IconFrame>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="m9 18 6-6-6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="10.5" cy="10.5" r="5.75" stroke="currentColor" strokeWidth="1.7" />
      <path d="m15 15 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconFrame>
  );
}

export function PanelLeftIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
        width="17"
        x="3.5"
        y="4.5"
      />
      <path d="M9 5v14" stroke="currentColor" strokeWidth="1.6" />
    </IconFrame>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="6" cy="12" fill="currentColor" r="1.25" />
      <circle cx="12" cy="12" fill="currentColor" r="1.25" />
      <circle cx="18" cy="12" fill="currentColor" r="1.25" />
    </IconFrame>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </IconFrame>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </IconFrame>
  );
}

export function OutlineIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M6 6h12M6 12h9M6 18h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <circle cx="3.5" cy="6" fill="currentColor" r="1" />
      <circle cx="3.5" cy="12" fill="currentColor" r="1" />
      <circle cx="3.5" cy="18" fill="currentColor" r="1" />
    </IconFrame>
  );
}

export function WorkspaceMark(props: IconProps) {
  return (
    <IconFrame {...props} viewBox="0 0 32 32" height="32" width="32">
      <rect fill="var(--accent-600)" height="28" rx="8" width="28" x="2" y="2" />
      <path
        d="M10 9.5h12M9 16h14M10 22.5h12"
        stroke="white"
        strokeLinecap="round"
        strokeWidth="2.2"
      />
      <path
        d="M13 7.5 11 24.5M21 7.5l-2 17"
        stroke="white"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </IconFrame>
  );
}
