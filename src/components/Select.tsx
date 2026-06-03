import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

/**
 * A native <select> styled to match the app's inputs — strips the OS chrome
 * (`appearance-none`) and adds a brand-consistent chevron. Layout/flex classes
 * go on `wrapperClassName`; `className` tweaks the control itself.
 */
export function Select({
  className = "",
  wrapperClassName = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select
        {...props}
        className={`touch-target w-full appearance-none rounded-xl border border-line bg-surface pl-3 pr-9 text-base text-foreground outline-none transition-colors focus:border-brand ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
