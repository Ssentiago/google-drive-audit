import Auth from './components/pages/Auth/Auth.tsx';
import Main from './components/pages/Main/Main.tsx';
import { useGlobalContext } from './core/GlobalContext.tsx';
import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import About from './components/pages/About/About.tsx';
import SplashScreen from './components/common/SplashScreen.tsx';
import { Audit } from './components/pages/Audit/Audit.tsx';
import { Box } from '@mui/material';

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
        return <SplashScreen />;
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
        <Box sx={{ userSelect: 'none' }}>
            {currentPage === 'login' && <Auth />}
            {currentPage === 'main' && <Main />}
            {currentPage === 'about' && <About />}
            {currentPage === 'audit' && <Audit />}
        </Box>
    );
};

export default App;
