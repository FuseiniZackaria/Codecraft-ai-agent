import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { api } from '../services/api';

/**
 * Shown across the app when the admin's WhatsApp (WAHA) session failed or was
 * logged out from the phone. Checks on load and every 2 minutes; quiet when
 * WhatsApp isn't set up or works fine.
 */
const CHECK_MS = 2 * 60 * 1000;

export default function WhatsAppReconnectBanner() {
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const s = await api.getWhatsappSession();
        if (!stopped) setNeedsReconnect(!!s.needsReconnect || s.status === 'FAILED');
      } catch {
        /* backend unreachable - the app's own connection banner covers that */
      }
    }
    check();
    const t = setInterval(check, CHECK_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [pathname === '/toolbox/connections']); // re-check after visiting Connections

  if (!needsReconnect || pathname === '/toolbox/connections') return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/30 px-4 py-1.5 text-xs text-[var(--color-danger)]">
      <AlertTriangle size={13} />
      WhatsApp was disconnected, so messages aren&apos;t being received or sent.
      <Link to="/toolbox/connections" className="font-semibold underline">Reconnect</Link>
    </div>
  );
}
