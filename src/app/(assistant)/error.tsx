"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="state-page">
      <span>!</span>
      <h1>Something went off course</h1>
      <p>Your data is safe. Try loading this view again.</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
