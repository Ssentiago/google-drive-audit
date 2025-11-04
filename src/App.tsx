import React from 'react';
import Auth from './components/pages/Auth/Auth';
import DriveScan from './components/pages/DriveScan/DriveScan.tsx';
import AccessList from './components/pages/DriveScan/components/AccessList/AccessList';
import { useGlobalContext } from './core/GlobalContext';
import { ScanProvider } from './core/ScanContext.tsx';
import About from './components/pages/About/About.tsx';
import DirectScan from './components/pages/DirectScan/DirectScan.tsx';
import Main from './components/pages/Main/Main.tsx';
import Audit, { AuditMode } from './components/pages/Audit/Audit.tsx';

const App: React.FC = () => {
    const { currentPage } = useGlobalContext();

    if (
        ![
            'main',
            'access-list',
            'about',
            'direct-scan',
            'drive-scan',
            'audit',
        ].includes(currentPage)
    ) {
        return <Auth />;
    }

    return (
        <ScanProvider>
            {currentPage === 'main' && <Main />}
            {currentPage === 'direct-scan' && <DirectScan />}
            {currentPage === 'drive-scan' && <DriveScan />}
            {currentPage === 'access-list' && <AccessList />}
            {currentPage === 'about' && <About></About>}
            {currentPage == 'audit' && <AuditMode />}
        </ScanProvider>
    );
};

export default App;
