import Main from '../../shell/Main';
import { Route, Routes } from 'react-router-dom';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import ProjectPage from './ProjectPage';
import ProjectsPage from './ProjectsPage';
import './projects.css';

export const PROJECTS_BASE = '/projects';

/** The Projects module: the list at /projects and one page per project at /projects/<id>, wrapped the way every module is. */
export default function ProjectsModule() {
  return (
    <ModuleBase value={PROJECTS_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <Main className="main pj-main">
            <Routes>
              <Route index element={<ProjectsPage />} />
              <Route path=":id" element={<ProjectPage />} />
              <Route path="*" element={<ProjectsPage />} />
            </Routes>
          </Main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
