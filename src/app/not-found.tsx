import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-wrap">
      <p className="eyebrow">404</p>
      <h1>That page flew away</h1>
      <p>
        The page or mailbox item no longer exists or is not available to you.
      </p>
      <Link className="primary-button" href="/inbox">
        Return to inbox
      </Link>
    </main>
  );
}
