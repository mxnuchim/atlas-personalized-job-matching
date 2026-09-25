/**
 * A single bordered strip divided by hairlines — deliberately NOT a kit of
 * identical shadowed cards (PRD §10.5). Numerals are tabular and set in the
 * display face.
 */
export function StatStrip({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <dl className="divide-border grid grid-cols-1 divide-y rounded-xl border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((item) => (
        <div key={item.label} className="px-5 py-4">
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd className="font-display mt-1 text-2xl font-semibold tabular-nums">{item.value}</dd>
          {item.hint ? <p className="text-muted-foreground mt-0.5 text-xs">{item.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}
