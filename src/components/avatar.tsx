import { cn } from "@/lib/utils";

/**
 * A person, as a face or as their initials.
 *
 * No uploads yet, so the fallback is the normal case and has to look deliberate
 * rather than like a missing image. The colour is derived from the name, so the same
 * person is always the same colour — which is what makes a picker scannable at a
 * glance instead of read letter by letter.
 */

/** Hues far enough apart to be told apart, and none that read as an error state. */
const HUES = [212, 262, 330, 22, 162, 192, 288, 42];

function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return HUES[Math.abs(hash) % HUES.length];
}

export function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  email,
  image,
  size = 56,
  className,
}: {
  name: string | null;
  email: string;
  image?: string | null;
  size?: number;
  className?: string;
}) {
  const hue = hueFor(name?.trim() || email);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        // Light tint, saturated ink: the same fill-versus-ink split as the tier chips,
        // so initials stay readable at 4.5:1 in both themes (§7a).
        backgroundColor: `oklch(0.93 0.05 ${hue})`,
        color: `oklch(0.42 0.13 ${hue})`,
      }}
      aria-hidden
    >
      {image ? (
        /* Avatars are arbitrary remote URLs; next/image would need every host
           allow-listed up front, and these are already sized to a fixed box. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" width={size} height={size} className="size-full object-cover" />
      ) : (
        initialsOf(name, email)
      )}
    </span>
  );
}
