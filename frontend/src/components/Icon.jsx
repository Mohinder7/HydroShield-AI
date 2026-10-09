const iconPaths = {
    alert: (
        <>
            <path d="M10.3 3.9 2.7 17a1.2 1.2 0 0 0 1 1.8h16.6a1.2 1.2 0 0 0 1-1.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" />
            <path d="M12 16.5h.01" />
        </>
    ),
    bell: (
        <>
            <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M10 21h4" />
        </>
    ),
    building: (
        <>
            <path d="M4 21V5.5L12 3v18" />
            <path d="M12 8h8v13H4" />
            <path d="M7.5 8.5h1M7.5 12h1M7.5 15.5h1M15.5 11h1M15.5 14.5h1M15.5 18h1" />
        </>
    ),
    chart: (
        <>
            <path d="M4 19V5M4 19h17" />
            <path d="m7 15 4-4 3 2 5-6" />
        </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    cpu: (
        <>
            <rect x="6" y="6" width="12" height="12" rx="2" />
            <path d="M9 6V4M12 6V4M15 6V4M9 20v-2M12 20v-2M15 20v-2M4 9H6M4 12H6M4 15H6M18 9h2M18 12h2M18 15h2" />
            <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
        </>
    ),
    droplet: <path d="M12 3.5S5.5 11 5.5 15.2a6.5 6.5 0 0 0 13 0C18.5 11 12 3.5 12 3.5Z" />,
    filter: (
        <>
            <path d="M3 6h18M7 12h10M11 18h2" />
        </>
    ),
    food: (
        <>
            <path d="M6 3v6M9 3v6M6 6h3M7.5 9v12" />
            <path d="M15 3v18M15 3c2 2 3 4 3 7h-3" />
        </>
    ),
    globe: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M3.5 12h17M12 3c2.2 2.4 3.2 5.4 3.2 9s-1 6.6-3.2 9c-2.2-2.4-3.2-5.4-3.2-9S9.8 5.4 12 3Z" />
        </>
    ),
    grid: (
        <>
            <rect x="4" y="4" width="6" height="6" rx="1" />
            <rect x="14" y="4" width="6" height="6" rx="1" />
            <rect x="4" y="14" width="6" height="6" rx="1" />
            <rect x="14" y="14" width="6" height="6" rx="1" />
        </>
    ),
    info: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
        </>
    ),
    layers: (
        <>
            <path d="m12 3 9 5-9 5-9-5 9-5Z" />
            <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
        </>
    ),
    map: (
        <>
            <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
            <path d="M9 3v15M15 6v15" />
        </>
    ),
    medical: (
        <>
            <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z" />
        </>
    ),
    phone: <path d="M7 3h3l1.5 4-2 1.5a14 14 0 0 0 6 6l1.5-2 4 1.5v3c0 1.1-.9 2-2 2A16 16 0 0 1 5 5c0-1.1.9-2 2-2Z" />,
    pin: (
        <>
            <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
            <circle cx="12" cy="10" r="2.2" />
        </>
    ),
    refresh: (
        <>
            <path d="M20 7v5h-5M4 17v-5h5" />
            <path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" />
        </>
    ),
    route: (
        <>
            <circle cx="6" cy="18" r="2.2" />
            <circle cx="18" cy="6" r="2.2" />
            <path d="M8.2 18H11a3 3 0 0 0 3-3v-1a3 3 0 0 1 3-3h1" />
        </>
    ),
    ruler: (
        <>
            <path d="m4 16 12-12 5 5L9 21l-5-5Z" />
            <path d="m13 7 2 2M10 10l2 2M7 13l2 2" />
        </>
    ),
    search: (
        <>
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 4.5 4.5" />
        </>
    ),
    shield: (
        <>
            <path d="M12 3 19 6v5c0 4.2-2.8 7.7-7 10-4.2-2.3-7-5.8-7-10V6l7-3Z" />
            <path d="M7.5 12.5c1.4-1 2.4-1 4 0s2.6 1 5 0" />
        </>
    ),
    upload: (
        <>
            <path d="M12 15V4M8 8l4-4 4 4" />
            <path d="M5 14v5h14v-5" />
        </>
    ),
};

function Icon({ name, size = 18, className = "" }) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
        >
            {iconPaths[name] || iconPaths.grid}
        </svg>
    );
}

export default Icon;
