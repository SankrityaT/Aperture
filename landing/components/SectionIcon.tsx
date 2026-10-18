// Section-label icons: the Aperture mark in six states, one per section (a shut door, then more open).
const ICONS = {
  closed: (<><circle cx="32" cy="32" r="27"/><g clipPath="url(#aperture-ring)"><path d="M40.5 17.5L54.8 17.5M40.5 46.5L40.5 57.6M23.5 46.5L9.2 46.5M23.5 17.5L23.5 6.4"/></g><rect x="23.5" y="17.5" width="17.0" height="29.0"/></>),
  arch: (<><circle cx="32" cy="32" r="27"/><g clipPath="url(#aperture-ring)"><path d="M40.5 47.0L54.4 47.0M40.5 26.5L40.5 6.4M23.5 26.5L5.6 26.5M23.5 47.0L23.5 57.6"/></g><path d="M23.5 47V26.5A8.5 8.5 0 0 1 40.5 26.5V47Z"/></>),
  filled: (<><circle cx="32" cy="32" r="27"/><g clipPath="url(#aperture-ring)"><path d="M40.5 47.0L54.4 47.0M40.5 26.5L40.5 6.4M23.5 26.5L5.6 26.5M23.5 47.0L23.5 57.6"/></g><path d="M23.5 47V26.5A8.5 8.5 0 0 1 40.5 26.5V47Z" fill="currentColor"/></>),
  logo: (<><circle cx="32" cy="32" r="27"/><g clipPath="url(#aperture-ring)"><path d="M40.5 47.0L54.4 47.0M40.5 26.5L40.5 6.4M23.5 26.5L5.6 26.5M23.5 47.0L23.5 57.6"/></g><path d="M23.5 47V26.5A8.5 8.5 0 0 1 40.5 26.5V47Z"/><circle cx="36.9" cy="35" r="1.5" fill="currentColor" stroke="none"/></>),
  open: (<><path d="M57.7 40.3A27 27 0 1 1 58.7 28.2"/><path d="M40.5 26.5L40.5 6.4M23.5 26.5L5.6 26.5M23.5 47.0L23.5 57.6"/><path d="M40.5 47H59.4"/><path d="M23.5 47V26.5A8.5 8.5 0 0 1 40.5 26.5V47Z" fill="currentColor"/></>),
  ask: (<><circle cx="32" cy="32" r="27"/><g clipPath="url(#aperture-ring)"><path d="M40.5 47.0L54.4 47.0M40.5 26.5L40.5 6.4M23.5 26.5L5.6 26.5M23.5 47.0L23.5 57.6"/></g><path d="M23.5 47V26.5A8.5 8.5 0 0 1 40.5 26.5V47Z"/><circle cx="32" cy="9.2" r="1.6" fill="currentColor" stroke="none"/></>),
} as const;

export type SectionIconName = keyof typeof ICONS;

export function SectionIcon({ name, size = 30 }: { name: SectionIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <defs><clipPath id="aperture-ring"><circle cx="32" cy="32" r="27"/></clipPath></defs>
      {ICONS[name]}
    </svg>
  );
}
