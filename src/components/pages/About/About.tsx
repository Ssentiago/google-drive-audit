import { useState, useEffect } from 'react';
import {
    Container,
    Card,
    Typography,
    Button,
    Box,
    IconButton,
    alpha,
    Divider,
    Stack,
    Chip,
} from '@mui/material';
import { useGlobalContext } from '../../../core/GlobalContext';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CodeIcon from '@mui/icons-material/Code';
import TelegramIcon from '@mui/icons-material/Telegram';
import { invoke } from '@tauri-apps/api/core';

const About = () => {
    const { setCurrentPage } = useGlobalContext();
    const [version, setVersion] = useState<string>('...');

    useEffect(() => {
        loadVersion();
    }, []);

    const loadVersion = async () => {
        try {
            const v = await invoke<string>('get_app_version');
            setVersion(v);
        } catch (e) {
            console.error('Failed to get version:', e);
            setVersion('unknown');
        }
    };

    const techStack = [
        'Rust + Tauri',
        'React + TypeScript',
        'Material UI',
        'Google Drive API',
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
                    `radial-gradient(ellipse at top, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${theme.palette.background.default} 50%)`,
            }}
        >
            <Container maxWidth='sm'>
                <Card
                    sx={{
                        p: 4,
                        borderRadius: 3,
                        boxShadow: (theme) =>
                            `0 8px 32px ${alpha(theme.palette.common.black, 0.08)}`,
                    }}
                >
                    {/* Header */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            mb: 3,
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
                        <Box sx={{ flex: 1 }}>
                            <Typography
                                variant='h5'
                                sx={{ fontWeight: 700 }}
                            >
                                О приложении
                            </Typography>
                        </Box>
                        <Chip
                            label={`v${version}`}
                            size='small'
                            variant='outlined'
                            sx={{
                                fontWeight: 600,
                                fontFamily: 'monospace',
                            }}
                        />
                    </Box>

                    <Divider sx={{ mb: 3 }} />

                    {/* Description */}
                    <Box sx={{ mb: 3 }}>
                        <Typography
                            variant='body1'
                            sx={{
                                mb: 2,
                                lineHeight: 1.7,
                                color: 'text.primary',
                            }}
                        >
                            Инструмент для аудита и управления доступами в
                            Google Drive. Позволяет быстро найти файлы
                            сотрудника, отозвать права и закрыть публичные
                            ссылки.
                        </Typography>
                        <Typography
                            variant='body2'
                            sx={{
                                color: 'text.secondary',
                                lineHeight: 1.6,
                            }}
                        >
                            Поддерживает массовые операции, экспорт в таблицы и
                            работу с копиями файлов владельцев.
                        </Typography>
                    </Box>

                    <Divider sx={{ mb: 3 }} />

                    {/* Tech Stack */}
                    <Box sx={{ mb: 3 }}>
                        <Typography
                            variant='subtitle2'
                            sx={{
                                mb: 1.5,
                                fontWeight: 600,
                                color: 'text.secondary',
                                textTransform: 'uppercase',
                                fontSize: 11,
                                letterSpacing: 1,
                            }}
                        >
                            Технологии
                        </Typography>
                        <Stack
                            direction='row'
                            spacing={1}
                            flexWrap='wrap'
                            sx={{ gap: 1 }}
                        >
                            {techStack.map((tech) => (
                                <Chip
                                    key={tech}
                                    label={tech}
                                    size='small'
                                    icon={<CodeIcon sx={{ fontSize: 14 }} />}
                                    sx={{
                                        bgcolor: alpha('#1976d2', 0.08),
                                        border: 1,
                                        borderColor: alpha('#1976d2', 0.15),
                                        fontWeight: 500,
                                        fontSize: 12,
                                    }}
                                />
                            ))}
                        </Stack>
                    </Box>

                    <Divider sx={{ mb: 3 }} />

                    {/* Developer Info */}
                    <Box sx={{ mb: 3 }}>
                        <Typography
                            variant='subtitle2'
                            sx={{
                                mb: 1.5,
                                fontWeight: 600,
                                color: 'text.secondary',
                                textTransform: 'uppercase',
                                fontSize: 11,
                                letterSpacing: 1,
                            }}
                        >
                            Разработчик
                        </Typography>
                        <Box sx={{ mb: 2 }}>
                            <Typography
                                variant='body1'
                                sx={{
                                    fontWeight: 600,
                                    mb: 0.5,
                                }}
                            >
                                Арсений Баиадзе
                            </Typography>
                            <Typography
                                variant='caption'
                                sx={{
                                    color: 'text.secondary',
                                }}
                            >
                                Full-stack разработчик
                            </Typography>
                        </Box>
                        <Stack
                            direction='row'
                            spacing={1.5}
                        >
                            <Button
                                variant='outlined'
                                size='small'
                                startIcon={<TelegramIcon />}
                                onClick={async () => {
                                    await invoke('open_url', {
                                        url: 'https://t.me/Sentiago',
                                    });
                                }}
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    flex: 1,
                                }}
                            >
                                @Sentiago
                            </Button>
                            <Button
                                variant='outlined'
                                size='small'
                                endIcon={
                                    <OpenInNewIcon sx={{ fontSize: 16 }} />
                                }
                                onClick={async () => {
                                    await invoke('open_url', {
                                        url: 'https://itego.pro',
                                    });
                                }}
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    flex: 1,
                                }}
                            >
                                itego.pro
                            </Button>
                        </Stack>
                    </Box>

                    <Divider sx={{ mb: 3 }} />

                    {/* Footer */}
                    <Box
                        sx={{
                            pt: 3,
                            borderTop: 1,
                            borderColor: 'divider',
                            textAlign: 'center',
                        }}
                    >
                        <Typography
                            variant='caption'
                            sx={{
                                color: 'text.disabled',
                            }}
                        >
                            © 2025 • Защищено OAuth 2.0
                        </Typography>
                    </Box>
                </Card>
            </Container>
        </Box>
    );
};

export default About;
