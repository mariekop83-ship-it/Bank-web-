import React, { createContext, useContext, useEffect, useState } from 'react';

interface RouterContextValue {
  path: string;
  query: URLSearchParams;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterContextValue>({
  path: '/',
  query: new URLSearchParams(),
  navigate: () => {},
});

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [locationState, setLocationState] = useState(() => ({
    path: window.location.pathname || '/',
    search: window.location.search || '',
  }));

  useEffect(() => {
    const onPopState = () => {
      setLocationState({
        path: window.location.pathname || '/',
        search: window.location.search || '',
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (to: string) => {
    const url = new URL(to, window.location.origin);
    if (url.pathname === locationState.path && url.search === locationState.search) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.history.pushState({}, '', `${url.pathname}${url.search}`);
    setLocationState({ path: url.pathname, search: url.search });
    window.scrollTo({ top: 0 });
  };

  return (
    <RouterContext.Provider
      value={{
        path: locationState.path,
        query: new URLSearchParams(locationState.search),
        navigate,
      }}
    >
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  return useContext(RouterContext);
}
