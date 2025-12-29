import {
    Box,
    Button,
    Card,
    Chip,
    Container,
    Typography,
    Stack,
    alpha,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import LinkIcon from '@mui/icons-material/Link';
import SecurityIcon from '@mui/icons-material/Security';
import InfoIcon from '@mui/icons-material/Info';
import LogoutIcon from '@mui/icons-material/Logout';
import { invoke } from '@tauri-apps/api/core';
import { useGlobalContext } from '../../../core/GlobalContext.tsx';

const Main = () => {
    const { setCurrentPage, userEmail } = useGlobalContext();

    const handleLogout = async () => {
        try {
            await invoke('logout');
        } catch (e) {
            console.error('Logout error:', e);
        }
        setCurrentPage('auth');
    };

    const menuItems = [
        {
            title: 'Сканирование папки',
            description: 'Проверка всех файлов в выбранной папке',
            icon: <FolderIcon sx={{ fontSize: 28 }} />,
            action: () => setCurrentPage('drive-scan'),
            variant: 'contained' as const,
            color: 'primary' as const,
        },
        {
            title: 'Прямое сканирование',
            description: 'Быстрая проверка конкретных файлов',
            icon: <LinkIcon sx={{ fontSize: 28 }} />,
            action: () => setCurrentPage('direct-scan'),
            variant: 'outlined' as const,
            color: 'primary' as const,
        },
        {
            title: 'Аудит',
            description: 'Просмотр и управление доступами',
            icon: <SecurityIcon sx={{ fontSize: 28 }} />,
            action: () => setCurrentPage('audit'),
            variant: 'outlined' as const,
            color: 'secondary' as const,
        },
    ];

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                position: 'relative',
                background: (theme) =>
                    `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
            }}
        >
            {/* Header with user info */}
            <Box
                sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    p: 3,
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: 1.5,
                }}
            >
                <Chip
                    label={userEmail}
                    size='medium'
                    sx={{
                        fontWeight: 500,
                        bgcolor: 'background.paper',
                        border: 1,
                        borderColor: 'divider',
                        px: 1,
                    }}
                />
                <Button
                    variant='outlined'
                    size='small'
                    startIcon={<LogoutIcon />}
                    onClick={handleLogout}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 500,
                    }}
                >
                    Выход
                </Button>
            </Box>

            <Container maxWidth='md'>
                <Card
                    sx={{
                        p: 5,
                        borderRadius: 3,
                        boxShadow: (theme) =>
                            `0 8px 32px ${alpha(theme.palette.common.black, 0.08)}`,
                    }}
                >
                    {/* Title Section */}
                    <Box sx={{ textAlign: 'center', mb: 5 }}>
                        <Typography
                            variant='h3'
                            component='h1'
                            sx={{
                                mb: 1.5,
                                fontWeight: 800,
                                background:
                                    'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
                                backgroundClip: 'text',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                            }}
                        >
                            Google Drive Audit
                        </Typography>
                        <Typography
                            variant='h6'
                            sx={{
                                color: 'text.secondary',
                                fontWeight: 400,
                            }}
                        >
                            Управление доступами к файлам
                        </Typography>
                    </Box>

                    {/* Menu Items */}
                    <Stack
                        spacing={2}
                        sx={{ mb: 3 }}
                    >
                        {menuItems.map((item, index) => (
                            <Card
                                key={index}
                                sx={{
                                    p: 0,
                                    overflow: 'hidden',
                                    transition: 'all 0.2s ease',
                                    border: 1,
                                    borderColor:
                                        item.variant === 'contained'
                                            ? 'primary.main'
                                            : 'divider',
                                    bgcolor:
                                        item.variant === 'contained'
                                            ? 'primary.main'
                                            : 'background.paper',
                                    '&:hover': {
                                        transform: 'translateY(-2px)',
                                        boxShadow: (theme) =>
                                            `0 4px 20px ${alpha(theme.palette.primary.main, 0.15)}`,
                                        borderColor: 'primary.main',
                                    },
                                }}
                            >
                                <Button
                                    fullWidth
                                    onClick={item.action}
                                    sx={{
                                        p: 3,
                                        display: 'flex',
                                        justifyContent: 'flex-start',
                                        alignItems: 'center',
                                        gap: 3,
                                        textAlign: 'left',
                                        textTransform: 'none',
                                        color:
                                            item.variant === 'contained'
                                                ? 'primary.contrastText'
                                                : 'text.primary',
                                        '&:hover': {
                                            bgcolor: 'transparent',
                                        },
                                    }}
                                >
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 56,
                                            height: 56,
                                            borderRadius: 2,
                                            bgcolor:
                                                item.variant === 'contained'
                                                    ? alpha('#fff', 0.2)
                                                    : alpha(
                                                          item.color ===
                                                              'primary'
                                                              ? '#1976d2'
                                                              : '#9c27b0',
                                                          0.1
                                                      ),
                                            color:
                                                item.variant === 'contained'
                                                    ? 'primary.contrastText'
                                                    : `${item.color}.main`,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {item.icon}
                                    </Box>
                                    <Box sx={{ flex: 1 }}>
                                        <Typography
                                            variant='h6'
                                            sx={{
                                                fontWeight: 600,
                                                mb: 0.5,
                                            }}
                                        >
                                            {item.title}
                                        </Typography>
                                        <Typography
                                            variant='body2'
                                            sx={{
                                                color:
                                                    item.variant === 'contained'
                                                        ? alpha('#fff', 0.8)
                                                        : 'text.secondary',
                                            }}
                                        >
                                            {item.description}
                                        </Typography>
                                    </Box>
                                </Button>
                            </Card>
                        ))}
                    </Stack>

                    {/* About Link */}
                    <Box sx={{ textAlign: 'center', pt: 2 }}>
                        <Button
                            variant='text'
                            startIcon={<InfoIcon />}
                            onClick={() => setCurrentPage('about')}
                            sx={{
                                textTransform: 'none',
                                fontWeight: 500,
                                color: 'text.secondary',
                                '&:hover': {
                                    color: 'primary.main',
                                },
                            }}
                        >
                            О приложении
                        </Button>
                    </Box>
                </Card>
            </Container>
        </Box>
    );
};

export default Main;
