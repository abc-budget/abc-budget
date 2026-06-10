import { LangProvider } from '../app/i18n/LangProvider';
import { AppRouter } from '../app/router';

export function App() {
  return (
    <LangProvider>
      <AppRouter />
    </LangProvider>
  );
}
