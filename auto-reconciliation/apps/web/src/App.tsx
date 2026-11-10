import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PacksPage } from "./pages/PacksPage";
import { RunsPage } from "./pages/RunsPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AutomationPage } from "./pages/AutomationPage";
import { AutomationSettingsPage } from "./pages/AutomationSettingsPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<WorkbenchPage />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="advanced/packs" element={<PacksPage />} />
        <Route path="advanced/settings" element={<SettingsPage />} />
        <Route path="advanced/automation" element={<AutomationSettingsPage />} />
        <Route path="packs" element={<Navigate to="/advanced/packs" replace />} />
        <Route path="settings" element={<Navigate to="/advanced/settings" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
