import { useUI } from "@/contexts/UIContext";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  /** "lockup" = mark + name in the interface language; "mark" = the nūn alone */
  variant?: "lockup" | "mark";
  /** Sets the height; the width follows the file */
  className?: string;
}

/**
 * The Narwi logo from public/brand (synced from brand/logo). Brand rules: always the drawn file,
 * never the name typed in a font; the Arabic lockup in Arabic, the English lockup in English.
 */
export function BrandLogo({ variant = "lockup", className }: BrandLogoProps) {
  const { lang } = useUI();
  const name = variant === "mark" ? "narwi-mark" : `narwi-lockup-${lang}`;
  const alt = lang === "ar" ? "نروي" : "Narwi";

  return (
    <>
      <img src={`/brand/${name}.svg`} alt={alt} className={cn("w-auto dark:hidden", className)} />
      <img src={`/brand/${name}-dark.svg`} alt={alt} className={cn("hidden w-auto dark:block", className)} />
    </>
  );
}
