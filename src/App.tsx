import Auth from './components/pages/Auth/Auth.tsx';
import Main from './components/pages/Main/Main.tsx';
import { useGlobalContext } from './core/GlobalContext.tsx';
import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import About from './components/pages/About/About.tsx';
import SplashScreen from './components/common/SplashScreen.tsx';
import UpdateBanner from './components/common/UpdateBanner.tsx';
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

    useEffect(() => {
        const validPages = ['main', 'about', 'audit', 'auth'];

        if (!validPages.includes(currentPage)) {
            setCurrentPage('main');
        }
    }, [currentPage, setCurrentPage]);

    if (isLoading) {
        return <SplashScreen />;
    }

    return (
        <Box sx={{ userSelect: 'none' }}>
            {currentPage === 'auth' && <Auth />}
            {currentPage === 'main' && <Main />}
            {currentPage === 'about' && <About />}
            {currentPage === 'audit' && <Audit />}
            <Box
                sx={{
                    position: 'fixed',
                    bottom: 16,
                    left: 16,
                    right: 16,
                    zIndex: 1000,
                }}
            >
                <UpdateBanner autoCheck={true} compact={false} />
            </Box>
        </Box>
    );
};

export default App;
