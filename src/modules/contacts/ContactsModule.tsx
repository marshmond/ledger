import Main from '../../shell/Main';
import { Route, Routes, useParams } from 'react-router-dom';
import { ModuleBase } from '../../core/router';
import BackupReminder from '../../shell/BackupReminder';
import { ToastProvider } from '../../ui/Toast';
import ContactPage from './ContactPage';
import DirectoryPage from './DirectoryPage';
import { CONTACTS_BASE } from './model';

const One = () => { const n = Number(useParams().id); return Number.isInteger(n) ? <ContactPage id={n} /> : <DirectoryPage />; };

/** Contacts & Relationships: the directory at /contacts and one page per Contact at /contacts/c/<id>. */
export default function ContactsModule() {
  return (
    <ModuleBase value={CONTACTS_BASE}>
      <ToastProvider>
        <div className="shell-main">
          <BackupReminder />
          <Main className="main ct-main">
            <Routes>
              <Route index element={<DirectoryPage />} />
              <Route path="c/:id" element={<One />} />
              <Route path="*" element={<DirectoryPage />} />
            </Routes>
          </Main>
        </div>
      </ToastProvider>
    </ModuleBase>
  );
}
