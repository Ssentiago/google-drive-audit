import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
    Container,
    Card,
    Typography,
    TextField,
    Button,
    Box,
    Chip,
} from '@mui/material';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useGlobalContext } from '../../../core/GlobalContext.tsx';
import { useScan } from '../../../core/ScanContext.tsx';

const DriveScan = () => {
    const [folderId, setFolderId] = useState('');
    const [suspiciousEmails, setSuspiciousEmails] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [emailError, setEmailError] = useState(false);
    const [isFromCache, setIsFromCache] = useState(false);

    const { setCurrentPage } = useGlobalContext();
    const { scanInfo, refresh } = useScan();

    useEffect(() => {
        console.log('🎯 MOUNT: listen mounted');
        let unlistenFn: (() => void) | undefined;

        listen<string>('scan_log', (event) => {
            console.log('📨 EVENT:', event.payload);
            setLogs((prev) => {
                return [...prev, event.payload];
            });
        }).then((fn) => {
            unlistenFn = fn;
        });

        return () => {
            console.log('💀 UNMOUNT: listen unmounted');
            unlistenFn?.();
        };
    }, []);

    const validateEmails = (text: string): boolean => {
        if (!text.trim()) return false;

        const emails = text
            .split(/[,\n]/)
            .map((e) => e.trim())
            .filter(Boolean);
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        return emails.every((email) => emailRegex.test(email));
    };

    const handleScan = async (force = false) => {
        if (!folderId.trim() || !suspiciousEmails.trim()) {
            setLogs(['Заполните все поля']);
            return;
        }

        setIsScanning(true);
        setLogs([]);
        setIsFromCache(false);

        try {
            const emailList = suspiciousEmails
                .split(/[,\n]/)
                .map((e) => e.trim().toLowerCase())
                .filter(Boolean);

            await invoke('scan_drive', {
                folderId: folderId.trim(),
                suspiciousEmails: emailList,
                forceRescan: force,
            });

            await refresh();
        } catch (error: any) {
            setLogs([`Ошибка: ${error}`]);
        } finally {
            setIsScanning(false);
        }
    };

    const handleExportToSheets = async () => {
        setLogs(['Создаём таблицу...']);
        try {
            await invoke('create_and_open_spreadsheet');
            setLogs((prev) => [...prev, '✅ Таблица открыта в браузере']);
        } catch (error: any) {
            setLogs((prev) => [...prev, `❌ Ошибка: ${error}`]);
        }
    };

    const formatDate = (iso: string) => {
        try {
            return format(new Date(iso), 'd MMMM yyyy, HH:mm', { locale: ru });
        } catch {
            return 'неизвестно';
        }
    };

    const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setSuspiciousEmails(value);

        if (value.trim()) {
            setEmailError(!validateEmails(value));
        } else {
            setEmailError(false);
        }
    };

    return (
        <Container maxWidth='md'>
            <Card sx={{ p: 4, mt: 4 }}>
                <Typography
                    variant='h4'
                    component='h1'
                    sx={{ mb: 4, textAlign: 'center', fontWeight: 700 }}
                >
                    Google Drive Cleaner
                </Typography>
                {scanInfo && (
                    <Box
                        sx={{
                            bgcolor: '#f0f4ff',
                            border: '1px solid #90caf9',
                            borderRadius: 2,
                            p: 2,
                            mb: 3,
                        }}
                    >
                        <Box sx={{ fontWeight: 600, mb: 0.5 }}>
                            Последнее сканирование
                            {isFromCache && (
                                <Chip
                                    label='Кеш'
                                    size='small'
                                    color='success'
                                    sx={{ ml: 1 }}
                                />
                            )}
                        </Box>
                        <Box sx={{ opacity: 0.8, fontSize: 13 }}>
                            {formatDate(scanInfo.scan_date)} ·{' '}
                            {scanInfo.email_count} email
                            {scanInfo.email_count !== 1 ? 'ов' : ''} ·{' '}
                            {scanInfo.total_access_count} доступов всего
                            <br />
                            <strong>{scanInfo.emails.join(', ')}</strong>
                        </Box>
                    </Box>
                )}
                <Typography
                    variant='subtitle2'
                    sx={{ mb: 1, fontWeight: 500 }}
                >
                    Корневая папка (ID)
                </Typography>
                <TextField
                    fullWidth
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    placeholder='1EHOqUs...'
                    disabled={isScanning}
                    size='small'
                    sx={{ mb: 2 }}
                />
                <Typography
                    variant='subtitle2'
                    sx={{ mb: 1, fontWeight: 500 }}
                >
                    Email для проверки
                    <Typography
                        component='span'
                        sx={{
                            ml: 1,
                            fontSize: 12,
                            fontWeight: 400,
                            color: 'text.secondary',
                        }}
                    >
                        (каждый email с новой строки)
                    </Typography>
                </Typography>
                <TextField
                    fullWidth
                    multiline
                    rows={6}
                    value={suspiciousEmails}
                    onChange={handleEmailChange}
                    placeholder={
                        'user1@example.com\nuser2@example.com\nuser3@example.com'
                    }
                    disabled={isScanning}
                    error={emailError}
                    helperText={
                        emailError
                            ? 'Проверьте формат email'
                            : 'Вводите каждый email с новой строки'
                    }
                    sx={{
                        '& .MuiInputBase-root': {
                            fontFamily: 'monospace',
                            fontSize: 14,
                        },
                    }}
                />
                <Box sx={{ display: 'flex', gap: 2, mt: 2.5 }}>
                    <Button
                        variant='contained'
                        fullWidth
                        onClick={() => handleScan(false)}
                        disabled={
                            isScanning ||
                            !folderId.trim() ||
                            !suspiciousEmails.trim() ||
                            emailError
                        }
                    >
                        {isScanning ? 'Сканирование...' : 'Сканировать'}
                    </Button>

                    {scanInfo && (
                        <Button
                            variant='outlined'
                            onClick={() => handleScan(true)}
                            disabled={isScanning}
                            sx={{
                                minWidth: 'fit-content',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            Пересканировать
                        </Button>
                    )}
                </Box>
                {logs.length > 0 && (
                    <>
                        <Typography
                            variant='subtitle2'
                            sx={{ mt: 3.5, mb: 1, fontWeight: 500 }}
                        >
                            Лог
                        </Typography>
                        <Box
                            component='pre'
                            sx={{
                                bgcolor: '#1e1e1e',
                                color: '#d4d4d4',
                                p: 2,
                                borderRadius: 1,
                                maxHeight: 180,
                                overflow: 'auto',
                                fontFamily: 'monospace',
                                fontSize: 13,
                                lineHeight: 1.5,
                                m: 0,
                            }}
                        >
                            {logs.join('\n')}
                        </Box>
                    </>
                )}
                {scanInfo && scanInfo.email_count > 0 && (
                    <>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button
                                variant='contained'
                                fullWidth
                                onClick={() => setCurrentPage('access-list')}
                            >
                                Перейти к результатам
                            </Button>
                            <Button
                                variant='outlined'
                                onClick={handleExportToSheets}
                                disabled={isScanning}
                                sx={{
                                    minWidth: 'fit-content',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                Экспорт в Sheets
                            </Button>
                        </Box>
                    </>
                )}
                <Box
                    sx={{
                        mt: 3,
                        textAlign: 'center',
                        display: 'flex',
                        gap: 2,
                        justifyContent: 'center',
                    }}
                >
                    <Button
                        variant='text'
                        size='small'
                        onClick={() => setCurrentPage('main')}
                        sx={{ color: 'text.secondary' }}
                    >
                        ← Главная
                    </Button>
                </Box>{' '}
            </Card>
        </Container>
    );
};

export default DriveScan;
