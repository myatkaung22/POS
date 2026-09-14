import type { MenuItem } from "../types";

export function DishPhoto({
  item,
  className = "",
}: {
  item: Pick<MenuItem, "name" | "emoji" | "imageUrl">;
  className?: string;
}) {
  if (item.imageUrl) {
    return <img src={item.imageUrl} alt={item.name} className={`object-cover ${className}`} />;
  }
  return (
    <div className={`grid place-items-center bg-ink-800 text-2xl ${className}`} aria-hidden>
      {item.emoji || "🍽️"}
    </div>
  );
}
