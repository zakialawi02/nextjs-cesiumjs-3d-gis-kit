import type { ReactNode } from "react";

/**
 * Guest pages (layouts/guest.blade.php): login, forgot and reset password. Each page redirects
 * signed-in users to the map itself (the proxy lets these paths through).
 */
const AUTOFILL_STYLES = `
input::-ms-reveal,
input::-ms-clear { display: none !important; }
::-webkit-contacts-auto-fill-button { visibility: hidden !important; display: none !important; pointer-events: none !important; }
input:-webkit-autofill { -webkit-box-shadow: 0 0 0 1000px transparent inset !important; -webkit-text-fill-color: inherit !important; caret-color: inherit !important; }
`;

export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{AUTOFILL_STYLES}</style>
      {children}
    </>
  );
}
