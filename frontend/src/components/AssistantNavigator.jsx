import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';

/**
 * Lets Ian switch the app to another page ("open the sales page").
 * handleAssistantUi() puts the request here; the component below, mounted
 * inside the router, carries it out. Only in-app paths are accepted.
 */
export const useNavRequest = create((set) => ({
  request: null, // { path, id }
  go: (path) => set({ request: { path, id: Date.now() } }),
  clear: () => set({ request: null }),
}));

export default function AssistantNavigator() {
  const request = useNavRequest((s) => s.request);
  const clear = useNavRequest((s) => s.clear);
  const navigate = useNavigate();

  useEffect(() => {
    if (!request) return;
    const { path } = request;
    if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) navigate(path);
    clear();
  }, [request, navigate, clear]);

  return null;
}
