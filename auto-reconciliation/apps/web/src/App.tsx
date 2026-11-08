import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PacksPage } from "./pages/PacksPage";
import { DatasetsPage } from "./pages/DatasetsPage";
import { RunsPage } from "./pages/RunsPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { DiffsPage } from "./pages/DiffsPage";
import { AdjustmentsPage } from "./pages/AdjustmentsPage";
import { GatesPage } from "./pages/GatesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AutomationPage } from "./pages/AutomationPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<WorkbenchPage />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route path="diffs" element={<DiffsPage />} />
        <Route path="adjustments" element={<AdjustmentsPage />} />
        <Route path="gates" element={<GatesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="advanced/packs" element={<PacksPage />} />
        <Route path="advanced/datasets" element={<DatasetsPage />} />
        <Route path="advanced/settings" element={<SettingsPage />} />
        <Route path="advanced/automation" element={<Navigate to="/automation" replace />} />
        <Route path="packs" element={<Navigate to="/advanced/packs" replace />} />
        <Route path="datasets" element={<Navigate to="/advanced/datasets" replace />} />
        <Route path="settings" element={<Navigate to="/advanced/settings" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
