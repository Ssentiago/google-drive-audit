import {
    Container,
    Card,
    Typography,
    Button,
    Box,
    IconButton,
    alpha,
} from '@mui/material';
import { useGlobalContext } from '../../../core/GlobalContext';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SecurityIcon from '@mui/icons-material/Security';
import SpeedIcon from '@mui/icons-material/Speed';
import VisibilityIcon from '@mui/icons-material/Visibility';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { invoke } from '@tauri-apps/api/core';

const About = () => {
    const { setCurrentPage } = useGlobalContext();

    const features = [
        {
            icon: <SecurityIcon sx={{ fontSize: 32, color: 'primary.main' }} />,
            title: 'Безопасность',
            description: 'Контроль доступов и защита конфиденциальных данных',
        },
        {
            icon: <SpeedIcon sx={{ fontSize: 32, color: 'primary.main' }} />,
            title: 'Скорость',
            description: 'Быстрое сканирование и массовая обработка файлов',
        },
        {
            icon: (
                <VisibilityIcon sx={{ fontSize: 32, color: 'primary.main' }} />
            ),
            title: 'Прозрачность',
            description: 'Полная видимость структуры доступов и аудит действий',
        },
    ];

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                py: 4,
                background: (theme) =>
                    `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
            }}
        >
            <Container maxWidth='sm'>
                <Card
                    sx={{
                        p: 5,
                        borderRadius: 3,
                        boxShadow: (theme) =>
                            `0 8px 32px ${alpha(theme.palette.common.black, 0.08)}`,
                    }}
                >
                    {/* Header */}
                    <Box sx={{ mb: 4 }}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                mb: 2,
                            }}
                        >
                            <IconButton
                                onClick={() => setCurrentPage('main')}
                                sx={{
                                    bgcolor: alpha('#1976d2', 0.1),
                                    '&:hover': {
                                        bgcolor: alpha('#1976d2', 0.2),
                                    },
                                }}
                            >
                                <ArrowBackIcon />
                            </IconButton>
                        </Box>

                        <Typography
                            variant='h3'
                            component='h1'
                            sx={{
                                mb: 1.5,
                                fontWeight: 800,
                                textAlign: 'center',
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
                                textAlign: 'center',
                                color: 'text.secondary',
                                fontWeight: 400,
                            }}
                        >
                            Инструмент для аудита и очистки доступов
                        </Typography>
                    </Box>

                    {/* Description */}
                    <Box sx={{ mb: 4 }}>
                        <Typography
                            variant='body1'
                            sx={{
                                mb: 2,
                                lineHeight: 1.8,
                                color: 'text.primary',
                                textAlign: 'center',
                            }}
                        >
                            Централизованное управление доступами к Google Drive
                            — отзывайте права сотрудников и закрывайте публичные
                            ссылки в несколько кликов.
                        </Typography>
                        <Typography
                            variant='body2'
                            sx={{
                                color: 'text.secondary',
                                lineHeight: 1.7,
                                textAlign: 'center',
                            }}
                        >
                            Быстрый аудит файлов, массовая обработка доступов и
                            полный контроль над безопасностью ваших данных.
                        </Typography>
                    </Box>

                    {/* Features */}
                    <Box sx={{ mb: 4 }}>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gap: 2,
                            }}
                        >
                            {features.map((feature, index) => (
                                <Card
                                    key={index}
                                    sx={{
                                        p: 2,
                                        textAlign: 'center',
                                        border: 1,
                                        borderColor: 'divider',
                                        transition: 'all 0.2s',
                                        '&:hover': {
                                            borderColor: 'primary.main',
                                            transform: 'translateY(-4px)',
                                            boxShadow: (theme) =>
                                                `0 4px 20px ${alpha(theme.palette.primary.main, 0.15)}`,
                                        },
                                    }}
                                >
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            mb: 1.5,
                                        }}
                                    >
                                        {feature.icon}
                                    </Box>
                                    <Typography
                                        variant='subtitle2'
                                        sx={{
                                            fontWeight: 600,
                                            mb: 0.5,
                                        }}
                                    >
                                        {feature.title}
                                    </Typography>
                                    <Typography
                                        variant='caption'
                                        sx={{
                                            color: 'text.secondary',
                                            display: 'block',
                                            lineHeight: 1.4,
                                        }}
                                    >
                                        {feature.description}
                                    </Typography>
                                </Card>
                            ))}
                        </Box>
                    </Box>

                    {/* Footer */}
                    <Box
                        sx={{
                            textAlign: 'center',
                            py: 3,
                            px: 2,
                            bgcolor: alpha('#1976d2', 0.05),
                            borderRadius: 2,
                            mb: 3,
                        }}
                    >
                        <Typography
                            variant='body2'
                            sx={{
                                mb: 1,
                                fontWeight: 600,
                                color: 'text.primary',
                            }}
                        >
                            Разработчик: Арсений Баиадзе
                        </Typography>
                        <Button
                            variant='text'
                            endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                            onClick={async () => {
                                await invoke('open_url', {
                                    url: 'https://itego.pro',
                                });
                            }}
                            sx={{
                                textTransform: 'none',
                                fontWeight: 500,
                                fontSize: 14,
                            }}
                        >
                            itego.pro
                        </Button>
                        <Typography
                            variant='caption'
                            sx={{
                                display: 'block',
                                mt: 1,
                                color: 'text.disabled',
                            }}
                        >
                            © 2025 Все права защищены
                        </Typography>
                    </Box>
                </Card>
            </Container>
        </Box>
    );
};

export default About;
