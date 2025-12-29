import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import TerminalIcon from '@mui/icons-material/Terminal';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import TableChartIcon from '@mui/icons-material/TableChart';

import {
    Container,
    Card,
    Typography,
    TextField,
    Button,
    Box,
    IconButton,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Divider,
    LinearProgress,
    Drawer,
    Badge,
    alpha,
    Chip,
} from '@mui/material';
import { useGlobalContext } from '../../../../core/GlobalContext.tsx';
import { useScan } from '../../../../core/ScanContext.tsx';
import DriveTree from './components/DriveTree.tsx';

interface SavedFolder {
    id: string;
    name: string;
    savedAt: number;
    lastScan?: {
        timestamp: number;
        foldersCount: number;
        filesCount: number;
        durationSec: number;
        suspiciousCount: number;
    };
    scanHistory: any[];
}

interface ScanProgress {
    foldersProcessed: number;
    filesProcessed: number;
}

const DriveScan = () => {
    const [folderId, setFolderId] = useState('');
    const [suspiciousEmails, setSuspiciousEmails] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [emailErrorMsg, setEmailErrorMsg] = useState('');
    const [idError, setIdError] = useState('');
    const { userEmail } = useGlobalContext();

    const [savedFolders, setSavedFolders] = useState<SavedFolder[]>([]);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [showFoldersDialog, setShowFoldersDialog] = useState(false);
    const [folderName, setFolderName] = useState('');

    const { setCurrentPage } = useGlobalContext();
    const { result, refresh } = useScan();
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    const [progress, setProgress] = useState<ScanProgress>({
        foldersProcessed: 0,
        filesProcessed: 0,
    });

    const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
    const [estimatedFolders, setEstimatedFolders] = useState<number | null>(
        null
    );
    const [estimatedFiles, setEstimatedFiles] = useState<number | null>(null);
    const [hasPrevData, setHasPrevData] = useState(false);

    const [drawerOpen, setDrawerOpen] = useState(false);
    const [newLogsCount, setNewLogsCount] = useState(0);
    const logBoxRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        loadSavedFolders();
    }, []);

    useEffect(() => {
        let unlistenProgress: (() => void) | undefined;
        let unlistenLog: (() => void) | undefined;

        listen<ScanProgress>('scan_progress', (event) => {
            setProgress(event.payload);
        }).then((fn) => {
            unlistenProgress = fn;
        });

        listen<string>('scan_log', (event) => {
            setLogs((prev) => [...prev, event.payload]);
            if (!drawerOpen) {
                setNewLogsCount((c) => c + 1);
            }
        }).then((fn) => {
            unlistenLog = fn;
        });

        return () => {
            unlistenProgress?.();
            unlistenLog?.();
        };
    }, [drawerOpen]);

    useEffect(() => {
        if (logBoxRef.current) {
            logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        let timer: NodeJS.Timeout | null = null;

        if (isScanning) {
            setElapsedSeconds(0);
            setProgress({ foldersProcessed: 0, filesProcessed: 0 });
            timer = setInterval(() => {
                setElapsedSeconds((prev) => prev + 1);
            }, 1000);
        }

        return () => {
            if (timer) clearInterval(timer);
        };
    }, [isScanning]);

    useEffect(() => {
        if (isScanning) {
            const currentSaved = savedFolders.find((f) => f.id === folderId);

            if (currentSaved?.lastScan) {
                setHasPrevData(true);
                setEstimatedFolders(currentSaved.lastScan.foldersCount);
                setEstimatedFiles(currentSaved.lastScan.filesCount);

                const prevFolder = currentSaved.lastScan;
                const prevTotalItems =
                    prevFolder.foldersCount + prevFolder.filesCount / 10;
                const timePerItem = prevFolder.durationSec / prevTotalItems;

                const currentItems =
                    progress.foldersProcessed + progress.filesProcessed / 10;
                const remainingItems =
                    prevFolder.foldersCount +
                    prevFolder.filesCount / 10 -
                    currentItems;

                let eta = remainingItems * timePerItem;

                let avgTimePerItem = timePerItem;
                let countSimilar = 1;
                currentSaved.scanHistory.forEach((h) => {
                    const deltaFolders =
                        Math.abs(h.foldersCount - prevFolder.foldersCount) /
                        prevFolder.foldersCount;
                    const deltaFiles =
                        Math.abs(h.filesCount - prevFolder.filesCount) /
                        prevFolder.filesCount;
                    if (deltaFolders < 0.2 && deltaFiles < 0.2) {
                        avgTimePerItem +=
                            h.durationSec /
                            (h.foldersCount + h.filesCount / 10);
                        countSimilar++;
                    }
                });
                avgTimePerItem /= countSimilar;
                eta = remainingItems * avgTimePerItem;

                if (
                    logs.some(
                        (l) => l.includes('timeout') || l.includes('rate')
                    )
                ) {
                    eta *= 1.2;
                }

                eta *= 1.15;
                if (countSimilar > 5) eta *= 1.1;

                setEtaSeconds(Math.max(0, Math.round(eta)));
            } else {
                setHasPrevData(false);
                setEstimatedFolders(null);
                setEstimatedFiles(null);
                setEtaSeconds(elapsedSeconds);
            }
        } else {
            setEtaSeconds(null);
        }
    }, [isScanning, elapsedSeconds, logs, savedFolders, folderId, progress]);

    const loadSavedFolders = async () => {
        try {
            const folders = await invoke<SavedFolder[]>('get_saved_folders');
            setSavedFolders(folders);
        } catch (err) {
            console.error('Ошибка загрузки папок:', err);
        }
    };

    const handleSaveFolder = async () => {
        if (!folderId.trim() || !folderName.trim()) return;

        try {
            await invoke('save_folder', {
                folderId: folderId.trim(),
                folderName: folderName.trim(),
            });
            await loadSavedFolders();
            setShowSaveDialog(false);
            setFolderName('');
        } catch (err) {
            console.error('Ошибка сохранения:', err);
        }
    };

    const handleSelectFolder = (folder: SavedFolder) => {
        setFolderId(folder.id);
        setShowFoldersDialog(false);
        loadSavedFolders();
    };

    const handleRemoveFolder = async (
        folderId: string,
        e: React.MouseEvent
    ) => {
        e.stopPropagation();
        try {
            await invoke('remove_saved_folder', { folderId });
            await loadSavedFolders();
        } catch (err) {
            console.error('Ошибка удаления:', err);
        }
    };

    const handleScan = async () => {
        if (!folderId.trim() || !suspiciousEmails.trim()) {
            setLogs(['Заполните все поля']);
            return;
        }

        setIsScanning(true);
        setLogs([]);
        setNewLogsCount(0);
        setProgress({ foldersProcessed: 0, filesProcessed: 0 });
        setEtaSeconds(null);
        setHasPrevData(false);

        try {
            const emails = suspiciousEmails
                .split(/[,\n]/)
                .map((e) => e.trim().toLowerCase())
                .filter(Boolean);

            await invoke('scan_drive', {
                folderId: folderId.trim(),
                suspiciousEmails: emails,
            });

            await refresh();
            await loadSavedFolders();
        } catch (error: any) {
            setLogs((prev) => [...prev, `Ошибка: ${error}`]);
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

    const validateEmails = (text: string): boolean => {
        if (!text.trim()) return false;

        const emails = text
            .split(/[,\n]/)
            .map((e) => e.trim())
            .filter(Boolean);
        const emailRegex = /^[^\s@]+@gmail.com$/;

        return emails.every((email) => emailRegex.test(email));
    };

    const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setSuspiciousEmails(value);

        if (!value.trim()) {
            setEmailErrorMsg('');
            return;
        }

        const emails = value
            .split(/[,\n]/)
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean);

        if (emails.includes(userEmail.toLowerCase())) {
            setEmailErrorMsg('Нельзя сканировать свой собственный email');
            return;
        }

        if (!validateEmails(value)) {
            setEmailErrorMsg(
                'Проверьте почту. Разрешены только валидные Gmail-адреса'
            );
            return;
        }
        setEmailErrorMsg('');
    };

    const handleIdBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
        if (!folderId.trim()) {
            setIdError('');
            return;
        }
        try {
            await invoke('is_this_folder', { itemId: folderId.trim() });
            setIdError('');
        } catch (err: any) {
            setIdError(err);
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const formatSeconds = (sec: number) => {
        const min = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return `${min > 0 ? min + ' мин ' : ''}${s} сек`;
    };

    const handleOpenDrawer = () => {
        setDrawerOpen(true);
        setNewLogsCount(0);
    };

    const isScanReady =
        folderId.trim() &&
        suspiciousEmails.trim() &&
        !emailErrorMsg &&
        !idError;

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
            <Container maxWidth='md'>
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
                            <Typography
                                variant='h4'
                                component='h1'
                                sx={{
                                    fontWeight: 800,
                                    background:
                                        'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
                                    backgroundClip: 'text',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                }}
                            >
                                Сканирование папки
                            </Typography>
                        </Box>
                        <Typography
                            variant='body2'
                            sx={{ color: 'text.secondary' }}
                        >
                            Проверка всех файлов в выбранной папке Google Drive
                        </Typography>
                    </Box>

                    {/* Folder ID Input */}
                    <Box sx={{ mb: 3 }}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                mb: 1.5,
                            }}
                        >
                            <Typography
                                variant='subtitle2'
                                sx={{ fontWeight: 600 }}
                            >
                                Корневая папка
                            </Typography>
                            <Tooltip
                                title={
                                    <Box>
                                        <Typography
                                            variant='caption'
                                            sx={{ display: 'block', mb: 0.5 }}
                                        >
                                            Откройте папку в Google Drive
                                        </Typography>
                                        <Typography
                                            variant='caption'
                                            sx={{
                                                display: 'block',
                                                fontFamily: 'monospace',
                                                fontSize: '0.7rem',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            drive.google.com/drive/folders/
                                            <strong>1EHOqUs...</strong>
                                        </Typography>
                                        <Typography
                                            variant='caption'
                                            sx={{ display: 'block', mt: 0.5 }}
                                        >
                                            Скопируйте часть после /folders/
                                            целиком
                                        </Typography>
                                    </Box>
                                }
                                arrow
                            >
                                <HelpOutlineIcon
                                    sx={{
                                        fontSize: 18,
                                        color: 'text.secondary',
                                        cursor: 'help',
                                    }}
                                />
                            </Tooltip>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <TextField
                                fullWidth
                                value={folderId}
                                onChange={(e) => setFolderId(e.target.value)}
                                placeholder='1EHOqUs...'
                                disabled={isScanning}
                                onBlur={handleIdBlur}
                                error={Boolean(idError)}
                                helperText={idError}
                                sx={{
                                    '& .MuiInputBase-root': {
                                        fontFamily: 'monospace',
                                        fontSize: 14,
                                    },
                                }}
                            />
                            <Tooltip title='Выбрать сохранённую папку'>
                                <IconButton
                                    onClick={() => setShowFoldersDialog(true)}
                                    disabled={isScanning}
                                    sx={{
                                        bgcolor: alpha('#1976d2', 0.1),
                                        '&:hover': {
                                            bgcolor: alpha('#1976d2', 0.2),
                                        },
                                    }}
                                >
                                    <Badge
                                        badgeContent={savedFolders.length}
                                        color='primary'
                                    >
                                        <FolderOpenIcon />
                                    </Badge>
                                </IconButton>
                            </Tooltip>

                            {folderId.trim() === '' ? (
                                <Tooltip title='Сохранить текущую папку (введите ID)'>
                                    <span>
                                        <IconButton disabled>
                                            <BookmarkBorderIcon />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            ) : savedFolders.some(
                                  (f) => f.id === folderId.trim()
                              ) ? (
                                <Tooltip title='Папка уже сохранена'>
                                    <IconButton
                                        disabled
                                        sx={{ color: 'success.main' }}
                                    >
                                        <CheckCircleIcon />
                                    </IconButton>
                                </Tooltip>
                            ) : (
                                <Tooltip title='Сохранить текущую папку'>
                                    <IconButton
                                        onClick={() => setShowSaveDialog(true)}
                                        disabled={
                                            isScanning || Boolean(idError)
                                        }
                                        sx={{
                                            bgcolor: alpha('#1976d2', 0.1),
                                            '&:hover': {
                                                bgcolor: alpha('#1976d2', 0.2),
                                            },
                                        }}
                                    >
                                        <BookmarkAddIcon />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>
                    </Box>

                    {/* Email Input */}
                    <Box sx={{ mb: 3 }}>
                        <Typography
                            variant='subtitle2'
                            sx={{ mb: 1.5, fontWeight: 600 }}
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
                            placeholder='user1@gmail.com&#10;user2@gmail.com&#10;user3@gmail.com'
                            disabled={isScanning}
                            error={Boolean(emailErrorMsg)}
                            helperText={
                                emailErrorMsg ||
                                'Вводите каждый email с новой строки'
                            }
                            sx={{
                                '& .MuiInputBase-root': {
                                    fontFamily: 'monospace',
                                    fontSize: 14,
                                },
                            }}
                        />
                    </Box>

                    {/* Action Buttons */}
                    <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                        <Button
                            variant='contained'
                            fullWidth
                            onClick={handleScan}
                            disabled={isScanning || !isScanReady}
                            startIcon={<PlayArrowIcon />}
                            sx={{
                                py: 1.5,
                                fontWeight: 600,
                                textTransform: 'none',
                                fontSize: 16,
                            }}
                        >
                            {isScanning
                                ? `Сканирование... ${formatSeconds(elapsedSeconds)}`
                                : 'Запустить сканирование'}
                        </Button>

                        {isScanning && (
                            <>
                                <Tooltip title='Открыть логи'>
                                    <IconButton
                                        onClick={handleOpenDrawer}
                                        sx={{
                                            bgcolor: alpha('#1976d2', 0.1),
                                            '&:hover': {
                                                bgcolor: alpha('#1976d2', 0.2),
                                            },
                                        }}
                                    >
                                        <Badge
                                            badgeContent={newLogsCount}
                                            color='error'
                                        >
                                            <TerminalIcon />
                                        </Badge>
                                    </IconButton>
                                </Tooltip>

                                <Button
                                    variant='outlined'
                                    color='error'
                                    onClick={async () => {
                                        await invoke('cancel_scan_drive');
                                        setIsScanning(false);
                                        setElapsedSeconds(0);
                                        setEtaSeconds(null);
                                    }}
                                    startIcon={<StopIcon />}
                                    sx={{
                                        minWidth: '140px',
                                        fontWeight: 600,
                                        textTransform: 'none',
                                    }}
                                >
                                    Отменить
                                </Button>
                            </>
                        )}
                    </Box>

                    {/* Progress Bar */}
                    {isScanning && (
                        <Card
                            sx={{
                                p: 3,
                                mb: 3,
                                bgcolor: alpha('#1976d2', 0.05),
                                border: 1,
                                borderColor: alpha('#1976d2', 0.2),
                            }}
                        >
                            <LinearProgress
                                variant={
                                    hasPrevData
                                        ? 'determinate'
                                        : 'indeterminate'
                                }
                                value={
                                    hasPrevData &&
                                    estimatedFolders &&
                                    estimatedFiles
                                        ? ((progress.foldersProcessed +
                                              progress.filesProcessed / 10) /
                                              (estimatedFolders +
                                                  estimatedFiles / 10)) *
                                          100
                                        : undefined
                                }
                                sx={{
                                    height: 8,
                                    borderRadius: 1,
                                    bgcolor: alpha('#000', 0.1),
                                    '& .MuiLinearProgress-bar': {
                                        bgcolor: 'primary.main',
                                    },
                                }}
                            />
                            <Box
                                sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    mt: 2,
                                    flexWrap: 'wrap',
                                    gap: 1,
                                }}
                            >
                                <Chip
                                    label={`Прошло: ${formatSeconds(elapsedSeconds)}`}
                                    size='small'
                                    sx={{ fontWeight: 500 }}
                                />
                                {etaSeconds !== null && (
                                    <Chip
                                        label={`Осталось ≈ ${formatSeconds(etaSeconds)}`}
                                        size='small'
                                        color='primary'
                                        sx={{ fontWeight: 500 }}
                                    />
                                )}
                            </Box>
                            <Typography
                                variant='caption'
                                sx={{
                                    display: 'block',
                                    mt: 1.5,
                                    textAlign: 'center',
                                    color: 'text.secondary',
                                }}
                            >
                                Обработано: {progress.foldersProcessed} папок /{' '}
                                {progress.filesProcessed} файлов
                                {hasPrevData &&
                                    estimatedFolders &&
                                    estimatedFiles && (
                                        <>
                                            {' '}
                                            / ~{estimatedFolders} папок / ~
                                            {estimatedFiles} файлов
                                        </>
                                    )}
                            </Typography>
                        </Card>
                    )}

                    {/* Tree View */}
                    {isScanning && (
                        <Card
                            sx={{
                                mb: 3,
                                height: 600,
                                overflow: 'hidden',
                                border: 1,
                                borderColor: 'divider',
                            }}
                        >
                            <DriveTree />
                        </Card>
                    )}

                    {/* Results Actions */}
                    {result.suspiciousAccesses.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                            <Button
                                variant='contained'
                                fullWidth
                                onClick={() => setCurrentPage('access-list')}
                                sx={{
                                    py: 1.5,
                                    fontWeight: 600,
                                    textTransform: 'none',
                                    fontSize: 16,
                                }}
                            >
                                Перейти к результатам (
                                {result.suspiciousAccesses.length})
                            </Button>
                            <Button
                                variant='outlined'
                                onClick={handleExportToSheets}
                                disabled={isScanning}
                                startIcon={<TableChartIcon />}
                                sx={{
                                    minWidth: 'fit-content',
                                    whiteSpace: 'nowrap',
                                    fontWeight: 600,
                                    textTransform: 'none',
                                }}
                            >
                                Экспорт
                            </Button>
                        </Box>
                    )}
                </Card>
            </Container>

            {/* Logs Drawer */}
            <Drawer
                anchor='right'
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            >
                <Box sx={{ width: 600, p: 3 }}>
                    <Typography
                        variant='h6'
                        sx={{ mb: 2, fontWeight: 600 }}
                    >
                        Лог сканирования
                    </Typography>
                    <Box
                        component='pre'
                        ref={logBoxRef}
                        sx={{
                            bgcolor: '#1e1e1e',
                            color: '#d4d4d4',
                            p: 2,
                            borderRadius: 1,
                            height: 'calc(100vh - 120px)',
                            overflow: 'auto',
                            fontFamily: 'monospace',
                            fontSize: 13,
                            lineHeight: 1.5,
                            m: 0,
                        }}
                    >
                        {logs.join('\n')}
                    </Box>
                </Box>
            </Drawer>

            {/* Save Folder Dialog */}
            <Dialog
                open={showSaveDialog}
                onClose={() => setShowSaveDialog(false)}
                maxWidth='sm'
                fullWidth
            >
                <DialogTitle sx={{ fontWeight: 600 }}>
                    Сохранить папку
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label='Название'
                        placeholder='НИЦ Энерго'
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        sx={{ mt: 2 }}
                    />
                    <Typography
                        variant='caption'
                        sx={{
                            display: 'block',
                            mt: 1.5,
                            color: 'text.secondary',
                            fontFamily: 'monospace',
                        }}
                    >
                        ID: {folderId}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ p: 3, pt: 2 }}>
                    <Button
                        onClick={() => setShowSaveDialog(false)}
                        sx={{ textTransform: 'none' }}
                    >
                        Отмена
                    </Button>
                    <Button
                        onClick={handleSaveFolder}
                        variant='contained'
                        disabled={!folderName.trim()}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Сохранить
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Saved Folders Dialog */}
            <Dialog
                open={showFoldersDialog}
                onClose={() => setShowFoldersDialog(false)}
                maxWidth='sm'
                fullWidth
            >
                <DialogTitle sx={{ fontWeight: 600 }}>
                    Сохранённые папки
                </DialogTitle>
                <DialogContent sx={{ p: 0 }}>
                    {savedFolders.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center' }}>
                            <Typography color='text.secondary'>
                                Нет сохранённых папок
                            </Typography>
                        </Box>
                    ) : (
                        <List>
                            {savedFolders.map((folder, idx) => (
                                <Box key={folder.id}>
                                    <ListItem
                                        disablePadding
                                        secondaryAction={
                                            <IconButton
                                                edge='end'
                                                onClick={(e) =>
                                                    handleRemoveFolder(
                                                        folder.id,
                                                        e
                                                    )
                                                }
                                                sx={{ color: 'error.main' }}
                                            >
                                                <DeleteOutlineIcon />
                                            </IconButton>
                                        }
                                    >
                                        <ListItemButton
                                            onClick={() =>
                                                handleSelectFolder(folder)
                                            }
                                            sx={{
                                                '&:hover': {
                                                    bgcolor: alpha(
                                                        '#1976d2',
                                                        0.08
                                                    ),
                                                },
                                            }}
                                        >
                                            <ListItemText
                                                primary={
                                                    <Typography
                                                        sx={{ fontWeight: 600 }}
                                                    >
                                                        {folder.name}
                                                    </Typography>
                                                }
                                                secondary={
                                                    <>
                                                        <Typography
                                                            component='span'
                                                            variant='caption'
                                                            sx={{
                                                                display:
                                                                    'block',
                                                                fontFamily:
                                                                    'monospace',
                                                                mt: 0.5,
                                                            }}
                                                        >
                                                            {folder.id}
                                                        </Typography>
                                                        {folder.lastScan && (
                                                            <Typography
                                                                component='span'
                                                                variant='caption'
                                                                sx={{
                                                                    display:
                                                                        'block',
                                                                    mt: 0.5,
                                                                }}
                                                            >
                                                                Последнее
                                                                сканирование:{' '}
                                                                {formatDate(
                                                                    folder
                                                                        .lastScan
                                                                        .timestamp
                                                                )}{' '}
                                                                •{' '}
                                                                {
                                                                    folder
                                                                        .lastScan
                                                                        .suspiciousCount
                                                                }{' '}
                                                                доступов
                                                            </Typography>
                                                        )}
                                                    </>
                                                }
                                            />
                                        </ListItemButton>
                                    </ListItem>
                                    {idx < savedFolders.length - 1 && (
                                        <Divider />
                                    )}
                                </Box>
                            ))}
                        </List>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 3, pt: 2 }}>
                    <Button
                        onClick={() => setShowFoldersDialog(false)}
                        sx={{ textTransform: 'none' }}
                    >
                        Закрыть
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default DriveScan;
