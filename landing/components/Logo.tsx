// The Aperture mark: a shutter whose opening is a door. Drawn in currentColor so it follows the text color.
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={size < 24 ? 3.6 : 2.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <defs><clipPath id="aperture-ring"><circle cx="32" cy="32" r="27"/></clipPath></defs><circle cx="32" cy="32" r="27"/><g clipPath="url(#aperture-ring)"><path d="M40.5 47.0L54.4 47.0M40.5 26.5L40.5 6.4M23.5 26.5L5.6 26.5M23.5 47.0L23.5 57.6"/></g><path d="M23.5 47V26.5A8.5 8.5 0 0 1 40.5 26.5V47Z"/><circle cx="36.9" cy="35" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  );
}
