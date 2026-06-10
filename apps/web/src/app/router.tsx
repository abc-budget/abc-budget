import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useHasData } from './has-data';
import { Dashboard } from './screens/Dashboard';
import { ImportFlow } from './screens/ImportFlow';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';

/** «/» per FEAT-030: hasData ? Dashboard : Onboarding (first-run home IS root). */
function Root() {
  return useHasData() ? <Navigate to="/dashboard" replace /> : <Onboarding />;
}

/** Routes only — testable under MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/import" element={<ImportFlow />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Production mount. */
export function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
