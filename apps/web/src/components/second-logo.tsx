import { cn } from "@/lib/utils";

export function SecondLogo({ className }: { className?: string }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 516 479"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5", className)}
      aria-hidden
    >
      <path
        d="M280.077 0C303.874 0 323.166 21.4292 323.166 47.8633V120.154H141.528C123.085 120.154 108.133 141.584 108.133 168.018V311.606C108.133 338.04 123.085 359.47 141.528 359.47H323.166V430.769C323.166 457.203 303.874 478.632 280.077 478.632H43.0889C19.2916 478.632 0 457.203 0 430.769V47.8633C0 21.4292 19.2916 0 43.0889 0H280.077Z"
        fill="currentColor"
      />
      <path
        d="M230 119H370.25C401.417 119 417 139 417 179V419C417 459 401.417 479 370.25 479H276.75C245.583 479 230 459 230 419V119Z"
        fill="currentColor"
      />
      <path
        d="M296 273H461C497.667 273 516 284.444 516 307.333V444.667C516 467.556 497.667 479 461 479H351C314.333 479 296 467.556 296 444.667V273Z"
        fill="currentColor"
      />
    </svg>
  );
}
