import { Container, Card, Typography, Button, Box } from '@mui/material';
import { useGlobalContext } from '../../../core/GlobalContext';

const About = () => {
    const { setCurrentPage } = useGlobalContext();

    return (
        <Container maxWidth='sm'>
            <Card sx={{ p: 4, mt: 8, textAlign: 'center' }}>
                <Typography
                    variant='h4'
                    component='h1'
                    sx={{ mb: 3, fontWeight: 700 }}
                >
                    О приложении
                </Typography>

                <Typography
                    variant='body1'
                    sx={{ mb: 2 }}
                >
                    Google Drive Audit
                </Typography>

                <Typography
                    variant='body2'
                    sx={{ mb: 3, color: 'text.secondary' }}
                >
                    Инструмент для аудита и очистки доступов на Google Drive
                </Typography>

                <Box
                    sx={{
                        my: 4,
                        py: 3,
                        borderTop: 1,
                        borderBottom: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Typography
                        variant='body2'
                        sx={{ mb: 1 }}
                    >
                        © 2025 Арсений Баиадзе
                    </Typography>
                    <Typography
                        variant='body2'
                        sx={{ color: 'text.secondary' }}
                    >
                        itego.pro
                    </Typography>
                </Box>

                <Button
                    variant='contained'
                    fullWidth
                    onClick={() => setCurrentPage('main')}
                >
                    На главную
                </Button>
            </Card>
        </Container>
    );
};

export default About;
