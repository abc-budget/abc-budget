import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import type { RouteObject } from 'react-router';
import { useHasData } from './has-data';
import { Dashboard } from './screens/Dashboard';
import { ImportFlow } from './screens/ImportFlow';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';

/** «/» per FEAT-030: hasData ? Dashboard : Onboarding (first-run home IS root). */
function Root() {
  return useHasData() ? <Navigate to="/dashboard" replace /> : <Onboarding />;
}

/**
 * Route table — DATA-router objects since 2.7: ImportFlow's useBlocker
 * exit-protection needs the data-router context (declarative <BrowserRouter>
 * has no blocker support). Tests mount these via createMemoryRouter.
 */
export const routes: RouteObject[] = [
  { path: '/', element: <Root /> },
  { path: '/dashboard', element: <Dashboard /> },
  { path: '/settings', element: <Settings /> },
  { path: '/import', element: <ImportFlow /> },
  { path: '*', element: <Navigate to="/" replace /> },
];

/** Production mount (lazy singleton — createBrowserRouter touches history). */
let browserRouter: ReturnType<typeof createBrowserRouter> | undefined;
export function AppRouter() {
  browserRouter ??= createBrowserRouter(routes);
  return <RouterProvider router={browserRouter} />;
}
