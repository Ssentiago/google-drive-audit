import { Container, Card, Typography, Button, Box } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import LinkIcon from '@mui/icons-material/Link';
import SecurityIcon from '@mui/icons-material/Security'; // ← новая иконка для аудита
import InfoIcon from '@mui/icons-material/Info';
import LogoutIcon from '@mui/icons-material/Logout';
import { invoke } from '@tauri-apps/api/core';
import { useGlobalContext } from '../../../core/GlobalContext.tsx';

const Main = () => {
    const { setCurrentPage } = useGlobalContext();

    const handleLogout = async () => {
        try {
            await invoke('logout');
        } catch (e) {
            console.error('Logout error:', e);
        }
        setCurrentPage('auth');
    };

    return (
        <Container maxWidth='sm'>
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    mt: 3,
                    mb: 2,
                }}
            >
                <Button
                    variant='text'
                    startIcon={<LogoutIcon />}
                    onClick={handleLogout}
                    sx={{ color: 'primary.main', textTransform: 'none' }}
                >
                    Выход
                </Button>
            </Box>

            <Card sx={{ p: 4, mt: 1 }}>
                <Typography
                    variant='h4'
                    component='h1'
                    sx={{ mb: 1, textAlign: 'center', fontWeight: 700 }}
                >
                    Google Drive Audit
                </Typography>
                <Typography
                    variant='body2'
                    sx={{ mb: 4, textAlign: 'center', color: 'text.secondary' }}
                >
                    Управление доступами к файлам
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* 1. Сканирование папки */}
                    <Button
                        variant='contained'
                        size='large'
                        startIcon={<FolderIcon />}
                        onClick={() => setCurrentPage('drive-scan')}
                        sx={{ py: 2 }}
                    >
                        Сканирование папки
                    </Button>

                    {/* 2. Прямое сканирование */}
                    <Button
                        variant='outlined'
                        size='large'
                        startIcon={<LinkIcon />}
                        onClick={() => setCurrentPage('direct-scan')}
                        sx={{ py: 2 }}
                    >
                        Прямое сканирование
                    </Button>

                    {/* 3. НОВЫЙ РЕЖИМ — АУДИТ */}
                    <Button
                        variant='outlined'
                        color='secondary'
                        size='large'
                        startIcon={<SecurityIcon />}
                        onClick={() => setCurrentPage('audit')} // ← вот сюда ведёт
                        sx={{ py: 2 }}
                    >
                        Аудит
                    </Button>

                    <Button
                        variant='text'
                        startIcon={<InfoIcon />}
                        onClick={() => setCurrentPage('about')}
                        sx={{ mt: 2 }}
                    >
                        О приложении
                    </Button>
                </Box>
            </Card>
        </Container>
    );
};

export default Main;
