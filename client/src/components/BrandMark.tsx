export function BrandMark({
  size = 36,
  stacked = false,
  light = false,
}: {
  size?: number;
  stacked?: boolean;
  light?: boolean;
}) {
  return (
    <div className={`flex ${stacked ? "flex-col items-start gap-1" : "items-center gap-2.5"}`}>
      <img src="/logo.png" alt="4 Corner" style={{ height: size }} className="w-auto object-contain" />
      <div className={stacked ? "pl-0.5" : ""}>
        <div className={`text-[10px] font-semibold tracking-[0.2em] uppercase ${light ? "text-black/45" : "text-white/45"}`}>
          OmniMind POS
        </div>
        {stacked && (
          <div className={`text-xs ${light ? "text-black/70" : "text-white/70"}`}>Bar & Restaurant</div>
        )}
      </div>
    </div>
  );
}
