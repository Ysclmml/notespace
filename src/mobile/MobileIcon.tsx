export type MobileIconName =
  | "back"
  | "book"
  | "chevron"
  | "clock"
  | "computer"
  | "disconnect"
  | "document"
  | "folder"
  | "outline"
  | "scan"
  | "search"
  | "settings"
  | "star"
  | "wifi";

export function MobileIcon({
  name,
  size = 22,
}: {
  readonly name: MobileIconName;
  readonly size?: number;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
  };
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
      {name === "back" && <path {...common} d="m15 18-6-6 6-6" />}
      {name === "book" && (
        <>
          <path
            {...common}
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"
          />
          <path
            {...common}
            d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"
          />
        </>
      )}
      {name === "chevron" && <path {...common} d="m9 6 6 6-6 6" />}
      {name === "clock" && (
        <>
          <circle {...common} cx="12" cy="12" r="8.5" />
          <path {...common} d="M12 7.5V12l3 2" />
        </>
      )}
      {name === "computer" && (
        <>
          <rect {...common} height="12" rx="1.8" width="18" x="3" y="4" />
          <path {...common} d="M8 20h8M10 16v4M14 16v4" />
        </>
      )}
      {name === "disconnect" && (
        <>
          <path
            {...common}
            d="M5 8.5a10 10 0 0 1 11.4-1.9M3 5l16 14M8.5 12.2A5.3 5.3 0 0 1 12 11c.7 0 1.4.1 2 .4M11 16.5a1.4 1.4 0 0 1 2 0"
          />
        </>
      )}
      {name === "document" && (
        <>
          <path {...common} d="M6 2.8h8l4 4V21H6z" />
          <path {...common} d="M14 2.8v4h4M9 11h6M9 15h6" />
        </>
      )}
      {name === "folder" && (
        <path
          {...common}
          d="M3 6.5h7l2 2h9v10.2A2.3 2.3 0 0 1 18.7 21H5.3A2.3 2.3 0 0 1 3 18.7z"
        />
      )}
      {name === "outline" && (
        <>
          <path {...common} d="M9 6h11M9 12h11M9 18h11" />
          <circle cx="4" cy="6" fill="currentColor" r="1" />
          <circle cx="4" cy="12" fill="currentColor" r="1" />
          <circle cx="4" cy="18" fill="currentColor" r="1" />
        </>
      )}
      {name === "scan" && (
        <>
          <path
            {...common}
            d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"
          />
          <path {...common} d="M8 9v6M12 8v8M16 9v6" />
        </>
      )}
      {name === "search" && (
        <>
          <circle {...common} cx="10.5" cy="10.5" r="6.5" />
          <path {...common} d="m15.5 15.5 4 4" />
        </>
      )}
      {name === "settings" && (
        <>
          <path {...common} d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
        </>
      )}
      {name === "star" && (
        <path
          {...common}
          d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"
        />
      )}
      {name === "wifi" && (
        <>
          <path
            {...common}
            d="M4.2 9a12 12 0 0 1 15.6 0M7.2 12.2a7.5 7.5 0 0 1 9.6 0M10.2 15.3a3 3 0 0 1 3.6 0"
          />
          <circle cx="12" cy="18.2" fill="currentColor" r="1" />
        </>
      )}
    </svg>
  );
}
