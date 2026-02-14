import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Alert, Box, Button, Card, Container, Typography } from '@mui/material';
import { useGlobalContext } from '../../../core/GlobalContext';
import { FaGoogle } from 'react-icons/fa';

const Auth = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<null | string>(null);
    const { setCurrentPage, setUserEmail } = useGlobalContext();

    const handleLogin = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await invoke('start_google_oauth');
            const userEmail: string = await invoke('get_user_email');
            setUserEmail(userEmail);
            setCurrentPage('main');
        } catch (err) {
            setError(String(err));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            <Container maxWidth='xs'>
                <Card
                    elevation={0}
                    sx={{ p: 4 }}
                >
                    <Typography
                        variant='h4'
                        component='h1'
                        sx={{ mb: 4, textAlign: 'center', fontWeight: 700 }}
                    >
                        Авторизация в Google
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
                        sx={{
                            '& .MuiButton-startIcon': {
                                marginRight: 1.5,
                                display: 'flex',
                                alignItems: 'center',
                            },
                        }}
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
                            Откроется браузер. После входа вернитесь в
                            приложение.
                        </Typography>
                    )}
                </Card>
            </Container>
        </Box>
    );
};

export default Auth;
