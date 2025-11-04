import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Container, Card, Typography, Button, Alert } from '@mui/material';
import { useGlobalContext } from '../../../core/GlobalContext';
import { FaGoogle } from 'react-icons/fa';

const Auth = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<null | string>(null);
    const { setCurrentPage } = useGlobalContext();

    const handleLogin = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await invoke('force_reauth');
            const token = await invoke('start_google_oauth');
            console.log('✅ Токен получен:', token);
            setCurrentPage('main');
        } catch (err) {
            setError(String(err));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Container maxWidth='sm'>
            <Card sx={{ p: 4, mt: 8 }}>
                <Typography
                    variant='h4'
                    component='h1'
                    sx={{ mb: 4, textAlign: 'center', fontWeight: 700 }}
                >
                    Авторизация Google Drive
                </Typography>

                {error && (
                    <Alert
                        severity='error'
                        sx={{ mb: 2 }}
                    >
                        {error}
                    </Alert>
                )}

                <Button
                    variant='contained'
                    fullWidth
                    size='large'
                    onClick={handleLogin}
                    disabled={isLoading}
                    startIcon={<FaGoogle />}
                >
                    {isLoading ? 'Авторизация...' : 'Войти через Google'}
                </Button>

                {isLoading && (
                    <Typography
                        variant='body2'
                        sx={{
                            mt: 2,
                            color: 'text.secondary',
                            textAlign: 'center',
                        }}
                    >
                        Откроется браузер. После входа вернитесь в приложение.
                    </Typography>
                )}
            </Card>
        </Container>
    );
};

export default Auth;
