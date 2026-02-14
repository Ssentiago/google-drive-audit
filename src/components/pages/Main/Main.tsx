import {
    alpha,
    Box,
    Button,
    Card,
    Chip,
    Container,
    Grid,
    Stack,
    Typography,
} from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';
import InfoIcon from '@mui/icons-material/Info';
import LogoutIcon from '@mui/icons-material/Logout';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PeopleIcon from '@mui/icons-material/People';
import LinkIcon from '@mui/icons-material/Link';
import AssessmentIcon from '@mui/icons-material/Assessment';
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

    const features = [
        {
            icon: <PeopleIcon sx={{ fontSize: 28 }} />,
            title: 'Сотрудники',
            description: 'Управление доступами',
            color: '#1976d2',
        },
        {
            icon: <LinkIcon sx={{ fontSize: 28 }} />,
            title: 'Ссылки',
            description: 'Публичные доступы',
            color: '#0288d1',
        },
        {
            icon: <AssessmentIcon sx={{ fontSize: 28 }} />,
            title: 'Экспорт',
            description: 'Таблицы и отчёты',
            color: '#2e7d32',
        },
    ];

    return (
        <Box
            sx={{
                minHeight: '100vh',
                position: 'relative',
                overflow: 'hidden',
                background: (theme) =>
                    `radial-gradient(ellipse at top, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${theme.palette.background.default} 50%)`,
            }}
        >
            {/* Decorative Elements */}
            <Box
                sx={{
                    position: 'absolute',
                    top: -100,
                    right: -100,
                    width: 400,
                    height: 400,
                    borderRadius: '50%',
                    background: (theme) =>
                        `radial-gradient(circle, ${alpha(theme.palette.primary.main, 0.08)} 0%, transparent 70%)`,
                    filter: 'blur(60px)',
                    pointerEvents: 'none',
                }}
            />

            {/* Header */}
            <Box
                sx={{
                    position: 'relative',
                    zIndex: 1,
                    pt: 3,
                    px: 4,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box
                        sx={{
                            width: 40,
                            height: 40,
                            borderRadius: 2,
                            background:
                                'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <SecurityIcon sx={{ color: '#fff', fontSize: 24 }} />
                    </Box>
                    <Typography
                        variant='h6'
                        sx={{
                            fontWeight: 700,
                            background:
                                'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)',
                            backgroundClip: 'text',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                        }}
                    >
                        Drive Audit
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Chip
                        label={userEmail}
                        size='medium'
                        sx={{
                            fontWeight: 500,
                            bgcolor: 'background.paper',
                            border: 1,
                            borderColor: 'divider',
                            px: 1.5,
                            fontFamily: 'monospace',
                            fontSize: 13,
                        }}
                    />
                    <Button
                        variant='outlined'
                        size='small'
                        startIcon={<LogoutIcon />}
                        onClick={handleLogout}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            borderRadius: 2,
                        }}
                    >
                        Выход
                    </Button>
                </Box>
            </Box>

            {/* Main Content */}
            <Container
                maxWidth='md'
                sx={{
                    position: 'relative',
                    zIndex: 1,
                    py: 8,
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: 'calc(100vh - 120px)',
                }}
            >
                <Box sx={{ width: '100%' }}>
                    {/* Hero */}
                    <Box sx={{ textAlign: 'center', mb: 6 }}>
                        <Typography
                            variant='h2'
                            sx={{
                                fontWeight: 800,
                                mb: 2,
                                background:
                                    'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
                                backgroundClip: 'text',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                lineHeight: 1.2,
                            }}
                        >
                            Аудит Google Drive
                        </Typography>
                        <Typography
                            variant='h6'
                            sx={{
                                color: 'text.secondary',
                                fontWeight: 400,
                                mb: 3,
                                maxWidth: 600,
                                mx: 'auto',
                            }}
                        >
                            Управление доступами, контроль безопасности и
                            массовая обработка прав сотрудников
                        </Typography>

                        {/* CTA */}
                        <Button
                            variant='contained'
                            size='large'
                            endIcon={<ArrowForwardIcon />}
                            onClick={() => setCurrentPage('audit')}
                            sx={{
                                py: 1.5,
                                px: 4,
                                fontWeight: 700,
                                fontSize: 16,
                                textTransform: 'none',
                                borderRadius: 2,
                                boxShadow: `0 8px 24px ${alpha('#1976d2', 0.3)}`,
                                '&:hover': {
                                    boxShadow: `0 12px 32px ${alpha('#1976d2', 0.4)}`,
                                    transform: 'translateY(-2px)',
                                },
                                transition: 'all 0.3s ease',
                            }}
                        >
                            Начать аудит
                        </Button>
                    </Box>

                    {/* Features Grid */}
                    <Grid
                        container
                        spacing={2}
                        sx={{ mb: 4 }}
                    >
                        {features.map((feature, index) => (
                            <Grid
                                size={{ xs: 12, sm: 4 }}
                                key={index}
                            >
                                <Card
                                    sx={{
                                        p: 3,
                                        height: '100%',
                                        border: 1,
                                        borderColor: 'divider',
                                        transition: 'all 0.2s ease',
                                        cursor: 'default',
                                        '&:hover': {
                                            borderColor: feature.color,
                                            transform: 'translateY(-4px)',
                                            boxShadow: `0 8px 24px ${alpha(feature.color, 0.15)}`,
                                        },
                                    }}
                                >
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 2,
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                width: 48,
                                                height: 48,
                                                borderRadius: 2,
                                                bgcolor: alpha(
                                                    feature.color,
                                                    0.1
                                                ),
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: feature.color,
                                                flexShrink: 0,
                                            }}
                                        >
                                            {feature.icon}
                                        </Box>
                                        <Box>
                                            <Typography
                                                variant='h6'
                                                sx={{
                                                    fontWeight: 700,
                                                    mb: 0.5,
                                                    fontSize: 16,
                                                }}
                                            >
                                                {feature.title}
                                            </Typography>
                                            <Typography
                                                variant='caption'
                                                sx={{
                                                    color: 'text.secondary',
                                                    display: 'block',
                                                }}
                                            >
                                                {feature.description}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>

                    {/* Quick Features */}
                    <Stack
                        direction='row'
                        spacing={1.5}
                        justifyContent='center'
                        flexWrap='wrap'
                        sx={{ gap: 1, mb: 4 }}
                    >
                        {[
                            '⚡ Массовые операции',
                            '🔍 Поиск по спискам email',
                            '📊 Google Sheets экспорт',
                            '🗑️ Копирование и очистка',
                        ].map((feature) => (
                            <Chip
                                key={feature}
                                label={feature}
                                size='small'
                                sx={{
                                    bgcolor: alpha('#1976d2', 0.08),
                                    color: '#1976d2',
                                    fontWeight: 600,
                                    border: 1,
                                    borderColor: alpha('#1976d2', 0.15),
                                }}
                            />
                        ))}
                    </Stack>

                    {/* About Link */}
                    <Card
                        sx={{
                            p: 2.5,
                            border: 1,
                            borderColor: 'divider',
                            transition: 'all 0.2s ease',
                            cursor: 'pointer',
                            '&:hover': {
                                borderColor: 'primary.main',
                                bgcolor: alpha('#1976d2', 0.02),
                            },
                        }}
                        onClick={() => setCurrentPage('about')}
                    >
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: 2,
                                        bgcolor: alpha('#1976d2', 0.1),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <InfoIcon
                                        sx={{
                                            color: 'primary.main',
                                            fontSize: 20,
                                        }}
                                    />
                                </Box>
                                <Box>
                                    <Typography
                                        variant='body1'
                                        sx={{ fontWeight: 600 }}
                                    >
                                        О приложении
                                    </Typography>
                                    <Typography
                                        variant='caption'
                                        color='text.secondary'
                                    >
                                        Версия, технологии и контакты
                                    </Typography>
                                </Box>
                            </Box>
                            <ArrowForwardIcon
                                sx={{ color: 'text.secondary' }}
                            />
                        </Box>
                    </Card>
                </Box>
            </Container>

            {/* Footer */}
            <Box
                sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    p: 3,
                    textAlign: 'center',
                    zIndex: 1,
                }}
            >
                <Typography
                    variant='caption'
                    color='text.secondary'
                >
                    Защищено OAuth 2.0 • Google Drive API
                </Typography>
            </Box>
        </Box>
    );
};

export default Main;
