export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-20">
      <p className="mb-4 text-sm font-semibold tracking-[0.2em] text-emerald-700 uppercase">
        Kotori Mail Bird
      </p>
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
        Your inbox, distilled into clear next actions.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
        Kotori classifies Gmail threads, summarizes requests, and prepares reply
        options for your review. It creates drafts only—nothing is ever sent
        automatically.
      </p>
      <p className="mt-10 text-sm text-slate-500">
        The Gmail assistant MVP is being prepared.
      </p>
    </main>
  );
}
