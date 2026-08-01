export function Icon({
  name,
}: {
  name: "inbox" | "draft" | "clock" | "bell" | "settings" | "search" | "bird";
}) {
  const paths = {
    inbox: "M3 12h4l2 3h6l2-3h4M5 5h14l2 7v7H3v-7l2-7Z",
    draft: "M5 19h14M6 15l1-4 9-9 3 3-9 9-4 1Z",
    clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4",
    settings:
      "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 12l2-1-2-4-2 1-2-2V3h-6v3L7 8 5 7l-2 4 2 1-2 1 2 4 2-1 2 2v3h6v-3l2-2 2 1 2-4-2-1Z",
    search: "m21 21-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    bird: "M5 17c5 2 12-1 14-9-3 2-6 1-8-2-1 4-3 6-6 7Z",
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={paths[name]} />
    </svg>
  );
}
