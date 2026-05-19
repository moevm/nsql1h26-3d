import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { SettingsProvider } from '@/lib/SettingsContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AuthPage from '@/components/AuthPage';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, login, register, isAuthenticated } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      return <AuthPage error={authError} onLogin={login} onRegister={register} />;
    }
  }

  const sections = ["datasets", "benchmarks", "spatial", "settings", "profile", "admin", "backup"];
  return (
    <Routes>
      <Route
        path="/auth"
        element={
          isAuthenticated
            ? <Navigate to="/datasets" replace />
            : <AuthPage error={authError} onLogin={login} onRegister={register} />
        }
      />
      <Route path="/" element={<Navigate to="/datasets" replace />} />
      {sections.map((section) => (
        <Route
          key={section}
          path={`/${section}`}
          element={
            <LayoutWrapper currentPageName={mainPageKey}>
              <MainPage />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/dataset/:datasetId" element={
        <LayoutWrapper currentPageName="datasets">
          <MainPage />
        </LayoutWrapper>
      } />
      <Route path="/benchmark/:benchmarkId" element={
        <LayoutWrapper currentPageName="benchmarks">
          <MainPage />
        </LayoutWrapper>
      } />
      <Route path="/user/:userId" element={
        <LayoutWrapper currentPageName="admin">
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <SettingsProvider>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </SettingsProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
