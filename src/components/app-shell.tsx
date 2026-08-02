"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { authClient } from "@/lib/auth-client";

const nav = [
  ["/inbox", "Inbox", "inbox"],
  ["/drafts", "Drafts", "draft"],
  ["/follow-ups", "Follow-ups", "clock"],
  ["/notifications", "Notifications", "bell"],
  ["/settings", "Settings", "settings"],
] as const;

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name?: string | null; email?: string | null; image?: string | null };
}) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/inbox">
          <span className="brand-mark">
            <Icon name="bird" />
          </span>
          <span>Kotori</span>
        </Link>
        <nav aria-label="Primary navigation">
          {nav.map(([href, label, icon]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname.startsWith(href) ? "page" : undefined}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="profile">
          <span className="avatar">{user.name?.[0] ?? "K"}</span>
          <span>
            <strong>{user.name ?? "Kotori user"}</strong>
            <small>{user.email}</small>
          </span>
          <button
            type="button"
            onClick={() =>
              authClient.signOut({
                fetchOptions: { onSuccess: () => location.assign("/sign-in") },
              })
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <main id="main-content">{children}</main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        {nav.map(([href, label, icon]) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname.startsWith(href) ? "page" : undefined}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
