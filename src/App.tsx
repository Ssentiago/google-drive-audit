import { Box, CircularProgress } from '@mui/material';
import { ScanProvider } from './core/ScanContext.tsx';
import Auth from './components/pages/Auth/Auth.tsx';
import Main from './components/pages/Main/Main.tsx';
import { useGlobalContext } from './core/GlobalContext.tsx';
import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import DirectScan from './components/pages/modes/DirectScan/DirectScan.tsx';
import DriveScan from './components/pages/modes/DriveScan/DriveScan.tsx';
import AccessList from './components/pages/modes/DriveScan/components/AccessList/AccessList.tsx';
import About from './components/pages/About/About.tsx';
import { DriveAudit } from './components/pages/modes/DriveAudit/DriveAudit.tsx';

const App: React.FC = () => {
    const { currentPage, setCurrentPage, setUserEmail } = useGlobalContext();

    const [isLoading, setIsLoading] = React.useState(true);

    useEffect(() => {
        (async () => {
            try {
                const isAuth = await invoke('is_authenticated');
                if (isAuth) {
                    const email: string = await invoke('get_user_email');
                    setUserEmail(email);
                }
                setCurrentPage(isAuth ? 'main' : 'login');
            } catch {
                setCurrentPage('login');
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    if (isLoading) {
        return null;
    }

    if (
        ![
            'main',
            'access-list',
            'about',
            'direct-scan',
            'drive-scan',
            'audit',
            'login',
        ].includes(currentPage)
    ) {
        setCurrentPage('main');
        return null;
    }

    return (
        <ScanProvider>
            {currentPage === 'login' && <Auth />}

            {currentPage === 'main' && <Main />}
            {currentPage === 'direct-scan' && <DirectScan />}
            {currentPage === 'drive-scan' && <DriveScan />}
            {currentPage === 'access-list' && <AccessList />}
            {currentPage === 'about' && <About />}
            {currentPage === 'audit' && <DriveAudit />}
        </ScanProvider>
    );
};

export default App;
