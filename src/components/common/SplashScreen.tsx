import { alpha, Box, CircularProgress, Typography } from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';

const SplashScreen = () => {
    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                background: (theme) =>
                    `radial-gradient(ellipse at center, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${theme.palette.background.default} 50%)`,
            }}
        >
            {/* Logo */}
            <Box
                sx={{
                    width: 80,
                    height: 80,
                    borderRadius: 3,
                    background:
                        'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 3,
                    boxShadow: `0 8px 32px ${alpha('#1976d2', 0.3)}`,
                }}
            >
                <SecurityIcon sx={{ color: '#fff', fontSize: 40 }} />
            </Box>

            {/* Title */}
            <Typography
                variant='h4'
                sx={{
                    fontWeight: 800,
                    mb: 1,
                    background:
                        'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                }}
            >
                Drive Audit
            </Typography>

            {/* Loader */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    mt: 3,
                }}
            >
                <CircularProgress
                    size={20}
                    thickness={4}
                />
                <Typography
                    variant='body2'
                    sx={{ color: 'text.secondary' }}
                >
                    Проверка авторизации...
                </Typography>
            </Box>
        </Box>
    );
};

export default SplashScreen;
