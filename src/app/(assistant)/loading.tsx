export default function Loading() {
  return (
    <div className="page-wrap" aria-busy="true">
      <div className="skeleton title" />
      <div className="skeleton searchbar" />
      {[1, 2, 3].map((x) => (
        <div className="skeleton card" key={x} />
      ))}
    </div>
  );
}
